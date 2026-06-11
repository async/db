# API Surface Ledger

This file is the review anchor for public `@async/db` contracts. It is a
current-state ledger, not a changelog or tutorial. For usage examples, see
[docs/package-api.md](./docs/package-api.md).

## Review Rule

When a change touches a public contract, inspect `git diff` for the matching
surface below and update this file when the contract changes. If no update is
needed, the review should be able to say why. `npm run api-surface:check`
enforces the review rule by failing when watched public-surface files changed
without an `API_SURFACE.md` diff.

| If this changes | Inspect these diffs |
| --- | --- |
| Package exports, import paths, or declaration names | `package.json`, `src/index.ts`, `src/*.d.ts`, `test/package/exports.test.ts` |
| CLI commands, flags, output, or exit behavior | `src/cli/**`, `src/cli.js`, CLI tests, `README.md`, `docs/package-api.md` |
| Runtime package behavior | `src/features/runtime/**`, `src/db.ts`, `src/runtime.ts`, package API tests |
| REST, GraphQL, operations, Falcor, viewer, or manifest routes | `src/rest/**`, `src/graphql/**`, `src/operations.ts`, `src/falcor/**`, `src/web/**`, `src/server.ts`, route tests |
| Generated types, schemas, manifests, or operation refs | `src/types.ts`, `src/schema-manifest.ts`, `src/viewer-manifest.ts`, `src/features/sync/**`, sync and package tests |
| Config keys or defaults | `src/features/config/**`, `src/config*.ts`, `db.config.example.js`, `docs/configuration.md`, config tests |

## Package Exports

| Import | Runtime file | Types file | Stability | Notes |
| --- | --- | --- | --- | --- |
| `@async/db` | `./dist/index.js` | `./dist/index.d.ts` | stable | Root package API for runtime, schema, server, sync, generated output, operations, and helper functions. |
| `@async/db/schema` | `./dist/schema-builders.js` | `./dist/schema.d.ts` | stable | Schema authoring helpers: `collection`, `document`, `field`, `field.derived`, and `files`. |
| `@async/db/config` | `./dist/config-public.js` | `./dist/config.d.ts` | stable | Public config helper surface, including `defineConfig`. |
| `@async/db/client` | `./dist/client.js` | `./dist/index.d.ts` | stable | Tiny HTTP client, REST/GraphQL calls, batching, and browser cache helpers. |
| `@async/db/json` | `./dist/json.js` | `./dist/json.d.ts` | stable | First-party JSON store helpers and JSON state utilities. |
| `@async/db/hono` | `./dist/hono.js` | `./dist/hono.d.ts` | preview | Optional Hono integration. Hono stays an app dependency, not a required package dependency. |
| `@async/db/sqlite` | `./dist/sqlite.js` | `./dist/sqlite.d.ts` | preview | Optional SQLite adapter using dynamic `node:sqlite` support. |
| `@async/db/sqlite/compat` | `./dist/sqlite-compat.js` | `./dist/sqlite-compat.d.ts` | preview | Low-level SQLite driver adapters and explicit legacy import helpers for migration bridges. |
| `@async/db/postgres` | `./dist/postgres.js` | `./dist/postgres.d.ts` | preview | Optional Postgres adapter boundary for Async DB-owned envelope storage and existing table mapping. |
| `@async/db/postgres/compat` | `./dist/postgres-compat.js` | `./dist/postgres-compat.d.ts` | preview | Low-level Postgres driver adapters and explicit legacy import helpers for migration bridges. |
| `@async/db/kv` | `./dist/kv.js` | `./dist/kv.d.ts` | preview | Optional generic KV store adapter boundary. |
| `@async/db/redis` | `./dist/redis.js` | `./dist/redis.d.ts` | preview | Optional Redis-like store adapter boundary. |
| `@async/db/vite` | `./dist/vite.js` | `./dist/vite.d.ts` | preview | Optional Vite integration surface. |

