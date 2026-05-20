# @async/db Docs

This folder is the durable markdown manual for @async/db. The root [README](../README.md) is the mini guide; these pages hold the task and contract details.

## Start

- [Getting Started](./getting-started.md): install, first fixture, sync, serve, viewer, REST call, and first schema.
- [Concepts](./concepts.md): data-first fixtures, schema-first fixtures, mixed resources, runtime stores, source writebacks, and product boundaries.
- [Examples](../examples/basic/README.md): runnable example READMEs are the authority for example-specific commands.

## Build Local Data

- [Fixtures And Schemas](./fixtures-and-schemas.md): JSON, JSONC, CSV, schema files, `.schema.mjs`, source readers, nested folders, inference, and validation.
- [Generated Files](./generated-files.md): `.db/`, state, generated TypeScript, committed generated outputs, schema manifests, and cleanup rules.
- [Configuration](./configuration.md): `db.config.mjs`, fixture folders, resource naming, strictness, mock delay/errors, server options, and forks.
- [Schema UI example](../examples/schema-ui/README.md): manifest-driven CMS HTML with **`serve.mjs`** SSR from live mirror rows (`node ./examples/schema-ui/serve.mjs`).

## Serve And Integrate

- [Server And Viewer](./server-and-viewer.md): REST routes, GraphQL boundary, viewer, CSV import, watch behavior, batching, response formats, and local trust boundaries.
- [Package API](./package-api.md): CLI commands, runtime API, HTTP client, schema/config helpers, and package export map.
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
