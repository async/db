# @async/db Docs

This folder is the durable markdown manual for @async/db. The root [README](../README.md) is the mini guide; these pages hold the task and contract details.

## Start

- [Getting Started](./getting-started.md): install, first fixture, sync, serve, viewer, REST call, and first schema.
- [Concepts](./concepts.md): data-first fixtures, schema-first fixtures, mixed resources, runtime stores, source writebacks, and product boundaries.
- [Examples](../examples/basic/README.md): runnable example READMEs are the authority for example-specific commands.

## Build Local Data

- [Fixtures And Schemas](./fixtures-and-schemas.md): JSON, JSONC, CSV, schema files, `.schema.js`, Standard Schema validators, computed fields, source readers, nested folders, inference, and validation.
- [TypeScript Schema Sources](./typescript-schema-sources.md): JavaScript ESM schemas and TypeScript-authored schemas compiled to supported runtime files.
- [Generated Files](./generated-files.md): `.db/`, state, generated TypeScript, committed generated outputs, schema manifests, and cleanup rules.
- [Configuration](./configuration.md): `db.config.mjs`, fixture folders, resource naming, strictness, registered operations, mock delay/errors, server options, and forks.
- [Production JSON Database](./json-production.md): scoped production use for `@async/db/json`, hard limits, operation boundaries, and mixed-store graduation.
- [Resource Graduation And Mixed Stores](./store-graduation.md): move one resource from JSON to SQLite/Postgres/custom stores while preserving app-facing operations.
- [Schema UI example](../examples/schema-ui/README.md): manifest-driven CMS HTML with **`serve.mjs`** SSR from live mirror rows (`node ./examples/schema-ui/serve.mjs`).

## Serve And Integrate

- [Server And Viewer](./server-and-viewer.md): REST routes, registered operations, GraphQL boundary, viewer, CSV import, watch behavior, batching, response formats, and local trust boundaries.
- [Prototype To Production REST Guide](./prototype-to-production.md): move `/db/*` prototypes to `/api/db/*` or `/api/*`, registered operation refs, and route lockdown.
- [Package API](./package-api.md): CLI commands, runtime API, HTTP client operations, schema/config helpers, and package export map.
- [Integrations](./integrations.md): Vite plugin, Hono route registration, SQLite starter generation, and optional dependency boundaries.

## Maintain The Repo

- [Architecture](./architecture.md): source-to-runtime flow, implementation boundaries, generated outputs, and where to start for code changes.
- [CI And Release](./ci-and-release.md): verification commands, Node versions, package `files`, pack dry-run expectations, and release hygiene.
- [Product Spec](../SPEC.md): full product model and acceptance criteria.

## Documentation Rules

- Keep the root README short enough to scan.
- Keep deep behavior near the contract it belongs to.
- Keep examples runnable and focused.
- Prefer exact commands and repo-relative links.
- When adding generated output examples, state whether the output is normally committed.