## CLI Surface

The public binary is `async-db`. Global flags include `--cwd <dir>` and
`--config <file>` where supported by the command.

| Command | Stability | Contract |
| --- | --- | --- |
| `async-db init [--template data-first\|schema-first\|source-file\|content] [--dry-run] [--json]` | stable | Scaffold the smallest valid local project shape (the `content` template scaffolds a db/ contract sourcing repo-level docs/ markdown), optionally patch package scripts, and run the first sync. |
| `async-db sync` | stable | Load sources, validate/infer schema, write generated metadata/types, and refresh runtime state. |
| `async-db types [--watch] [--out <file>]` | stable | Generate TypeScript declarations, optionally in watch mode or to an explicit path. |
| `async-db schema [resource]` | stable | Print schema metadata for all resources or one resource. |
| `async-db schema infer [resource] [--out <file>]` | stable | Infer schema from data files and optionally write it. |
| `async-db schema validate` | stable | Validate schema and source data diagnostics. |
| `async-db schema manifest [--out <file>]` | generated | Render the schema manifest contract. |
| `async-db schema unbundle ...` / `async-db schema bundle ...` | preview | Move between aggregate schema and per-resource schema files. |
| `async-db schema migrate inspect [target] [--format mixed\|jsonc] [--schema-dir <dir>] [--json] [--out <file>] [--check <file>]` | preview | Inspect existing Prisma, Drizzle, SQL, JSON Schema/OpenAPI, and validator declarations and emit a review-first `db.schemaMigrationReport`. |
| `async-db schema migrate generate --plan <report.json> [--schema-dir <dir>] [--format mixed\|jsonc] [--force]` | preview | Generate Async DB `.schema.jsonc` drafts, or `.schema.js` drafts in mixed mode when executable validator behavior needs manual preservation. |
| `async-db operations build [--out <file>] [--refs-out <file>]` | stable | Build operation registry and client-safe operation refs. |
| `async-db operations contract [--out <file>] [--check]` | stable | Write or check the client operation contract. |
| `async-db usage scan [target] [--json] [--out <file>] [--check <file>] [--production]` | preview | Scan app source text for @async/db usage and emit a `db.usageManifest`. |
| `async-db integrate inspect [target] --sqlite <file> [--target-state <file>] [--json] [--out <file>] [--check <file>]` | preview | Inspect an existing SQLite app without mutating it, emit wrapper-first adoption guidance, and optionally include an explicit import-to-Async-DB-state plan. |
| `async-db integrate inspect [target] --postgres [--postgres-url-env <env>] [--schema <schema>] [--target-postgres-table <schema.table>] [--target-state <file>] [--allow-partial] [--exact-row-counts] [--json] [--out <file>] [--check <file>]` | preview | Inspect Postgres source usage and optional read-only catalog metadata, emit wrapper-first adoption guidance, and optionally include an explicit import plan. |
| `async-db integrate generate importer --plan <report.json> --out <file>` | preview | Generate a dry-run legacy SQLite or Postgres importer from an integration report import plan. |
| `async-db viewer manifest [--out <file>]` | generated | Render the viewer manifest contract. |
| `async-db doctor [--strict] [--json] [--production] [--usage [target]]` | stable | Report schema/data drift, production-readiness guidance, and opt-in usage findings. |
| `async-db check [--strict] [--json] [--production] [--usage [target]]` | stable | CI-oriented alias for doctor/check behavior. |
| `async-db create <collection> <json>` | stable | Create one record through the package runtime path. |
| `async-db promote <resource> [--store json\|file\|<registered>] [--fsync always\|everysec\|no] [--dry-run]` | preview | Zero-to-production ceremony: capture inferred schema, pin the seed hash, choose the engine and WAL fsync policy, and record it all in `db.lifecycle.jsonc`. |
| `async-db status [--json]` | preview | Derived lifecycle phase per resource (draft / production (engine)), durability, seed pin and drift state, and the next verb. |
| `async-db reseed <resource> --force` | preview | Deliberately re-apply the seed file to live state and re-pin its hash. |
| `async-db backup [--out <file>]` | preview | Bundle every resource's JSON state (plus content hashes) into one backup file and record backup recency for `doctor --production`. |
| `async-db restore <resource> [--list] [--version <id\|latest>]` | preview | List or roll back a resource's version snapshots; restores snapshot the current contents first so they are undoable. |
| `async-db restore --from <backup.json> [--resource <name>] [--dry-run]` | preview | Restore resource state from a backup bundle, snapshotting current state per resource before overwriting. |
| `async-db serve [--host <host>] [--port <port>]` | dev-only | Start the local writable development API and viewer. |
| `async-db generate hono [--out <dir>] [--api <targets>] [--app <shape>]` | preview | Generate a Hono/SQLite starter from the current contract. |

