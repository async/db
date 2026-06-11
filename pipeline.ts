import { definePipeline, job, sh, task, trigger } from "@async/pipeline";

export default definePipeline({
  name: "async-db",
  cache: "file:local",
  triggers: {
    pr: trigger.github({ events: ["pull_request"] }),
    main: trigger.github({ events: ["push"], branches: ["main"] })
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
    })
  }
});
