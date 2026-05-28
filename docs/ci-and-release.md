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

```bash
node ./src/cli.js sync --cwd ./examples/basic
node ./src/cli.js schema validate --cwd ./examples/basic
node ./src/cli.js create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}' --cwd ./examples/basic
npm run examples
```

The local REST server binds a loopback port. In sandboxed environments this may require explicit approval:

```bash
node ./src/cli.js serve --cwd ./examples/basic
```

## Package Files Allowlist

`package.json` includes:

```txt
src/**/*.js
src/**/*.d.ts
scripts
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
examples/advanced/src/generated/db.types.ts
examples/basic/src/generated/db.types.ts
examples/schema-first/src/generated/db.types.ts
examples/schema-manifest/src/generated/db.schema.json
examples/schema-manifest/src/generated/db.types.ts
examples/schema-ui/src/generated/db.schema.json
examples/schema-ui/src/generated/db.types.ts
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

- Every push to `main` runs Release Please.
- After `0.1.0`, Release Please opens or updates a release PR with the next version, `package.json`, `.release-please-manifest.json`, and `CHANGELOG.md`.
- Merging a release PR creates the GitHub release.
- When a Release Please release is created, the same workflow checks out the release commit, runs `npm run release:check`, packs the package, publishes `@async/db` to npm, and uploads the tarball to the GitHub release.
- The first `0.1.0` release is seeded in `.release-please-manifest.json`; publish it by pushing the existing `v0.1.0` tag, or by running the `Release` workflow manually with `v0.1.0` after the tag exists.

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

## First Release

The first public package version is already recorded as `0.1.0` in `package.json`, `CHANGELOG.md`, and `.release-please-manifest.json`. After npm Trusted Publishing is configured:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The tag publish path validates that the tag matches `package.json`, runs `npm run release:check`, publishes the tarball, creates the GitHub release if needed, and uploads the tarball as a release asset.

## Manual Release Checks

Use local scripts for preflight and emergency manual publish work:

```bash
npm run release:check
npm run release:pack
npm run release:publish
```

Prefer the GitHub workflow for normal releases so npm provenance is tied to the release commit.
