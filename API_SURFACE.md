# @async/db API Surface Ledger

This file is the generated review ledger for semantic API contract features. It is current-state contract documentation, not a changelog or tutorial.

## Async DB Package Exports

Contract: `@async/db.package`

### Exports

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `export.client` | @async/db/client tiny HTTP client, REST and GraphQL calls, batching, and cache helpers | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |
| `export.config` | @async/db/config defineConfig public config helper | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/configuration.md) |
| `export.hono` | @async/db/hono optional Hono integration without required Hono dependency | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/integrations.md) |
| `export.json` | @async/db/json JSON store helpers, state utilities, WAL, versioning, recovery, and encryption | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |
| `export.kv` | @async/db/kv optional generic KV store adapter boundary | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |
| `export.postgres` | @async/db/postgres optional Postgres JSONB envelope storage and existing table mapping | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/integrations.md) |
| `export.postgres.compat` | @async/db/postgres/compat low-level Postgres driver adapters and legacy bridges | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/integrations.md) |
| `export.redis` | @async/db/redis optional Redis-like store adapter boundary | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |
| `export.root` | @async/db root runtime, schema, server, sync, operations, and helpers | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |
| `export.schema` | @async/db/schema authoring helpers: collection, document, field, derived fields, and files | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/data-files-and-schemas.md) |
| `export.sqlite` | @async/db/sqlite optional SQLite store and existing table mapping | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/integrations.md) |
| `export.sqlite.compat` | @async/db/sqlite/compat low-level SQLite driver adapters and legacy bridges | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/integrations.md) |
| `export.vite` | @async/db/vite optional Vite integration and browser cache options | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/integrations.md) |

## Async DB CLI

Contract: `@async/db.cli`

### Diagnostics

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.doctor` | async-db doctor and check report schema/data drift, production readiness, and usage findings | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Generate

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.generate.hono` | async-db generate hono creates a Hono and SQLite starter from the current contract | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/integrations.md) |

### Inspection

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.integrate` | async-db integrate inspects SQLite and Postgres apps and generates dry-run importers | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/integrations.md) |
| `cli.usage` | async-db usage scan emits production-oriented source usage manifests | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Lifecycle

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.lifecycle` | async-db promote, status, reseed, backup, and restore manage local lifecycle state | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Operations

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.operations` | async-db operations builds operation registries, refs, and operation contracts | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Project

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.init` | async-db init scaffolds data-first, schema-first, source-file, and content templates | public | stable | active |  | [docs](https://github.com/async/db/blob/main/README.md) |
| `cli.sync` | async-db sync loads sources, validates schema, writes generated metadata/types, and refreshes runtime state | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |
| `cli.types` | async-db types generates TypeScript declarations with watch and explicit output support | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/generated-files.md) |

### Runtime

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.runtime-write` | async-db create writes one record through the package runtime path | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Schema

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.schema` | async-db schema prints, infers, validates, manifests, bundles, unbundles, and migrates schemas | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/data-files-and-schemas.md) |

