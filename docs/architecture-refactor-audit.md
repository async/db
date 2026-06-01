# Architecture Refactor Audit

Date: 2026-06-01

This is a read-only architecture audit for `@async/db`. It maps the current
high-risk modules and public contracts, then proposes bounded refactor slices
that preserve behavior. It is not an implementation plan for changing product
semantics.

## Checkpoint Log

| Checkpoint | Changed | Verified | Failed | Next action |
| --- | --- | --- | --- | --- |
| 1. Guidance and scope | Created this audit document only. | Read `AGENTS.md`, the global prompt bootstrap, package metadata, architecture docs, release docs, generated-file docs, and current examples/tests. | None. | Finish module map and gates. |
| 2. Module and contract map | Added module risk map, public contract map, and coverage notes. | Confirmed the worktree was clean before edits and current branch is `codex/architecture-audit-plan`. | None. | Run package gates and record exact outcomes. |
| 3. Verification gates | Added exact command receipts. | `npm run check` passed; `npm test` passed with 452 tests; `npm --cache /private/tmp/jsondb-npm-cache pack --dry-run` passed. | None. | Commit the audit doc. |
| 4. Git hygiene | Confirmed no source, test, example, generated, or package metadata changes. | `git status --short` showed only `?? docs/architecture-refactor-audit.md` after the gates. | None. | Stage and commit this doc. |

## Invariants

Refactor work must preserve these contracts unless a future change explicitly
chooses a breaking release:

- Public package exports from `package.json`: `.`, `./schema`, `./config`,
  `./client`, `./json`, `./hono`, `./sqlite`, `./postgres`, `./kv`, `./redis`,
  and `./vite`.
- CLI binary `async-db` and existing command behavior for `sync`, `types`,
  `schema`, `doctor`, `check`, `create`, `serve`, `generate hono`,
  `operations build`, and `operations contract`.
- Dependency-light Node.js ESM package shape with Node.js `>=20` support and no
  mandatory runtime dependencies.
- Optional integration boundaries: Hono, SQLite, Postgres, KV, Redis-like
  stores, Vite, and generated Hono starters must stay optional or injected.
- Trusted local-code assumption for `.schema.mjs`, `.schema.js`,
  `db.config.mjs`, source readers, format renderers, and manifest hooks.
- Generated-file policy: `.db/` is generated and normally uncommitted; configured
  committed types, schema manifests, viewer manifests, and operation refs remain
  allowed.
- Source fixtures are not rewritten unless existing configured behavior already
  permits it, such as intentional `sourceFile` store writes or schema
  bundle/unbundle commands.
- Registered operations remain the production API boundary. Refactors should not
  make app code depend on JSON file internals.

## Public Contract Map

| Surface | Current owner | Contract tests / docs | Refactor risk |
| --- | --- | --- | --- |
| Root package API | `src/index.ts`, `src/index.d.ts` | `test/package/exports.test.ts` imports runtime, server, schema, generator, client, operations, and declarations. | High: broad export surface and declarations can drift independently from source. |
| Client API | `src/client.ts`, `src/client-cache.ts`, `src/client.d.ts` through root exports | `src/client.test.ts`, `test/package/exports.test.ts` | High: batching, query aliases, registered refs, cache, storage, and EventSource behavior share one surface. |
| JSON public subpath | `src/json.ts`, `src/json.d.ts`, `src/features/storage/json.ts` | `src/features/storage/json.test.ts`, `test/package/exports.test.ts`, `docs/json-production.md` | Medium: file path layout and public helper names must stay stable before object storage work. |
| Config and schema helpers | `src/config-public.ts`, `src/config.d.ts`, `src/schema-builders.ts`, `src/schema.d.ts` | schema/source/standard-schema tests, package declaration tests | Medium: helper output feeds runtime, generated types, GraphQL metadata, and docs-facing examples. |
| Runtime DB | `src/features/runtime/db.ts`, `src/db.ts`, `src/features/runtime/*` | `test/runtime/*.test.ts`, REST/GraphQL tests, package declaration tests | High: one class owns data APIs plus fork, branch, snapshot, migration, routing, and operation aliases. |
| REST server | `src/server.ts`, `src/rest/*` | `src/server.test.ts`, `src/rest/handler.test.ts`, examples tests | High: route exposure, mock behavior, registered operations, viewer, imports, formats, tracing, and REST resources interact. |
| GraphQL | `src/graphql/*` | `src/graphql/graphql.test.ts`, REST/client operation tests | Medium: dependency-free parser/executor is a product contract and should stay small but stable. |
| Viewer | `src/web/viewer.ts`, `src/viewer-manifest.ts` | `src/web/viewer.test.ts`, `test/viewer/manifest.test.ts`, examples tests | Medium: viewer is docs-facing UI plus embedded JS and route metadata. |
| Generated Hono starter | `src/generate/hono.ts`, `src/generate/hono/*` | `src/generate/hono.test.ts`, package tests | Medium: generated output is a contract even though it is not runtime package code. |
| Optional integrations | `src/integrations/*`, public subpath wrappers | `src/integrations/hono.test.ts`, `src/sqlite.test.ts`, `src/postgres.test.ts`, `src/kv.test.ts`, `src/vite.test.ts` | Medium: optional integrations must stay dependency-light and parity-tested against core route behavior. |
| Examples host | `scripts/serve-examples.js`, `scripts/example-launcher.js`, `examples/*` | `test/examples/examples.test.ts` | Medium: examples are product docs and smoke coverage, especially `production-json`, `free-plan-upgrade`, and `cms-json-publish`. |

