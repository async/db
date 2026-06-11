import { definePipeline, env, job, sh, task, trigger } from "@async/pipeline";

export default definePipeline({
  name: "async-db",
  cache: "file:local",
  triggers: {
    pr: trigger.github({ events: ["pull_request"] }),
    main: trigger.github({ events: ["push"], branches: ["main"] }),
    manual: trigger.manual()
  },
  sync: {
    github: true,
    tasks: {
      prefix: "pipeline",
      runners: ["package"],
      targets: [{ package: "@async/db" }],
      jobs: ["verify"],
      scripts: {
        "sync:check": "sync check",
        "github:generate": "github generate"
      }
    }
  },
  namedInputs: {
    source: [
      "src/**/*",
      "test/**/*",
      "scripts/**/*",
      "docs/**/*.md",
      "website/**/*",
      "API_SURFACE.md",
      "db.config.example.js",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig*.json"
    ]
  },
  tasks: {
    check: task({
      description: "Build, syntax check, API-surface check, and docs build check.",
      inputs: ["source"],
      cache: true,
      run: sh`npm run check`
    }),
    test: task({
      description: "Build and run the test suite.",
      inputs: ["source"],
      cache: true,
      run: sh`npm test`
    }),
    "release-doctor": task({
      description: "Reconcile release state: the git tag, npm version, and GitHub Release must agree; repairs what is provably safe and names what is not. Gated by the verify graph so a repair can never publish unverified code.",
      dependsOn: ["pack"],
      cache: false,
      run: sh`node scripts/release-doctor.mjs --repair`
    }),
    pack: task({
      description: "Verify the publishable package contents.",
      dependsOn: ["check", "test"],
      inputs: ["source"],
      cache: false,
      run: sh`npm pack --dry-run`
    })
  },
  jobs: {
    verify: job({
      target: "pack",
      trigger: ["pr", "main"]
    }),
    "release-doctor": job({
      description: "Diagnose and repair tag/npm/GitHub-Release consistency for the current version.",
      target: "release-doctor",
      trigger: ["manual"],
      github: {
        permissions: {
          contents: "write",
          idToken: "write"
        }
      },
      env: {
        GH_TOKEN: env.secret("GITHUB_TOKEN")
      }
    })
  }
});
