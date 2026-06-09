# @async/db Docs

This folder is **markdown only**. The public docs site lives in [`website/`](../website/) and loads selected pages from here through curated allowlists in [`website/db.schema.js`](../website/db.schema.js).

The root [README](../README.md) is the mini guide; these pages hold the task and contract details.

## Docs Site

- Preview locally: `npm run docs:dev` then open `http://127.0.0.1:7340/`
- Docs area: `http://127.0.0.1:7340/docs/getting-started.html`
- Examples browser: `http://127.0.0.1:7340/docs/examples.html` — every `examples/*` project in an IDE-style file viewer, ordered by complexity. Page content comes from each example's `example.json` (title, level, order) and the first paragraph of its README `## What This Teaches` section.
- Build static HTML: `npm run docs:build` writes to `website/dist/`
- CI publishes `website/dist/` to GitHub Pages via `.github/workflows/docs.yml`
- New markdown files in `docs/` do **not** auto-publish. Register the path in `website/db.schema.js` and add registry metadata there.
- Advanced pages live in `docs/advanced/*.md` and publish through the separate `advanced` collection in the same schema file.

## Advanced Settings Atlas

- [Overview](./advanced/overview.md): decision map for config, schema, stores, routes, operations, mocks, and generated output.
- [Configuration](./advanced/configuration.md): when defaults stop matching the app.
- [Schema contracts](./advanced/schema.md): infer first, then make contracts explicit.
- [Runtime stores](./advanced/runtime-stores.md): graduate one resource at a time.
- [Server routes](./advanced/server.md): REST as the local app contract.
- [Registered operations](./advanced/operations.md): reviewed callable refs instead of raw route exploration.
- [Mocking](./advanced/mocking.md): delay, errors, and schema-only seed records.
- [Generated files](./advanced/generated-files.md): what stays ignored and what can be committed.

## Start

- [Getting Started](./getting-started.md): install, first JSON file, sync, serve, viewer, REST call, and first schema.
- [Concepts](./concepts.md): data-first JSON files, schema-first resources, mixed resources, runtime stores, source writebacks, and product boundaries.
- [Examples](../examples/basic/README.md): runnable example READMEs are the authority for example-specific commands.

## Build Local Data

- [Data Files And Schemas](./data-files-and-schemas.md): JSON data files, schema files, `.schema.js`, Standard Schema validators, computed fields, source readers, nested folders, inference, and validation.
- [TypeScript Schema Sources](./typescript-schema-sources.md): JavaScript ESM schemas and TypeScript-authored schemas compiled to supported runtime files.
- [Generated Files](./generated-files.md): `.db/`, state, generated TypeScript, committed generated outputs, schema manifests, and cleanup rules.
- [Configuration](./configuration.md): `db.config.js`, data folder (`db/`), resource naming, strictness, registered operations, mock delay/errors, server options, and runtime fork boundaries.

## Go To Production

- [Production JSON Database](./json-production.md): scoped production use for `@async/db/json`, hard limits, operation boundaries, and mixed-store graduation.
- [Prototype To Production REST Guide](./prototype-to-production.md): move `/db/*` prototypes to `/api/db/*` or `/api/*`, registered operation refs, and route lockdown.
- [Resource Graduation And Mixed Stores](./store-graduation.md): move one resource from JSON to SQLite/Postgres/custom stores while preserving app-facing operations.
- [Fork And Branch Workflows](./fork-branch-workflows.md): tenants, debug copies, snapshots, branches, and resource migrations as app-owned workflows.
- [CMS Storage Patterns](./cms-storage-patterns.md): app-owned CMS draft/publish helpers over JSON files, SQLite indexes, Postgres, and static JSON outputs.

## Serve And Integrate

- [Server And Viewer](./server-and-viewer.md): REST routes, registered operations, GraphQL boundary, viewer, CSV import, watch behavior, batching, response formats, and local trust boundaries.
- [Prototype To Production REST Guide](./prototype-to-production.md): move `/db/*` prototypes to `/api/db/*` or `/api/*`, registered operation refs, and route lockdown.
- [Package API](./package-api.md): CLI commands, runtime API, HTTP client operations, schema/config helpers, and package export map.
- [Integrations](./integrations.md): Vite plugin, Hono route registration, SQLite starter generation, and optional dependency boundaries.
- [AI Agent Migration Playbook](./migration.md): agent runbook for detecting current `@async/db` usage, choosing migration depth, and using CLI inspection/import tooling.

## Maintain The Repo

- [Architecture](./architecture.md): source-to-runtime flow, implementation boundaries, generated outputs, and where to start for code changes.
- [CI And Release](./ci-and-release.md): verification commands, Node versions, package `files`, pack dry-run expectations, and release hygiene.
- [Product Spec](../SPEC.md): full product model and acceptance criteria.

## Documentation Rules

- Keep `docs/` markdown-only. Site code, HTML, and build tooling live in `website/`.
- Keep the root README short enough to scan.
- Keep deep behavior near the contract it belongs to.
- Keep examples runnable and focused.
- Prefer exact commands and repo-relative links.
- When adding generated output examples, state whether the output is normally committed.
- Publish a new guide page by adding `../docs/<page>.md` to the `pages` collection allowlist in `website/db.schema.js` and registry metadata in the same file.
- Publish a new advanced page by adding `docs/advanced/<page>.md` and an entry in `advancedRegistry` plus the `advanced` collection glob in `website/db.schema.js`.
- Keep `website/.db/` and `website/dist/` uncommitted.