### Server

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.serve` | async-db serve starts the local writable development API and viewer | public | dev-only | active |  | [docs](https://github.com/async/db/blob/main/README.md) |

### Viewer

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.viewer` | async-db viewer manifest renders viewer manifest contracts | public | generated | active |  | [docs](https://github.com/async/db/blob/main/docs/generated-files.md) |

## Async DB Runtime And Integration APIs

Contract: `@async/db.runtime`

### Client

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.http-client` | createDbClient direct REST/GraphQL calls, automatic batching, dedupe, and cache options | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Content

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.content-mdx` | files() content resources with MDX component inventory and allow-list diagnostics | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Integrations

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.optional-stores` | SQLite, Postgres, KV, and Redis-like store adapter helper boundaries remain optional | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |
| `runtime.postgres-integration` | Postgres inspection, JSONB envelope storage, existing table mapping, and compat adapters | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/integrations.md) |
| `runtime.sqlite-integration` | SQLite inspection, Async DB-owned SQLite storage, existing table mapping, and compat adapters | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/integrations.md) |

### Lifecycle

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.lifecycle-file` | db.lifecycle.jsonc machine-managed promotion facts merged into config.lifecycle | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Migration

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.schema-migration` | review-first schema declaration migration reports and generated output plans | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Observability

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.audit-trail` | resource audit trails for successful runtime writes with optional value capture | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Operations

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.operations` | operation manifests, registered handlers, refs, hashing, and readiness checks | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Runtime

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.database` | openDb, Db, collection/document APIs, forks, branches, snapshots, migrations, close, and ETag preconditions | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |
| `runtime.lifecycle` | createDbRuntime, reloadDb, watchDbSources, and createDbRequestHandler for custom local servers | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Schema

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.schema-authoring` | trusted local schema helpers including collection, document, field, files, and derived fields | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/typescript-schema-sources.md) |
| `runtime.schema-loading` | loadDbSchema, validators, computed field resolvers, metadata-only loading, and schema locator support | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/data-files-and-schemas.md) |

### Storage

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.json-store` | JSON store helpers, advisory locks, atomic writes, WAL, versioning, crash recovery, encryption, and object storage descriptor | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Testing

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.memory-fs` | createMemoryFs for tests and programmatic schema/runtime loading | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

## Async DB HTTP Surface

Contract: `@async/db.http`

### Auth

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `http.authorization` | server.authorize(context) gates REST, viewer, schema, manifest, GraphQL, Falcor, events, health, and operations | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Discovery

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `http.root-discovery` | GET / root discovery returns HTML or JSON links by request headers | public | dev-only | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Falcor

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `http.falcor` | Falcor-compatible record routes where enabled | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Graphql

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `http.graphql` | Dependency-free GraphQL subset supports queries, mutations, aliases, variables, batching, and introspection | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Health

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `http.health` | GET <apiBase>/health reports uptime, schema, diagnostics, and state-dir writability | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Operations

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `http.operations` | Registered operation execution and client-safe operation ref routes | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Rest

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `http.rest-batching` | REST batching preserves per-item result shape and errors | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |
| `http.rest-resources` | REST resources under /db support JSON reads/writes, ETag, If-Match, If-None-Match, and bulk route behavior | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

### Viewer

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `http.viewer` | Built-in local viewer, server-sent events, manifest routes, and exposure settings | public | dev-only | active |  | [docs](https://github.com/async/db/blob/main/docs/package-api.md) |

## Async DB Generated Contracts

Contract: `@async/db.generated`

### Inspection

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `generated.integration-report` | integrate inspect db.integrationReport artifacts for SQLite/Postgres adoption | beta | generated | active |  | [docs](https://github.com/async/db/blob/main/docs/generated-files.md) |
| `generated.usage` | usage scan db.usageManifest source-scan artifact | beta | generated | active |  | [docs](https://github.com/async/db/blob/main/docs/generated-files.md) |

### Internal

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `generated.state-internal` | .db/state and store-private metadata are internal generated runtime output | internal | internal | active |  | [docs](https://github.com/async/db/blob/main/docs/generated-files.md) |

### Migration

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `generated.schema-migration-report` | schema migrate inspect db.schemaMigrationReport artifacts | beta | generated | active |  | [docs](https://github.com/async/db/blob/main/docs/generated-files.md) |

### Operations

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `generated.operations` | operations.build outputs, server operation registry, and client-safe refs/contracts | public | generated | active |  | [docs](https://github.com/async/db/blob/main/docs/generated-files.md) |

### Schema

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `generated.schema` | .db/schema.generated.json and schemaOutFile/outputs.schemaManifest generated schema metadata | public | generated | active |  | [docs](https://github.com/async/db/blob/main/docs/generated-files.md) |

### Types

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `generated.types` | .db/types/index.d.ts and types.commitOutFile generated TypeScript declarations | public | generated | active |  | [docs](https://github.com/async/db/blob/main/docs/generated-files.md) |

### Viewer

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `generated.viewer-manifest` | viewerManifestOutFile and outputs.viewerManifest viewer contracts | public | generated | active |  | [docs](https://github.com/async/db/blob/main/docs/generated-files.md) |

## Async DB Config Surface

Contract: `@async/db.config`

### Config

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `config.lifecycle` | db.lifecycle.jsonc merged lifecycle config and production doctor findings | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/configuration.md) |
| `config.mock` | mock delay and error behavior with production skips and doctor reporting | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/configuration.md) |
| `config.operations` | operations registry, refs, contract output, source directory, accept-ref policy, and strict readiness | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/configuration.md) |
| `config.outputs` | outputs generated locations for state, types, manifests, operations, and starters | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/configuration.md) |
| `config.protocols` | rest, graphql, and falcor protocol exposure and request/response toggles | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/configuration.md) |
| `config.schema` | schema validation, inference, unknown-field policy, and behavior toggles | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/configuration.md) |
| `config.server` | server host, port, base path, exposure, trace, watcher, viewer, events, authorize, and local behavior | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/configuration.md) |
| `config.stores` | stores, JSON durability, resource schemas, sources, routes, defaults, seed, audit, and UI metadata | beta | preview | active |  | [docs](https://github.com/async/db/blob/main/docs/configuration.md) |
| `config.types` | types generation options including output paths, committed copy, comments, readonly properties, and runtime helpers | public | stable | active |  | [docs](https://github.com/async/db/blob/main/docs/configuration.md) |

## Async DB Internal Boundaries

Contract: `@async/db.boundary`

### Execution

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `boundary.trusted-local-code` | .schema.js, db.config.js, source readers, and manifest hooks are trusted local code and not sandboxed public APIs | internal | internal | active |  | [docs](https://github.com/async/db/blob/main/API_SURFACE.md) |

### Generated

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `boundary.generated-state` | .db state, hashes, and store-private metadata are internal and not app import surfaces | internal | internal | active |  | [docs](https://github.com/async/db/blob/main/API_SURFACE.md) |

### Source

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `boundary.features-internal` | src/features modules are internal unless re-exported and declared | internal | internal | active |  | [docs](https://github.com/async/db/blob/main/API_SURFACE.md) |
| `boundary.protocol-internals` | src/rest, src/graphql, and src/web helper modules are internal while route behavior is public | internal | internal | active |  | [docs](https://github.com/async/db/blob/main/API_SURFACE.md) |
| `boundary.tests-scripts-examples` | test helpers, scripts, and example internals are private unless documented as runnable hooks | internal | internal | active |  | [docs](https://github.com/async/db/blob/main/API_SURFACE.md) |

## Supported Surfaces

| Contract | Hash | Features |
| --- | --- | --- |
| `@async/db.boundary` | `sha256:d15e9a2f8062afd31a383024b68f09a99544a8093733c239c385204e8a00275c` | `boundary.features-internal`, `boundary.generated-state`, `boundary.protocol-internals`, `boundary.tests-scripts-examples`, `boundary.trusted-local-code` |
| `@async/db.cli` | `sha256:58832a8d2bf2b682a914de1a1f38a4ec65071d8e89dbdb3e546dc75d3ea44b15` | `cli.doctor`, `cli.generate.hono`, `cli.init`, `cli.integrate`, `cli.lifecycle`, `cli.operations`, `cli.runtime-write`, `cli.schema`, `cli.serve`, `cli.sync`, `cli.types`, `cli.usage`, `cli.viewer` |
| `@async/db.config` | `sha256:b5d6553f8fbe3409bfcb2e52f44c6fccdc7e7aa2e0fb3da8bebe56a1860fe440` | `config.lifecycle`, `config.mock`, `config.operations`, `config.outputs`, `config.protocols`, `config.schema`, `config.server`, `config.stores`, `config.types` |
| `@async/db.generated` | `sha256:015f1b90667f6527b41870a7f9487af6a10f074ce990ede07cd7acde2a289f9a` | `generated.integration-report`, `generated.operations`, `generated.schema`, `generated.schema-migration-report`, `generated.state-internal`, `generated.types`, `generated.usage`, `generated.viewer-manifest` |
| `@async/db.http` | `sha256:192b1b35fdaa7ff929fcf299721310166c5b90d7922abb19141fa936cf60fc01` | `http.authorization`, `http.falcor`, `http.graphql`, `http.health`, `http.operations`, `http.rest-batching`, `http.rest-resources`, `http.root-discovery`, `http.viewer` |
| `@async/db.package` | `sha256:54cd8150fa7b177adca39c5b68daf03e2faed64058f962297996c6531ef04938` | `export.client`, `export.config`, `export.hono`, `export.json`, `export.kv`, `export.postgres`, `export.postgres.compat`, `export.redis`, `export.root`, `export.schema`, `export.sqlite`, `export.sqlite.compat`, `export.vite` |
| `@async/db.runtime` | `sha256:66a3bd5dfc31b35530e4849a931744107e60e38865fc829311385df8ec15b3d9` | `runtime.audit-trail`, `runtime.content-mdx`, `runtime.database`, `runtime.http-client`, `runtime.json-store`, `runtime.lifecycle`, `runtime.lifecycle-file`, `runtime.memory-fs`, `runtime.operations`, `runtime.optional-stores`, `runtime.postgres-integration`, `runtime.schema-authoring`, `runtime.schema-loading`, `runtime.schema-migration`, `runtime.sqlite-integration` |