## Runtime And Integration APIs

| Surface | Stability | Public contract |
| --- | --- | --- |
| Runtime database | stable | `openDb`, `Db`, collection APIs including `find`, `count`, `aggregate`, and `append`, document APIs, forks, branches, snapshots, migrations, and `close`. Collection `update`/`patch`/`delete` and document `put`/`update` accept an optional `{ ifMatch }` precondition that fails with 412 `DB_PRECONDITION_FAILED` when the stored value's ETag no longer matches; `recordEtag(value)` computes the matching tag. |
| Runtime lifecycle | stable | `createDbRuntime`, `reloadDb`, `watchDbSources`, and `createDbRequestHandler` for custom local servers. |
| Schema loading | stable | `loadDbSchema`, validators, computed field resolvers, metadata-only loading, and schema locator support. |
| Schema authoring | stable | `@async/db/schema` helpers for collection/document/field/files authoring in trusted local schema files, including `field.derived(...)` for database- or externally-owned read-only values that Async DB documents but does not compute. |
| Schema declaration migration | preview | `inspectSchemaMigration`, `DbSchemaMigrationReport`, `DbSchemaMigrationResource`, `DbSchemaMigrationField`, `DbSchemaMigrationSuggestion`, and `DbSchemaMigrationOutputPlan` support review-first conversion from existing schema declarations into Async DB schema drafts. |
| HTTP client | stable | `createDbClient`, direct REST/GraphQL calls, automatic batching, dedupe, and cache options. |
| JSON store | stable | `jsonStore`, `fileStorage`, JSON state helpers, capabilities, and atomic/write-lock helpers exported from `@async/db/json`. Atomic writes fsync file contents (and best-effort the directory) before publishing. `withJsonStateWrite` accepts `JsonStateWriteOptions` and guards writes with an on-disk advisory lock by default on the real filesystem; a held lock fails with 503 `JSON_STATE_LOCKED` after `lockTimeoutMs`. |
| JSON WAL durability | preview | `durability: 'wal'` (on `stores.json`, `stores.sourceFile`, or `jsonStore()` options) acknowledges writes through a hidden per-resource JSONL write-ahead log with `fsync: 'always' \| 'everysec' \| 'no'`, then checkpoints the pretty canonical file (debounced `checkpointMs`, default 250ms; forced at `maxWalEntries`). Reads and boot replay the log tail; log generations are hash-bound to their checkpoint so hand-edited files supersede stale logs. WAL + encryption is rejected (`JSON_WAL_ENCRYPTION_UNSUPPORTED`). Adapters expose optional `writeResourceDelta(resource, value, delta)` for O(change) acknowledgment. |
| Content watch roots | preview | `files()` resources record resolved glob roots (`watchRoots`); `serve` watches roots outside the data folder so external markdown/content edits hot-reload. `status` shows static-store resources as `content (files)` with no promotion nudge. |
| MDX component contract | preview | `files(patterns, { read: 'mdx', components: [...] })` parses frontmatter like `read: 'frontmatter'` plus a dependency-free body scan that emits `components`, `imports`, and `exports` string-array fields on every record (auto-declared on schemas that declare fields). With a `components` allow-list, a doc using an unregistered capitalized JSX tag fails sync with `CONTENT_COMPONENT_NOT_ALLOWED` (doc-local imports/exports are allowed automatically; allowing `Tabs` permits `Tabs.Item`). Without the list the scan is inventory-only. A `components` list on a non-mdx read warns `CONTENT_COMPONENTS_IGNORED`. Async DB never imports an MDX compiler. |
| Lifecycle file | preview | `db.lifecycle.jsonc` is machine-managed (promote/reseed), committed, merged by `loadConfig` under user config, and exposed as `config.lifecycle`. Pinned `seedHash` stops sync from auto-reseeding live state past promotion. |
| JSON versioned durability | preview | `durability: 'versioned'` (on `jsonStore()` options or `stores.json` config) snapshots previous state into `.versions/<resource>/` per write, pruned to `maxVersions` (default 10). `atomicWriteJsonVersioned`, `listJsonStateVersions`, `restoreJsonStateVersion`, `jsonStateVersionsDir`, and `DEFAULT_MAX_JSON_STATE_VERSIONS` are exported from `@async/db/json`; unknown versions fail with `JSON_STATE_VERSION_NOT_FOUND`. |
| JSON crash recovery | preview | `recoverJsonStateDir` (also run automatically at hydrate) removes orphaned atomic-write temp files and dead-owner locks. Corrupt state files are quarantined to `<file>.corrupt-<ts>` and the newest version snapshot is restored when one exists; recovery emits `ASYNC_DB_STATE_RECOVERY` process warnings instead of failing boot. |
| JSON encryption at rest | preview | `jsonStore({ encryption: { key } })` seals state files with AES-256-GCM (32-byte key or SHA-256-derived passphrase). Plaintext files read transparently and seal on next write; wrong keys fail with `JSON_ENCRYPTION_FAILED`, missing keys with `JSON_ENCRYPTION_KEY_REQUIRED`. |
| JSON object storage | experimental | `s3Storage` is a declarative descriptor only; the built-in runtime has no S3 backend yet and selecting it fails with `JSON_STORAGE_BACKEND_UNAVAILABLE`. |
| Audit trail | preview | `resources.<name>.audit: true \| { values: true }` appends one JSON line per successful runtime write to `.audit/<resource>.jsonl` beside the resource state (op, id, changed fields; values opt-in). Audit failures warn (`ASYNC_DB_AUDIT_FAILED`) and never fail the data write. |
| Memory filesystem | stable | `createMemoryFs` for tests and programmatic schema/runtime loading. |
| Operations | stable | Operation manifests, registered operation handlers, refs, hashing, and readiness checks. |
| SQLite inspection | preview | `inspectSqliteIntegration`, `DbSqliteIntegrationReport`, report suggestions, adoption paths, driver hints, and optional import plans for wrapper-first SQLite adoption or explicit import planning. |
| Postgres inspection | preview | `inspectPostgresIntegration`, `DbPostgresIntegrationReport`, catalog/source modes, report suggestions, adoption paths, driver hints, redacted URL env reporting, and optional import plans for wrapper-first Postgres adoption or explicit import planning. |
| Hono integration | preview | Optional route registration and lifecycle hooks exported from `@async/db/hono`. |
| Vite integration | preview | Optional Vite plugin/config surface exported from `@async/db/vite`. |
| SQLite integration | preview | `sqliteStore` is Async DB-owned SQLite storage; `openSqliteDb({ tables })` maps resources to existing tables, supports read-only/no-migrate mode, table/column mappings, injected handles, and compound object-key reads/writes. |
| SQLite compat | preview | `adaptSqliteDatabase`, `openCompatSqlite`, `openLegacySqlite`, `compoundKeyId`, `defineSqliteImportPlan`, and `runSqliteImportPlan` bridge low-level `node:sqlite`, `better-sqlite3`, `sqlite3`, and `sqlite` handles without making raw SQL the app-facing API. Async DB suppresses only the optional `node:sqlite` experimental warning while loading that driver so CLI reports keep stdout/stderr stable on Node.js 22. |
| Postgres integration | preview | `postgresStore` is Async DB-owned JSONB envelope storage; `openPostgresDb({ tables })` maps resources to existing relational tables, supports read-only/no-migrate mode, table/column mappings, injected clients, append-only tables, and compound object-key reads/writes. |
| Postgres compat | preview | `adaptPostgresClient`, `openCompatPostgres`, `openLegacyPostgres`, `compoundKeyId`, `definePostgresImportPlan`, and `runPostgresImportPlan` bridge low-level `pg`, `postgres`, Neon, Vercel Postgres, and `pg-promise` clients without making raw SQL the app-facing API. Driver packages remain optional app dependencies. |
| Optional stores | preview | SQLite, Postgres, KV, and Redis-like store adapter helpers remain optional integration surfaces. |

