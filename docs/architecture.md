# @async/db Architecture

@async/db is a dependency-light Node.js ESM package. Fixture files become generated schema metadata, TypeScript types, runtime JSON state, and local API/viewer routes.

Use this page when deciding where behavior belongs in the implementation. Use [SPEC.md](../SPEC.md) for the full product and acceptance model.

## Main Flow

```txt
db/*.json, *.jsonc, *.csv, *.schema.json(c), *.schema.mjs, *.schema.js
  -> source readers
  -> resource schemas and diagnostics
  -> sync output
  -> .db/schema.generated.json
  -> .db/types/index.d.ts and optional committed generated files
  -> selected runtime store
  -> package API, REST, GraphQL, viewer, client, and generators
```

## Public Surfaces

| Surface | Entry point | Notes |
| --- | --- | --- |
| CLI | `src/cli.ts`, `src/cli/index.ts`, `src/cli/commands/` | `sync`, `types`, `schema`, `doctor`, `check`, `create`, `serve`, `generate hono`. |
| Runtime API | `src/index.ts`, `src/features/runtime/` | Collections, singleton documents, validation, and storage adapters. |
| Config API | `src/config-public.ts`, `src/config.d.ts` | `defineConfig`, manifest helpers, and user config shape. |
| Schema helpers | `src/schema-builders.ts`, `src/schema.d.ts` | `.schema.mjs` and `.schema.js` authoring helpers. |
| HTTP client | `src/client.ts` | REST, GraphQL, registered query operations, direct batching, automatic batching, fork support. |
| HTTP runtime | `src/runtime.ts`, `src/request-handler.ts`, `src/server.ts`, `src/rest/` | Shared db lifecycle, dependency-free middleware routes, local server binding, and response shaping. |
| GraphQL | `src/graphql/` | Dependency-free subset parser, executor, and HTTP handler. |
| Viewer | `src/web/` | Built-in UI served at `server.apiBase`, defaulting to `/__db`. |
| Vite integration | `src/vite.ts`, `src/integrations/` | Optional dev server plugin and virtual client. |
| JSON/Hono/SQLite/Postgres/KV | `src/json.ts`, `src/hono.ts`, `src/sqlite.ts`, `src/postgres.ts`, `src/kv.ts`, `src/redis.ts`, `src/generate/hono.ts` | First-party JSON file database surface, optional runtime integrations, injected-client stores, and generated starter output. |

## Core Boundaries

- Source discovery and loading live under `src/features/schema/sources.ts`. Built-in readers handle JSON, JSONC, CSV, and schema files; custom readers normalize into the same data/schema source shape.
- Field normalization, inference, relations, and resource construction live under `src/features/schema/`.
- Validation and diagnostics live under `src/features/schema/validation.ts` and nearby schema feature modules.
- Sync lives under `src/features/sync/`. It writes generated schema, generated types, optional schema manifests, source metadata, and hydrates runtime store state.
- Runtime storage lives under `src/features/storage/` and `src/features/runtime/`. The default and first-party file database store is JSON files under `.db/state`; memory, static, sourceFile, SQLite, Postgres, KV, Redis-like, and custom stores fit behind the same store boundary.
- Runtime lifecycle lives in `src/runtime.ts`: open db, sync or hydrate, reload, watch, lifecycle events, middleware composition, and cleanup. HTTP route matching lives in `src/request-handler.ts`; `src/server.ts` only binds the standalone Node server. REST routing lives in `src/rest/`, GraphQL lives in `src/graphql/`, and built-in viewer HTML/JS lives in `src/web/`.
- Optional graduation paths are separate from the core. Hono/SQLite starter generation lives in `src/generate/hono.ts` and `src/generate/hono/`; optional integrations live in `src/integrations/`.

## Start Here When Changing Behavior

| Change | Start with |
| --- | --- |
| Source discovery or custom readers | `src/features/schema/sources.ts` |
| Schema inference or field normalization | `src/features/schema/fields.ts`, `src/features/schema/resource.ts` |
| Schema validation or diagnostics | `src/features/schema/validation.ts` |
| Runtime store hydration or generated outputs | `src/features/sync/index.ts`, `src/types.ts`, `src/schema-manifest.ts` |
| Package runtime APIs | `src/features/runtime/collection.ts`, `src/features/runtime/document.ts`, `src/features/runtime/db.ts` |
| REST routes or response shaping | `src/rest/handler.ts`, `src/rest/shape.ts` |
| GraphQL parsing or execution | `src/graphql/parser.ts`, `src/graphql/execute.ts` |
| Built-in viewer behavior | `src/web/viewer.ts` |
| CLI behavior | `src/cli/index.ts`, `src/cli/commands/` |
| Hono/SQLite starter generation | `src/generate/hono.ts`, `src/generate/hono/` |
| Optional Hono integration | `src/hono.ts` |
| Optional SQLite adapter | `src/sqlite.ts` |
| Optional Postgres/KV/Redis-like stores | `src/postgres.ts`, `src/kv.ts`, `src/redis.ts`, `src/integrations/` |

## Generated Outputs

Default generated runtime output:

```txt
.db/schema.generated.json
.db/types/index.d.ts
.db/state/*.json
```

Normally `.db/` is uncommitted. Committed generated outputs are allowed only when configured, such as `outputs.committedTypes` or `outputs.schemaManifest`.

Examples that intentionally commit generated outputs:

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

See [Generated Files](./generated-files.md).

## Local Trust Model

- `async-db serve` binds to `127.0.0.1` by default and is intended for local development.
- `.schema.mjs` and `.schema.js` files execute as local project JavaScript. Treat them like source code, not untrusted data.
- `db.config.mjs`, source readers, format renderers, and manifest hooks also execute as local project code.
- The viewer CSV import endpoint writes CSV files into the configured `dbDir`.
- The default `json` store keeps source fixtures clean and writes app changes to `.db/state`.
- The `sourceFile` store may write generated ids back to plain `.json` source fixtures when configured intentionally.
- `.db/` is generated runtime output and should normally stay uncommitted.

## Verification

Before handing off changes:

```bash
npm run check
npm test
npm --cache /private/tmp/db-npm-cache pack --dry-run
```

See [CI And Release](./ci-and-release.md) for package and docs checks.
