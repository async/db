# CI And Release

This page documents the verification and package checks that keep docs, examples, and generated-file policy honest.

## Supported Node Version

The package supports Node.js 24 and newer.

CI runs on Node.js 24 through the `@async/pipeline` generated workflow at
`.github/workflows/async-pipeline.yml`.

Generated Hono/SQLite standalone apps may require newer Node versions because SQLite output uses `node:sqlite`.

## Required Verification

Run these before handing off changes:

```bash
pnpm run release:check
```

If the default npm cache has ownership or permission issues on this machine, use a temp cache for the pack check:

```bash
npm --cache /private/tmp/async-db-npm-cache pack --dry-run
```

`release:check` delegates to the pipeline verify graph:

```bash
async-pipeline run verify --force
```

The generated `verify` job runs the package checks, tests, docs build, API
surface checks, sync drift checks, and package dry run through `pipeline.ts`.

## Useful Smoke Commands

Use the dev loop while editing package code:

```bash
pnpm run dev          # watch src and relaunch all examples
pnpm run examples     # one-shot all examples server for smoke checks
pnpm run watch        # compile dist and test-build in watch mode only
pnpm run cli -- sync --cwd ./examples/basic
```

Use `pnpm run dev` for active package work. Use `pnpm run examples` for CI-like example smoke checks.
Npm task entrypoints live under `scripts/tasks/`; reusable helper scripts live directly under `scripts/`.

```bash
pnpm run db -- sync --cwd ./examples/basic
pnpm run db -- schema validate --cwd ./examples/basic
pnpm run db -- create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}' --cwd ./examples/basic
pnpm run examples
```

Use `pnpm run examples -- --tailscale-serve` only for local tailnet previews.
The default examples command remains loopback-only and does not configure
Tailscale.

The local REST server binds a loopback port. In sandboxed environments this may require explicit approval:

```bash
pnpm run db -- serve --cwd ./examples/basic
```

## Package Files Allowlist

`package.json` includes:

```txt
dist/**/*.js
dist/**/*.d.ts
!dist/**/*.test.js
examples/*/README.md
examples/*/example.json
examples/*/deno.json
examples/*/package.json
examples/*/serve-example.js
examples/*/framework/**
examples/*/server/**
examples/*/db/**
examples/*/db.config.js
examples/*/src/**
docs/**/*.md
!docs/goals/**
API_SURFACE.md
api-contract.json
db.config.example.js
CHANGELOG.md
README.md
SPEC.md
```

Docs restructuring affects the published package because `docs/**/*.md` is included, except local GoalBuddy boards under `docs/goals/`. Use `npm pack --dry-run` to confirm the tarball contains the expected docs and does not include generated runtime output.

## Generated Runtime Output

Generated `.db/` output should normally stay uncommitted.

Committed generated files are allowed when configured:

```txt
examples/advanced/src/generated/db.types.d.ts
examples/basic/src/generated/db.types.d.ts
examples/computed-fields/src/generated/db.types.d.ts
examples/content-collections/src/generated/db.types.d.ts
examples/production-json/src/generated/db.types.d.ts
examples/schema-first/src/generated/db.types.d.ts
examples/schema-manifest/src/generated/db.schema.json
examples/schema-manifest/src/generated/db.types.d.ts
examples/schema-ui/src/generated/db.schema.json
examples/schema-ui/src/generated/db.types.d.ts
```

If a smoke command writes `.db/` inside an example, remove that generated runtime state before finalizing unless the task explicitly asks to commit it.

## Docs Link Checks

Use lightweight checks after docs edits:

```bash
wc -l README.md
rg -n "\\]\\(#" README.md docs examples
rg -n "docs/|SPEC.md|architecture.md" README.md docs examples -g "*.md"
```

The first check confirms the README stayed compact. The second highlights same-page anchors that may need review after moving sections. The third makes docs and source-of-truth links easy to inspect.

## Release Hygiene

- Keep `CHANGELOG.md` focused on release history, not docs planning notes.
- Keep root `SPEC.md` as the product and acceptance source of truth.
- Keep implementation ownership and source maps in [Architecture](./architecture.md) and `AGENTS.md`, not duplicated across every doc page.

## Release Automation

Release verification, GitHub Packages previews/snapshots, npm publication, and
GitHub Pages deployment are owned by `pipeline.ts` and generated into
`.github/workflows/async-pipeline.yml`.

- Pull requests run `verify`, `pages`, and `preview`.
- Pushes to `main` run `verify`, `pages`, and `snapshot`.
- GitHub Release events run `verify` and `publish`.
- Manual dispatch lets maintainers choose `pages`, `publish-github`, `publish`, or `release-doctor`.
- Rerunning a partially completed publish is safe: the pipeline lifecycle commands skip already-published immutable versions where supported and `release-doctor` reconciles release state.

The release workflow uses npm Trusted Publishing through GitHub Actions OIDC. Before the first automated publish, configure npm for:

```txt
package: @async/db
owner/repo: async/db
workflow: async-pipeline.yml
environment: npm-publish
allowed action: npm publish
```

Use a current npm CLI when creating the trusted publisher. Older `npm trust`
commands may fail with `E400` because npm now requires an explicit allowed
action:

```bash
pnpm dlx npm@latest trust github @async/db \
  --file async-pipeline.yml \
  --repo async/db \
  --allow-publish
pnpm dlx npm@latest trust list @async/db
```

Keep the package public through `publishConfig.access: "public"` and the
pipeline npm publish command:

```bash
pnpm run pipeline:publish:npm
```

The generated publish job maps the org-level `npm_token` secret to `NODE_AUTH_TOKEN` and requires
GitHub OIDC provenance. Keep `package.json` `repository.url` exactly aligned with
`https://github.com/async/db`, because npm validates trusted
publishing against the GitHub repository identity.

If Trusted Publishing is not configured yet, the generated publish job can build
and verify the package, but npm publish will fail until npm trusts this
repository and workflow.

If Trusted Publishing is not configured and the npm publish step fails, fix the
`npm-publish` environment or `npm_token` setup and rerun the generated GitHub
Actions publish job. Do not publish `@async/db` from the local machine.

## Actions Release

For a manual patch release, update `package.json`, `.release-please-manifest.json`,
and `CHANGELOG.md`, then merge to `main` and run the generated `Async Pipeline`
workflow with the `publish` job selected:

```bash
pnpm run release:check
```

The generated publish job creates or verifies the `v<version>` tag and GitHub
Release before publishing GitHub Packages and npm.
Use `NPM_CONFIG_USERCONFIG=/dev/null npm view @async/db version` when checking public npm visibility from this machine, because local npm user config may set conservative install cutoffs.

## Manual Release Checks

Use local scripts for preflight only:

```bash
pnpm run release:check
pnpm run release:pack
```

Run `pnpm run release:publish` only inside the generated GitHub Actions workflow
path. Normal releases must keep npm provenance tied to the release commit.
