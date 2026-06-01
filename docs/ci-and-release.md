# CI And Release

This page documents the verification and package checks that keep docs, examples, and generated-file policy honest.

## Supported Node Versions

The package supports Node.js 20 and newer.

CI runs on Node.js 20, 22, and 24 through `.github/workflows/ci.yml`.

Generated Hono/SQLite standalone apps may require newer Node versions because SQLite output uses `node:sqlite`.

## Required Verification

Run these before handing off changes:

```bash
npm run release:check
```

If the default npm cache has ownership or permission issues on this machine, use a temp cache for the pack check:

```bash
npm --cache /private/tmp/async-db-npm-cache pack --dry-run
```

`release:check` expands to:

```bash
npm run check
npm test
npm pack --dry-run
```

## Useful Smoke Commands

Use the dev loop while editing package code:

```bash
npm run dev          # watch src and relaunch all examples
npm run examples     # one-shot all examples server for smoke checks
npm run watch        # compile dist and test-build in watch mode only
npm run cli -- sync --cwd ./examples/basic
```

Use `npm run dev` for active package work. Use `npm run examples` for CI-like example smoke checks.
Npm task entrypoints live under `scripts/tasks/`; reusable helper scripts live directly under `scripts/`.

```bash
npm run db -- sync --cwd ./examples/basic
npm run db -- schema validate --cwd ./examples/basic
npm run db -- create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}' --cwd ./examples/basic
npm run examples
```

Use `npm run examples -- --tailscale-serve` only for local tailnet previews.
The default examples command remains loopback-only and does not configure
Tailscale.

The local REST server binds a loopback port. In sandboxed environments this may require explicit approval:

```bash
npm run db -- serve --cwd ./examples/basic
```

## Package Files Allowlist

`package.json` includes:

```txt
dist/**/*.js
dist/**/*.d.ts
!dist/**/*.test.js
examples/*/README.md
examples/*/example.json
examples/*/package.json
examples/*/db/**
examples/*/db.config.mjs
examples/*/src/**
docs/**/*.md
!docs/goals/**
db.config.example.mjs
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

Release pull requests and npm publication are handled by `.github/workflows/release.yml`.

- The Release Please job is opt-in behind the repository variable `RELEASE_PLEASE_CREATE_PR=true`. Keep it disabled when the organization blocks GitHub Actions from creating pull requests.
- When enabled, Release Please opens or updates a release PR with the next version, `package.json`, `.release-please-manifest.json`, and `CHANGELOG.md`.
- The tag path runs when a `v*.*.*` tag is pushed, or when the workflow is dispatched with an existing tag.
- The tag path validates that `package.json` matches the tag, runs `npm run release:check`, packs the package, publishes `@async/db` to npm when that exact version is not already present, creates the GitHub release if needed, and uploads the tarball.
- Rerunning a partially completed tag release is safe: if npm already has the package version, the workflow skips `npm publish` and still reconciles the GitHub release asset.

The release workflow uses npm Trusted Publishing through GitHub Actions OIDC. Before the first automated publish, configure npm for:

```txt
package: @async/db
owner/repo: async-framework/async-db
workflow: release.yml
environment: none
```

Keep the package public through `publishConfig.access: "public"` and the workflow publish command:

```bash
npm publish --access public
```

If Trusted Publishing is not configured yet, the release workflow can create the release PR and GitHub release, but npm publish will fail until npm trusts this repository and workflow.

If Trusted Publishing is not configured and the npm publish step fails, publish manually from an npm account with `@async` scope write access, then rerun the tag workflow to reconcile the GitHub release:

```bash
npm login --scope=@async --registry=https://registry.npmjs.org --auth-type=web
npm run release:check
npm pack
npm publish --access public async-db-<version>.tgz
```

## Tag Release

For a manual patch release, update `package.json`, `.release-please-manifest.json`, and `CHANGELOG.md`, then merge to `main` and tag the release commit:

```bash
git tag v<version>
git push origin v<version>
```

Use `NPM_CONFIG_USERCONFIG=/dev/null npm view @async/db version` when checking public npm visibility from this machine, because local npm user config may set conservative install cutoffs.

## Manual Release Checks

Use local scripts for preflight and emergency manual publish work:

```bash
npm run release:check
npm run release:pack
npm run release:publish
```

Prefer the GitHub workflow for normal releases so npm provenance is tied to the release commit.