## Large And High-Risk Modules

Line counts are approximate current source/test sizes from the audit pass:

| File | Lines | Risk | Current responsibilities |
| --- | ---: | --- | --- |
| `src/rest/handler.ts` | 1214 | High | Viewer routes, manifest/schema routes, root discovery, REST resources, format negotiation, CSV import, batch execution, body parsing, response serialization, tracing. |
| `src/cli/commands/schema.ts` | 1453 | High | Schema infer, validate, manifest, bundle, unbundle, prompts, file planning, Standard Schema rendering, import rewriting, overwrite policy. |
| `src/client-cache.ts` | 1213 | High | Cache config, manifest indexing, query/entity normalization, invalidation, watches, storage snapshots, EventSource wiring, IndexedDB adapter. |
| `src/features/runtime/db.ts` | 1147 | High | Collection/document access, operation/query aliases, scoped DBs, fork/branch lifecycle, snapshots, migrations, routing, resource migration, structured lifecycle errors. |
| `src/web/viewer.ts` | 1029 | Medium | Full viewer HTML, styling classes, embedded REST/GraphQL runner, import UI, event handling, state rendering. |
| `src/graphql/execute.ts` | 956 | Medium | GraphQL execution, operation selection, directives, fragments, introspection, collection/document reads, mutations, computed fields, errors. |
| `src/features/schema/sources.ts` | 926 | Medium | Source discovery, JSON/JSONC/CSV/schema readers, `.schema.js` ESM package marker behavior, custom source readers, source normalization. |
| `src/server.ts` | 848 | High | Server lifecycle, watcher, route matching, exposure checks, mock handling, operation execution, viewer events, tracing. |
| `src/integrations/hono.ts` | 746 | Medium | Optional Hono route registration, app/context helpers, REST/operation hook lifecycle, local operation registry overrides. |
| `src/integrations/sqlite.ts` | 662 | Medium | Optional SQLite store, migration helpers, JSON envelope persistence, node:sqlite gating. |
| `src/client.ts` | 607 | Medium | Public client construction, REST/GraphQL batching, query/operation aliases, URL resolution, cache integration. |

The main architectural smell is not that these files are broken. It is that
refactors in them currently have a large blast radius because protocol parsing,
IO, data shaping, lifecycle state, tracing, and public error contracts are often
interleaved in the same file.

## Current Seams

### CLI Schema Commands

`src/cli/commands/schema.ts` is the highest-risk CLI module. It mixes command
dispatch with renderers, file-write planning, package boundary detection,
schema seed splitting, Standard Schema import rendering, and overwrite safety.
The broad tests in `test/cli/cli.test.ts` are strong, especially bundle/unbundle
coverage, but most tests operate through the CLI command instead of small pure
helpers.

Refactor seam: extract pure planning/rendering helpers first, then leave
`runSchema()` as a thin dispatcher. The first extraction should not change
prompting, non-TTY errors, `--all`, `--force`, output paths, or JSONC rewrite
warnings.

### REST Handler

`src/rest/handler.ts` has useful internal seams already: `executeRestBatch`,
`readJsonBody`, `findResourceByRoute`, and formatting helpers. It still owns
viewer rendering, CSV import source writes, resource dispatch, discovery,
manifest formatting, and batch item execution in one module.

