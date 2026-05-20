# CI And Release

This page documents the verification and package checks that keep docs, examples, and generated-file policy honest.

## Supported Node Versions

The package supports Node.js 20 and newer.

CI runs on Node.js 20, 22, and 24 through `.github/workflows/ci.yml`.

Generated Hono/SQLite standalone apps may require newer Node versions because SQLite output uses `node:sqlite`.

## Required Verification

Run these before handing off changes:

```bash
npm run check
npm test
npm pack --dry-run
```

If the default npm cache has ownership or permission issues on this machine, use a temp cache for the pack check:

```bash
npm --cache /private/tmp/jsondb-npm-cache pack --dry-run
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
examples/*/jsondb.config.mjs
examples/*/src/**
docs/**/*.md
jsondb.config.example.mjs
CHANGELOG.md
README.md
SPEC.md
```

Docs restructuring affects the published package because `docs/**/*.md` is included. Use `npm pack --dry-run` to confirm the tarball contains the expected docs and does not include generated runtime output.

## Generated Runtime Output

Generated `.jsondb/` output should normally stay uncommitted.

Committed generated files are allowed when configured:

```txt
examples/advanced/src/generated/jsondb.types.ts
examples/basic/src/generated/jsondb.types.ts
examples/schema-first/src/generated/jsondb.types.ts
examples/schema-manifest/src/generated/jsondb.schema.json
examples/schema-manifest/src/generated/jsondb.types.ts
examples/schema-ui/src/generated/jsondb.schema.json
examples/schema-ui/src/generated/jsondb.types.ts
```

If a smoke command writes `.jsondb/` inside an example, remove that generated runtime state before finalizing unless the task explicitly asks to commit it.

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