## HTTP Surface

| Surface | Stability | Public contract |
| --- | --- | --- |
| Root discovery | dev-only | `GET /` returns HTML or JSON discovery links depending on request headers. |
| REST resources | stable | Resource routes under `/db` by default, with JSON collection/document reads and writes. Single-record GET/PATCH and document GET/PUT/PATCH responses carry an `ETag` header; item-level PATCH/DELETE and document PUT/PATCH honor `If-Match` and answer 412 `DB_PRECONDITION_FAILED` on mismatch. Bulk routes ignore `If-Match`. Collection list, single-record, and document GETs honor `If-None-Match` and answer 304 when the stored value is unchanged. |
| Health probe | preview | `GET <apiBase>/health` returns 200 `{ status: "ok", ... }` with uptime, schema version, resource/diagnostic counts, and a cached state-dir writability probe; 503 `degraded` when the state dir is not writable. Controlled by `server.expose.health` (default open, independent of viewer exposure) and exempt from mock behavior. |
| Authorization hook | preview | `server.authorize(context)` runs once per db-handled request (REST, viewer, schema, manifest, GraphQL, Falcor, events, health, operations) with `{ request, url, method, route }`. `false` answers 403 `SERVER_AUTHORIZATION_DENIED`; `{ status, body }` sends a custom denial; hook errors answer 500 `SERVER_AUTHORIZE_ERROR`. Requests that fall through to app routes never reach the hook. |
| REST batching | stable | Client-facing batch requests preserve per-item result shape and errors. |
| GraphQL | stable | Dependency-free GraphQL subset for queries, mutations, aliases, variables, batching, and introspection. |
| Operations routes | stable | Registered operation execution and client-safe operation ref boundaries. |
| Falcor records | preview | Falcor-compatible record route support where enabled. |
| Viewer app | dev-only | Built-in local viewer under `/__db` by default. |
| Viewer events | dev-only | `GET /__db/events` server-sent events stream with a 30s keep-alive comment ping; subscriptions beyond `server.maxEventClients` (default 100) answer 503 `VIEWER_EVENTS_LIMIT`. |
| Viewer manifest | generated | `/__db/manifest.json`, `/__db/manifest.html`, `/__db/manifest.md`, and negotiated `/__db/manifest`. |
| Server exposure settings | stable | Config decides which REST/GraphQL/operations/viewer surfaces are exposed, including registered-only modes. |