Refactor seam: extract route option/path resolution, root discovery, CSV import,
batch execution, and resource dispatch into separate modules with the current
`handleRestRequest()` signature unchanged.

### Runtime DB

`src/features/runtime/db.ts` now enforces fork/branch lifecycle and supports
explicit fork sources, snapshots, persisted migration lock copies, and routing.
That resolves earlier lifecycle concerns, but the class remains a control-plane
and data-plane coordinator.

Refactor seam: keep public methods and structured errors stable while moving
fork/branch registry IO, snapshot IO, migration manifests, routing persistence,
and source-copy helpers into focused modules. Preserve `db.query()` as the main
default-branch shorthand and keep `resources.migrate()` compatibility.

### Client Cache

`src/client-cache.ts` combines pure normalization rules with browser/runtime
integration. The public behavior is well-tested: cache policies, in-flight
dedupe, REST write invalidation, GraphQL normalization, watches, runtime log
events, async storage hydration, and IndexedDB behavior.

Refactor seam: split pure cache-key/manifest/entity normalization from storage
adapters and event-source wiring. Start with exported-for-test internal helpers
only if the public API remains unchanged.

### Viewer

`src/web/viewer.ts` returns one large HTML string with embedded client JS. This
is simple to ship but hard to review. Viewer behavior is checked through direct
viewer tests, manifest tests, REST tests, and examples host tests.

Refactor seam: split static CSS class constants, route bootstrap JSON, and
browser script assembly. Any visual or route change needs a real examples host
smoke because this is a docs-facing UI.

### Schema Sources

`src/features/schema/sources.ts` owns the trusted local-code boundary for schema
execution and custom readers. It also writes a fixture `db/package.json` module
marker when configured and needed for `.schema.js`. Tests cover `.schema.mjs`,
`.schema.js`, root schemas, folder sources, source load errors, dot folder
ignores, and custom reader normalization.

Refactor seam: extract path/module-context helpers and source-reader
normalization. Do not relax trusted-local-code assumptions and do not change when
the module marker is written.

### GraphQL Execution

`src/graphql/execute.ts` is a dependency-free executor with rich behavior:
operationName selection, aliases, variables, fragments, directives,
introspection, computed fields, collection/document mutations, non-JSON store
writes, and structured errors.

Refactor seam: keep parser and public executor stable, then split
introspection, field projection, root selection, and mutation dispatch behind
existing test fixtures.

### Batching, Registered Operations, And Operation Refs

There are three operation paths that must keep matching:

- Client `db.query()`/`db.operation()` in `src/client.ts`.
- Server registered operation execution in `src/features/operations/runtime.ts`
  and `src/server.ts`.
- Hono operation routes in `src/integrations/hono.ts`.

Existing tests cover operation manifest hashing, client-safe refs,
registered-only exposure, Hono operation hooks, custom `resolveRef` and
`validateRef`, and client query aliases. Future refactors should add parity
tests whenever a helper is shared across server and Hono.

### Generated Starters

The Hono starter generator is a generated-output contract, not just an
implementation detail. The most sensitive files are
`src/generate/hono/index.ts` and `src/generate/hono/sqlite.ts`; the latter is a
large template for optional SQLite output.

Refactor seam: move generated strings into smaller template functions only after
snapshotting representative generated output for REST, GraphQL, validators, and
SQLite modes.

### Optional Stores And Integrations

The package currently has no runtime dependencies. Hono and SQLite are optional;
Postgres, KV, and Redis-like stores are client-injected abstractions. The JSON
S3 storage helper is a descriptor and returns a clear unsupported adapter if used
as the built-in runtime store today.

Refactor seam: optional integrations can share shape helpers, but imports must
not make optional packages mandatory and should keep dynamic/import-free runtime
paths where they are today.

## Generated Output Contracts

Generated output has four separate contracts:

- Runtime `.db/schema.generated.json`, `.db/types/index.d.ts`, and
  `.db/state/*.json`.
- Configured committed TypeScript declarations such as
  `examples/basic/src/generated/db.types.d.ts`.
- Configured schema/viewer/operation manifests such as
  `examples/schema-ui/src/generated/db.schema.json` and operation refs.
- Generated starter projects from `async-db generate hono`.

