import { definePipeline, env, job, sh, task, trigger } from "@async/pipeline";

export default definePipeline({
  name: "async-db",
  cache: "file:local",
  triggers: {
    pr: trigger.github({ events: ["pull_request"] }),
    main: trigger.github({ events: ["push"], branches: ["main"] }),
    release: trigger.github({ events: ["release"] }),
    manual: trigger.manual()
  },
  sync: {
    github: {
      nodeVersion: 24,
      cache: true,
      dependencyCache: false
    },
    tasks: {
      prefix: "pipeline",
      runners: ["package"],
      targets: [{ package: "@async/db" }],
      jobs: ["pages", "preview", "publish", "publish-github", "release-doctor", "snapshot", "verify"],
      tasks: ["api-surface", "api-surface-generate", "docs.site", "sync-check"],
      scripts: {
        "api-surface": "run-task api-surface",
        "api-surface:generate": "run-task api-surface-generate",
        "docs": "run-task docs.site",
        "github:check": "github check",
        "sync:check": "sync check",
        "verify:force": "run verify --force",
        "github:generate": "github generate",
        "publish:github:main": "publish github main --package .",
        "publish:github:pr": "publish github pr --package .",
        "publish:github:release": "publish github release --package .",
        "publish:npm": "publish npm --package .",
        "release:doctor": "release doctor --package .",
        "release:ensure": "release ensure --package .",
        "sync:generate": "sync generate"
      }
    }
  },
  namedInputs: {
    default: [
      "src/**/*",
      "tests/**/*",
      "scripts/**/*",
      "docs/**/*.md",
      "website/**/*",
      "API_SURFACE.md",
      "api-contract.json",
      "db.config.example.js",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig*.json"
    ],
    production: [
      "src/**/*",
      "!src/**/*.test.*",
      "dist/**/*",
      "package.json",
      "README.md",
      "docs/**/*.md",
      "API_SURFACE.md",
      "api-contract.json",
      "db.config.example.js"
    ]
  },
  tasks: {
    "sync-check": task({
      description: "All synced surfaces (generated workflow, lock, and package scripts) still match pipeline.ts.",
      inputs: [
        "pipeline.ts",
        "package.json",
        ".github/workflows/async-pipeline.yml",
        ".github/async-pipeline.lock.json",
        ".async-pipeline/tasks.lock.json"
      ],
      cache: false,
      run: sh`pnpm async-pipeline sync check`
    }),
    "api-surface-generate": task({
      description: "Regenerate the @async/db API surface ledger from api-contract.json.",
      inputs: ["api-contract.json"],
      outputs: ["API_SURFACE.md"],
      cache: false,
      run: sh`pnpm run api-surface:generate`
    }),
    "api-surface": task({
      description: "API surface drift checks through @async/api-contract.",
      inputs: ["api-contract.json", "API_SURFACE.md"],
      cache: true,
      run: sh`pnpm run api-surface:check`
    }),
    check: task({
      description: "Build, syntax check, API-surface check, and docs build check.",
      inputs: ["default"],
      cache: true,
      run: sh`pnpm run check`
    }),
    test: task({
      description: "Build and run the test suite.",
      inputs: ["default"],
      cache: true,
      run: sh`pnpm run test`
    }),
    "docs.site": task({
      description: "Build the standardized GitHub Pages documentation site.",
      inputs: ["README.md", "docs/**/*.md", "scripts/build-pages.js"],
      outputs: [".async/pages/**"],
      cache: false,
      run: sh`node scripts/build-pages.js`
    }),
    "release-doctor": task({
      description: "Reconcile release state across npm, GitHub Packages, and GitHub Releases after package verification.",
      dependsOn: ["pack"],
      cache: false,
      run: sh`pnpm async-pipeline release doctor --package .`
    }),
    pack: task({
      description: "Verify the publishable package contents.",
      dependsOn: ["check", "test", "docs.site", "api-surface", "sync-check"],
      inputs: ["production"],
      cache: false,
      run: sh`npm pack --dry-run`
    }),
    preview: task({
      description: "Same-repo PRs publish an immutable GitHub Packages preview and update one install-instructions comment; fork PRs skip.",
      dependsOn: ["pack"],
      inputs: ["production"],
      cache: false,
      run: sh`pnpm async-pipeline publish github pr --package .`
    }),
    snapshot: task({
      description: "Pushes to main publish an immutable GitHub Packages snapshot and move the main dist-tag while the commit is still branch head.",
      dependsOn: ["pack"],
      inputs: ["production"],
      cache: false,
      run: sh`pnpm async-pipeline publish github main --package .`
    }),
    "publish-github": task({
      description: "Stable GitHub Packages mirror for the release version before npm publishing.",
      dependsOn: ["release-ensure"],
      inputs: ["production"],
      cache: false,
      run: sh`pnpm async-pipeline publish github release --package .`
    }),
    "release-ensure": task({
      description: "Create or verify the release tag and GitHub Release before package publishing.",
      dependsOn: ["pack"],
      inputs: ["production"],
      cache: false,
      run: sh`pnpm async-pipeline release ensure --package .`
    }),
    publish: task({
      description: "Publish the verified release to npm, then run release doctor.",
      dependsOn: ["publish-github"],
      inputs: ["production"],
      cache: false,
      run: [
        sh`pnpm async-pipeline publish npm --package .`,
        sh`pnpm async-pipeline release doctor --package .`
      ]
    })
  },
  jobs: {
    verify: job({
      target: "pack",
      trigger: ["pr", "main", "release"]
    }),
    pages: job({
      target: "docs.site",
      trigger: ["pr", "main", "manual"],
      github: {
        pages: {
          build: { kind: "static", path: ".async/pages" }
        }
      }
    }),
    preview: job({
      target: "preview",
      trigger: ["pr"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          issues: "write",
          packages: "write",
          pullRequests: "write"
        }
      }
    }),
    snapshot: job({
      target: "snapshot",
      trigger: ["main"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write"
        }
      }
    }),
    "publish-github": job({
      target: "publish-github",
      trigger: ["manual"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write"
        }
      }
    }),
    publish: job({
      target: "publish",
      trigger: ["manual", "release"],
      environment: {
        name: "npm-publish",
        url: "https://www.npmjs.com/package/@async/db"
      },
      requires: {
        provenance: true
      },
      env: {
        NODE_AUTH_TOKEN: env.secret("npm_token"),
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write"
        }
      }
    }),
    "release-doctor": job({
      description: "Diagnose release consistency for the current version.",
      target: "release-doctor",
      trigger: ["manual"],
      github: {
        permissions: {
          contents: "read",
          packages: "read"
        }
      },
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      }
    })
  }
});