`async-db serve` is a local development server. Production-facing apps should put
traffic behind app-owned auth, authorization, limits, observability, and
registered operations or app routes.

## Generated Contracts

| Output | Stability | Contract |
| --- | --- | --- |
| `.db/types/index.d.ts` | generated | Default generated TypeScript declarations; normally gitignored. |
| `types.commitOutFile` output | generated | Optional committed generated type copy for app/CI imports. |
| `.db/schema.generated.json` | generated | Generated schema metadata used by tooling and runtime workflows. |
| `schemaOutFile` / `outputs.schemaManifest` | generated | Optional committed schema manifest. |
| `viewerManifestOutFile` / `outputs.viewerManifest` | generated | Optional committed viewer manifest for custom viewers/tools. |
| `operations.build` outputs | generated | Server operation registry and client-safe refs/contracts. |
| `usage scan` output | generated | Optional `db.usageManifest` source-scan artifact for endpoint exposure review. |
| `integrate inspect` output | generated | Optional `db.integrationReport` artifact for SQLite/Postgres wrapper-first adoption guidance and explicit import plans. |
| `schema migrate inspect` output | generated | Optional `db.schemaMigrationReport` artifact for review-first schema declaration conversion into Async DB schema drafts. |
| `.db/state/**` | internal | Runtime mirror state; generated and normally uncommitted. |