The repository currently has ignored example `.db/schema.generated.json` files
on disk from prior smoke runs. They are not tracked and should not be committed.
Refactor work must keep `.gitignore` behavior intact and use `git status` before
handoff.

## Example And Viewer Surfaces

Examples are part of the package contract because `package.json` publishes
example READMEs, metadata, source, config, and fixture data. The examples index
currently expects:

`advanced`, `basic`, `cms-json-publish`, `computed-fields`,
`content-collections`, `csv`, `data-first`, `diagnostics`,
`free-plan-upgrade`, `hono-auth`, `production-json`, `relations`,
`rest-client`, `schema-first`, `schema-manifest`, `schema-ui`, and
`standard-schema`.

Product-direction examples that future refactors must keep healthy:

- `production-json`: JSON-backed feature flags/settings behind registered
  operations.
- `free-plan-upgrade`: app-owned migration from JSON to a paid backing store
  pattern.
- `cms-json-publish`: app-owned CMS publish workflow on top of generic
  primitives.
- `schema-ui`: custom example runtime, generated schema manifest, viewer routes,
  and SSR links.
- `hono-auth`: optional Hono integration with nested example package imports.

Real-host verification for viewer/example changes should use:

```bash
npm run examples
```

Then open the index and at least the changed example's `/__db` viewer. The
automated examples tests validate lazy runtime wiring, forwarded public URLs,
Tailscale opt-in behavior, and key example smoke flows, but they do not replace
manual browser verification for viewer layout or route-link regressions.

## Coverage Map And Gaps

Strong current coverage:

- Package exports, declaration shape, package file allowlist, release workflow,
  public JSON helpers, operation handler API, Hono hook contexts, fork/branch
  metadata, and npm dry-run source exclusion.
- CLI schema behavior including infer, manifest, bundle/unbundle, prompts,
  Standard Schema, executable resolvers, `--all`, conflicts, and operation
  contract commands.
- REST routes including discovery, formats, viewer, schema, manifest,
  collection/document reads and writes, select/expand/pagination, CSV import,
  non-JSON stores, batch behavior, structured errors, and request-size limits.
- GraphQL parser/executor behavior including aliases, variables, fragments,
  directives, introspection, mutations, non-JSON store writes, and errors.
- Runtime package API including defaults, validation, id generation, custom
  stores, static/sourceFile stores, concurrent writes, events, fork/branch
  lifecycle, snapshots, migrations, routing, and control-plane corruption.
- Client direct and automatic batching, dedupe rules, registered operation refs,
  cache reads/writes, watches, event invalidation, async storage, and IndexedDB.
- JSON store atomic writes, corrupt-state guidance, write queues, fork/branch
  paths, default scoped paths, and S3 descriptor behavior.
- Examples host, example discovery, lazy runtimes, forwarded public URLs,
  Tailscale opt-in, nested package import wiring, onboarding examples, production
  JSON operation refs, CMS publish script, and free-plan upgrade script.

Coverage gaps to close before deep refactors:

- Smaller unit tests around REST route resolution and root discovery before
  moving those helpers out of `handler.ts`.
- Pure tests for schema command write plans/rendered module fragments before
  splitting `src/cli/commands/schema.ts`.
- Generated Hono output snapshots for representative REST, GraphQL, validation,
  and SQLite starter modes.
- Server/Hono parity tests for any shared registered-operation request helper.
- Browser/examples-host screenshot or manual receipt for viewer HTML/JS changes.
- Client cache pure helper tests that do not require full client network mocks.
- Path-layout tests that cover both built-in JSON adapter paths and public
  `jsonStore({ storage: fileStorage(...) })` paths before object-storage support.

## Findings

### High: Public Contracts Span Source, Declarations, Dist, And Package Metadata

The root package exports are concise, but each export has a declaration file and
build artifact. A source-only refactor can pass TypeScript and still drift the
published contract if declarations or package allowlists are not checked.

Plan: keep `test/package/exports.test.ts` as a required gate for every slice
that touches exported modules, declarations, package metadata, or generated
output.

### High: Runtime DB Is Both Data API And Lifecycle Control Plane

`Db` coordinates resource APIs, scoped DB creation, lifecycle registries,
snapshots, migrations, routing, and operation aliases. This makes lifecycle
changes hard to review even though current tests are good.

