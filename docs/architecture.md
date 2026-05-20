# jsondb Architecture

jsondb is a dependency-light Node.js ESM package. Fixture files become generated schema metadata, TypeScript types, runtime JSON state, and local API/viewer routes.

Use this page when deciding where behavior belongs in the implementation. Use [SPEC.md](../SPEC.md) for the full product and acceptance model.

## Main Flow

```txt
db/*.json, *.jsonc, *.csv, *.schema.json(c), *.schema.mjs
  -> source readers
  -> resource schemas and diagnostics
  -> sync output
  -> .jsondb/schema.generated.json
  -> .jsondb/types/index.ts and optional committed generated files
  -> .jsondb/state/*.json runtime mirror
  -> package API, REST, GraphQL, viewer, client, and generators
```

## Public Surfaces

| Surface | Entry point | Notes |
| --- | --- | --- |
| CLI | `src/cli.js`, `src/cli/index.js`, `src/cli/commands/` | `sync`, `types`, `schema`, `doctor`, `check`, `create`, `serve`, `generate hono`. |
| Runtime API | `src/index.js`, `src/features/runtime/` | Collections, singleton documents, validation, and storage adapters. |
| Config API | `src/config-public.js`, `src/config.d.ts` | `defineConfig`, manifest helpers, and user config shape. |
| Schema helpers | `src/schema-builders.js`, `src/schema.d.ts` | `.schema.mjs` authoring helpers. |
| HTTP client | `src/client.js` | REST, GraphQL, direct batching, automatic batching, fork support. |
| REST server | `src/server.js`, `src/rest/` | Dependency-free local routes and response shaping. |
| GraphQL | `src/graphql/` | Dependency-free subset parser, executor, and HTTP handler. |
| Viewer | `src/web/` | Built-in UI served at `/__jsondb`. |
| Vite integration | `src/vite.js`, `src/integrations/` | Optional dev server plugin and virtual client. |
| Hono/SQLite | `src/hono.js`, `src/sqlite.js`, `src/generate/hono.js` | Optional runtime integration and generated starter output. |

## Core Boundaries

- Source discovery and loading live under `src/features/schema/sources.js`. Built-in readers handle JSON, JSONC, CSV, and schema files; custom readers normalize into the same data/schema source shape.
- Field normalization, inference, relations, and resource construction live under `src/features/schema/`.
- Validation and diagnostics live under `src/features/schema/validation.js` and nearby schema feature modules.
- Sync lives under `src/features/sync/`. It writes generated schema, generated types, optional schema manifests, source metadata, and runtime mirror state.
- Runtime storage lives under `src/features/storage/` and `src/features/runtime/`. The default runtime is the JSON mirror; memory, static, source-backed, SQLite, and future adapters fit behind the runtime boundary.
- HTTP serving starts in `src/server.js`. REST routing lives in `src/rest/`, GraphQL lives in `src/graphql/`, and built-in viewer HTML/JS lives in `src/web/`.
- Optional graduation paths are separate from the core. Hono/SQLite starter generation lives in `src/generate/hono.js` and `src/generate/hono/`; optional integrations live in `src/integrations/`.

## Start Here When Changing Behavior

| Change | Start with |
| --- | --- |
| Source discovery or custom readers | `src/features/schema/sources.js` |
| Schema inference or field normalization | `src/features/schema/fields.js`, `src/features/schema/resource.js` |
| Schema validation or diagnostics | `src/features/schema/validation.js` |
| Runtime mirror sync or generated outputs | `src/features/sync/index.js`, `src/types.js`, `src/schema-manifest.js` |
| Package runtime APIs | `src/features/runtime/collection.js`, `src/features/runtime/document.js`, `src/features/runtime/db.js` |
| REST routes or response shaping | `src/rest/handler.js`, `src/rest/shape.js` |
| GraphQL parsing or execution | `src/graphql/parser.js`, `src/graphql/execute.js` |
| Built-in viewer behavior | `src/web/viewer.js` |
| CLI behavior | `src/cli/index.js`, `src/cli/commands/` |
| Hono/SQLite starter generation | `src/generate/hono.js`, `src/generate/hono/` |
| Optional Hono integration | `src/hono.js` |
| Optional SQLite adapter | `src/sqlite.js` |

## Generated Outputs

Default generated runtime output:

```txt
.jsondb/schema.generated.json
.jsondb/types/index.ts
.jsondb/state/*.json
```

Normally `.jsondb/` is uncommitted. Committed generated outputs are allowed only when configured, such as `types.commitOutFile` or `schemaOutFile`.

Examples that intentionally commit generated outputs:

```txt
examples/advanced/src/generated/jsondb.types.ts
examples/basic/src/generated/jsondb.types.ts
examples/schema-first/src/generated/jsondb.types.ts
examples/schema-manifest/src/generated/jsondb.schema.json
examples/schema-manifest/src/generated/jsondb.types.ts
examples/schema-ui/src/generated/jsondb.schema.json
examples/schema-ui/src/generated/jsondb.types.ts
```

See [Generated Files](./generated-files.md).

## Local Trust Model

- `jsondb serve` binds to `127.0.0.1` by default and is intended for local development.
- `.schema.mjs` files execute as local project JavaScript. Treat them like source code, not untrusted data.
- `jsondb.config.mjs`, source readers, format renderers, and manifest hooks also execute as local project code.
- The viewer CSV import endpoint writes CSV files into the configured `dbDir`.
- `mode: 'mirror'` keeps source fixtures clean and writes app changes to `.jsondb/state`.
- `mode: 'source'` may write generated ids back to plain `.json` source fixtures when configured intentionally.
- `.jsondb/` is generated runtime output and should normally stay uncommitted.

## Verification

Before handing off changes:

```bash
npm run check
npm test
npm --cache /private/tmp/jsondb-npm-cache pack --dry-run
```

See [CI And Release](./ci-and-release.md) for package and docs checks.