Generated files are public only through their documented output contracts. The
contents of `.db/state/**`, source hashes, runtime paths, and store-private
metadata are not public API.

## Config Surface

| Config group | Stability | Public contract |
| --- | --- | --- |
| `outputs` | stable | Preferred generated output locations for state, types, manifests, operations, and generated starter code. |
| `types` | stable | Generated TypeScript options such as output paths, committed copy, comments, readonly properties, and runtime helper exports. |
| `schema` | stable | Schema validation/inference options, unknown-field policy, and schema behavior toggles. |
| `server` | stable | Host/port/base path, route exposure (including `expose.health`), trace, watcher, viewer, `maxEventClients`, `authorize` hook, and local server behavior. |
| `rest`, `graphql`, `falcor` | stable | Protocol exposure and request/response behavior toggles. REST is enabled by default; GraphQL and Falcor are opt-in (`enabled: false` by default). |
| `operations` | stable | Registered operation registry, refs, contract output, source directory, accept-ref policy, and opt-in strict readiness. |
| `lifecycle` (via `db.lifecycle.jsonc`) | preview | Machine-managed promotion facts: per-resource phase/store/seedHash and store durability defaults. Doctor adds `DOCTOR_DRAFT_IN_PRODUCTION` (error) and `DOCTOR_SEED_DRIFT` (warn). |
| `mock` | stable | Local mock delay/error behavior. Skipped automatically under `NODE_ENV=production` unless `mock.production: true` opts in; `doctor --production` reports both states. |
| `stores` | preview | Store factory configuration and optional adapter selection. |
| `resources` / `collections` | stable | Per-resource schema, source, store, route, validation, defaults, relation, append-only `writePolicy`, opt-in `audit`, and UI metadata. |
| `stores.json` durability | preview | `durability: 'versioned'` and `maxVersions` switch the default JSON store to snapshot-keeping writes. |
| `defaults` / `seed` | stable | Default application and seed/hydration behavior. |

## Internal Boundaries

| Boundary | Stability | Rule |
| --- | --- | --- |
| `src/features/**` modules | internal | Implementation detail unless re-exported from a package export and covered by declarations/docs. |
| `src/rest/**`, `src/graphql/**`, `src/web/**` internals | internal | Route behavior is public; helper module paths and internal function names are not. |
| `.db/state/**` | internal | Runtime mirror output; do not commit or treat as an app import surface. |
| `.db/**` except documented generated files | internal | Generated runtime workspace; only documented generated contracts are public. |
| Source hashes and state metadata | internal | Used for refresh and runtime bookkeeping, not app contracts. |
| Test helpers, scripts, and examples internals | internal | Runnable examples and documented hooks are public; private helper paths are not. |
| Trusted local code execution | internal | `.schema.js`, `db.config.js`, source readers, and manifest hooks execute locally and are not sandboxed public API. |