Plan: extract control-plane services behind the existing `Db` facade. The facade
should remain the public owner of `db.forks`, `db.branches`, `db.snapshots`,
`db.migrations`, `db.routing`, `db.resources.migrate()`, and `db.query()`.

### High: REST And Server Route Layers Duplicate Product Semantics

`src/server.ts` owns outer route matching, exposure checks, mock behavior,
registered operation routing, and tracing. `src/rest/handler.ts` owns inner
REST/viewer/resource behavior. Optional Hono implements a third route surface.

Plan: refactor only after route-matching and exposure behavior have focused
tests. When extracting operation request handling, verify dependency-free server
and Hono behavior together.

### Medium: JSON Storage Has Two Path Modes That Must Stay Explicit

The default JSON runtime writes under scoped `.db/state`. Public
`jsonStore({ storage: fileStorage(root) })` writes under scoped
`forks/<fork>/branches/<branch>/resources` or `resources` for root. Tests cover
both, and docs should keep this distinction clear before S3/R2/object storage is
implemented.

Plan: centralize path resolution only with tests that assert both modes. Do not
hide object storage behind a file-like API until read/write semantics, atomicity,
and corruption handling are real.

### Medium: Schema Source Loading Is A Trusted-Code Boundary

Source readers and executable schema files are trusted project code. The module
marker behavior for `.schema.js` is intentionally specific and tested.

Plan: extract helpers without changing the local-code trust model, package
marker writes, source-reader ordering, or mixed-mode diagnostics.

### Medium: Viewer Is A Large String Contract

The viewer is simple to publish but hard to diff. Route constants and embedded
scripts are contract-sensitive because examples and docs depend on them.

Plan: split only inert assembly helpers first. Any functional viewer change
needs examples-host browser verification, not just unit tests.

## Ordered Refactor Slices

Each slice is intended to be independently reviewable and reversible. Stop after
any failed proof command or changed public output that was not intentionally
approved.

### Slice 1: Contract Baseline Harness

Goal: make future refactors safer without moving source logic.

Allowed files:

- `test/package/exports.test.ts`
- `test/examples/examples.test.ts`
- `src/generate/hono.test.ts`
- docs only

Unchanged behavior:

- No source exports, route paths, generated outputs, or package files change.

Required focused tests:

- Add missing generated Hono starter snapshot assertions if current coverage is
  not specific enough for planned template movement.
- Add a package export assertion for any public subpath that lacks one.

Proof commands:

```bash
npm run check
npm test
npm --cache /private/tmp/jsondb-npm-cache pack --dry-run
```

Stop conditions:

- Any generated output changes without an explicit test expectation.
- Any package tarball includes source TypeScript or `.db/` runtime state.

### Slice 2: CLI Schema Planning Helpers

Goal: reduce risk in `src/cli/commands/schema.ts` by extracting pure write-plan
and module-render helpers.

Allowed files:

- `src/cli/commands/schema.ts`
- New files under `src/cli/commands/schema/`
- `test/cli/cli.test.ts`
- `test/cli/schema-prompt.test.ts`

Unchanged behavior:

- Prompt flow, `--all`, `--force`, non-TTY errors, conflict diagnostics,
  Standard Schema rendering, generated import paths, and JSONC warning behavior.

Required focused tests:

- Write-plan tests for bundle/unbundle conflicts and force overwrite.
- Rendered root schema/per-resource schema output tests for executable resolver
  imports and Standard Schema validators.

Proof commands:

```bash
npm run check
node ./.tmp/test-build/scripts/run-tests.js test/cli/cli.test.js test/cli/schema-prompt.test.js
npm test
```

Stop conditions:

- Fixture files are rewritten in cases that previously only planned or refused a
  write.
- Any CLI output wording that tests assert changes unintentionally.

### Slice 3: Schema Source Loader Helpers

Goal: split source discovery, module-context handling, and custom reader
normalization into smaller units.

Allowed files:

- `src/features/schema/sources.ts`
- New files under `src/features/schema/sources/`
- `test/schema/sources.test.ts`

Unchanged behavior:

- `.schema.mjs` and `.schema.js` load as trusted local code.
- Root schemas remain authoritative.
- `.schema.js` module marker writes stay gated exactly as today.
- Source-reader ordering and mixed-mode diagnostics stay stable.

Required focused tests:

- Existing `.schema.js` module marker tests.
- Custom multi-source reader naming and diagnostics tests.
- Source load errors preserve file-specific diagnostics.

Proof commands:

```bash
npm run check
node ./.tmp/test-build/scripts/run-tests.js test/schema/sources.test.js
npm test
```

Stop conditions:

- New loader abstractions require a dependency or TypeScript runtime loader.
- Any schema source executes from a different package/module context.

### Slice 4: REST Handler Route And Import Modules

Goal: keep `handleRestRequest()` stable while moving route resolution, discovery,
batching, and CSV import into focused modules.

Allowed files:

- `src/rest/handler.ts`
- New files under `src/rest/`
- `src/rest/handler.test.ts`
- `src/server.test.ts`

Unchanged behavior:

- Viewer paths, manifest paths, schema paths, batch paths, CSV import filenames,
  resource route normalization, format negotiation, tracing phases, and
  structured error payloads.

Required focused tests:

- Pure route-option and root-discovery tests.
- CSV filename sanitization and configured `dbDir` write path tests.
- Batch nested request rejection for default and custom API base paths.

Proof commands:

```bash
npm run check
node ./.tmp/test-build/scripts/run-tests.js src/rest/handler.test.js src/server.test.js
npm test
```

Stop conditions:

- `createDbRequestHandler()` or Hono route behavior needs source changes to pass.
- Viewer manifest links differ without an approved contract update.

### Slice 5: Runtime Control Plane Services

Goal: keep `Db` as the public facade but move fork, branch, snapshot, migration,
and routing persistence into services.

Allowed files:

- `src/features/runtime/db.ts`
- `src/features/runtime/scope-state.ts`
- New files under `src/features/runtime/control-plane/`
- `test/runtime/fork-branch.test.ts`
- `test/runtime/package-api.test.ts`
- `src/features/storage/json.test.ts`

Unchanged behavior:

- `db.forks.open()` and `db.fork()` require registered forks.
- Fork creation supports `from: "main"`, `from: { fork, branch }`, and
  `from: { fork, snapshot }`; unsupported strings fail loudly.
- Branch creation copies from an existing branch.
- Migration read-only locks persist across fresh DB handles.
- `resources.migrate()` remains available.
- Routing persists and applies on reopened scoped DB handles.

Required focused tests:

- Existing fork/branch lifecycle tests.
- Reopen-after-migrate-before-verify test.
- Control-plane corruption test.
- JSON path-layout tests for scoped resource state.

Proof commands:

```bash
npm run check
node ./.tmp/test-build/scripts/run-tests.js test/runtime/fork-branch.test.js test/runtime/package-api.test.js src/features/storage/json.test.js
npm test
```

Stop conditions:

- The default `db.query()` shorthand for root/main or fork/main changes.
- Registry, routing, lock, or snapshot files lose atomic/corruption behavior.

### Slice 6: Shared Registered Operation Request Helper

Goal: reduce duplicated operation execution behavior across server and Hono.

Allowed files:

- `src/features/operations/runtime.ts`
- `src/server.ts`
- `src/integrations/hono.ts`
- `test/operations/runtime.test.ts`
- `src/integrations/hono.test.ts`
- `src/server.test.ts`
- `src/client.test.ts`

Unchanged behavior:

- `acceptRefs`, `resolveRef`, `validateRef`, ref/name modes, operation-only REST
  exposure, structured errors, content types, and hook contexts.

Required focused tests:

- Server and Hono parity for empty operation bodies and structured JSON errors.
- Registered-only exposure with app-owned explicit operation routes.
- Client `query()` registered ref execution through configured `apiBase`.

Proof commands:

```bash
npm run check
node ./.tmp/test-build/scripts/run-tests.js test/operations/runtime.test.js src/integrations/hono.test.js src/server.test.js src/client.test.js
npm test
```

Stop conditions:

- Hono becomes a mandatory dependency.
- Operation refs leak full templates into client-safe outputs.

### Slice 7: Client Cache Pure Core

Goal: separate cache normalization from network/browser integration.

Allowed files:

- `src/client-cache.ts`
- New files under `src/client-cache/`
- `src/client.ts`
- `src/client.test.ts`
- public declarations only if no public names change

Unchanged behavior:

- Default 10 ms batching, REST/GraphQL dedupe rules, read/write/cache policies,
  watch callbacks, event invalidation, storage snapshot format, IndexedDB errors,
  and manifest-scoped namespaces.

Required focused tests:

- Pure cache key and normalized entity tests.
- Existing network/client/cache integration tests.

Proof commands:

```bash
npm run check
node ./.tmp/test-build/scripts/run-tests.js src/client.test.js
npm test
```

Stop conditions:

- Cache snapshot shape changes without a migration story.
- Browser-only globals are accessed during Node import.

### Slice 8: Viewer Assembly Split

Goal: make viewer HTML/JS easier to review without changing routes or UI
behavior.

Allowed files:

- `src/web/viewer.ts`
- New files under `src/web/`
- `src/web/viewer.test.ts`
- `test/viewer/manifest.test.ts`
- `src/rest/handler.test.ts`
- `test/examples/examples.test.ts`

Unchanged behavior:

- Default viewer path, script route constants, CSV import UI, REST/GraphQL
  runners, manifest consumption, and source directory labels.

Required focused tests:

- Existing viewer HTML route tests.
- Viewer manifest link tests.
- Examples host lazy runtime tests.

Proof commands:

```bash
npm run check
node ./.tmp/test-build/scripts/run-tests.js src/web/viewer.test.js test/viewer/manifest.test.js src/rest/handler.test.js test/examples/examples.test.js
npm test
npm run examples
```

Stop conditions:

- Any layout or embedded script behavior changes without a browser receipt.
- The examples host exposes Tailscale Serve without explicit opt-in.

### Slice 9: GraphQL Executor Modules

Goal: split the dependency-free GraphQL executor into root selection,
projection, mutation, and introspection modules.

Allowed files:

- `src/graphql/execute.ts`
- New files under `src/graphql/`
- `src/graphql/graphql.test.ts`
- REST/client operation tests if operation GraphQL execution is touched

Unchanged behavior:

- Parser public exports, query result shape, error extensions, operationName
  behavior, directives, fragments, introspection, computed fields, mutations,
  and non-JSON store writes.

Required focused tests:

- Existing GraphQL suite.
- Registered GraphQL operation execution through operation handler if helper
  boundaries move.

Proof commands:

```bash
npm run check
node ./.tmp/test-build/scripts/run-tests.js src/graphql/graphql.test.js test/operations/runtime.test.js
npm test
```

Stop conditions:

- A real GraphQL dependency becomes required.
- GraphQL SDL/introspection changes without explicit contract approval.

### Slice 10: Optional Integration And Starter Cleanup

Goal: reduce duplication in optional adapters and generated Hono output while
keeping optional dependencies optional.

Allowed files:

- `src/integrations/*`
- `src/generate/hono.ts`
- `src/generate/hono/*`
- `src/generate/hono.test.ts`
- `src/integrations/*.test.ts`
- package declaration files only if public types remain compatible

Unchanged behavior:

- No new mandatory dependencies.
- `node:sqlite` remains gated.
- Generated starter package output remains installable as a standalone app.
- Public Hono hook contexts stay distinct for REST resources and operations.

Required focused tests:

- Generated starter snapshots.
- Hono hook and operation route tests.
- SQLite/Postgres/KV/Redis-like store tests.

Proof commands:

```bash
npm run check
node ./.tmp/test-build/scripts/run-tests.js src/generate/hono.test.js src/integrations/hono.test.js src/sqlite.test.js src/postgres.test.js src/kv.test.js
npm test
npm --cache /private/tmp/jsondb-npm-cache pack --dry-run
```

Stop conditions:

- Package tarball starts including source TypeScript, test files, generated
  runtime `.db/`, or optional dependency code paths that require unavailable
  packages.

## Current Verification Receipts

Completed on this audit branch:

```bash
npm run check
npm test
npm --cache /private/tmp/jsondb-npm-cache pack --dry-run
```

- `npm run check`: passed. It ran `npm run build`, `npm run build:test`, and
  `node ./.tmp/test-build/scripts/check-syntax.js`.
- `npm test`: passed. It ran `npm run build`, `npm run build:test`, and
  `node ./.tmp/test-build/scripts/run-tests.js`; Node's test runner reported
  452 passing tests, 0 failures, 0 skipped.
- `npm --cache /private/tmp/jsondb-npm-cache pack --dry-run`: passed. It ran the
  `prepack` build and produced a dry-run tarball for `@async/db@0.2.1` with 399
  files. The new `docs/architecture-refactor-audit.md` is included because
  `docs/**/*.md` is part of the package allowlist.
- `git status --short` after verification showed only this new audit document as
  an untracked change.
