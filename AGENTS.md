# Repository Guide For AI Agents

## Project Shape

This repo is a dependency-light Node.js ESM package named `@async/db`.

Core responsibilities:

- Load data files from `db/*.json`, `db/*.jsonc`, and `db/*.csv`.
- Load schema sources from `db/*.schema.json`, `db/*.schema.jsonc`, and `db/*.schema.mjs`.
- Infer schemas from data-first files.
- Generate TypeScript types.
- Sync a writable runtime mirror into `.db/state`, using source hashes for JSON/JSONC/CSV refreshes.
- Expose a package API, CLI, and small local REST server.

Product direction:

- Async DB is data-first by default. Prefer inferring useful local contracts from seed data in data files before adding new required schema surface area.
- Explicit schema is the upgrade path for stricter contracts, field descriptions, defaults, constraints, relations, future variants, and app metadata that seed data cannot prove.
- When inference is ambiguous, emit diagnostics and `doctor` suggestions instead of guessing too hard or forcing schema immediately.
- Avoid broad JSON Schema compatibility unless the project explicitly chooses it. Focus Async DB-native features on the local data file workflow, generated types, REST/GraphQL metadata, and runtime store behavior.

Important files:

- `SPEC.md`: product behavior and acceptance criteria.
- `API_SURFACE.md`: public contract ledger and review anchor for package exports, CLI, runtime APIs, HTTP surfaces, generated contracts, and config boundaries.
- `docs/package-api.md`: user-facing package API reference with examples for CLI commands, runtime APIs, integrations, and package exports.
- `src/cli.js`: `db` command implementation.
- `src/schema.js`: source discovery, schema loading, inference, diagnostics, REST/GraphQL metadata.
- `src/types.js`: TypeScript type generation.
- `src/sync.js`: generated schema/types and runtime mirror sync.
- `src/db.js`: package runtime API.
- `src/server.js`: dependency-free local HTTP server entry point.
- `src/rest`: REST request routing and HTTP helpers.
- `src/graphql`: dependency-free GraphQL subset parser, executor, and HTTP handler.
- `src/web`: dependency-free built-in viewer served at `/__db`.
- `src/generate/hono.js`: Hono/SQLite starter code generator.
- `src/hono.js`: optional Hono integration using dynamic `hono` import.
- `src/sqlite.js`: optional SQLite adapter using dynamic `node:sqlite` import.
- `src/client.js`: tiny HTTP client with GraphQL and REST batching support.
- `scripts/serve-examples.js`: binds one examples host, renders the examples index, and lazily starts example runtimes when opened.
- `scripts/example-launcher.js`: resolves `examples/*/serve-example.mjs` hooks so an example can compose middleware ahead of db; defaults to a stock db request runtime.
- `website/`: docs site consumer project. `website/db.schema.js` curates `docs/*.md` in the `pages` collection and `docs/advanced/*.md` in the `advanced` collection; `website/build.js` renders static HTML under `dist/docs/` plus a generated `dist/docs/examples.html` IDE-style browser of every `examples/*` project (ordered by `example.json` level/order, intros from README `## What This Teaches`); `website/serve.js` is the live preview server; `website/pages/index.html` is the only hand-authored HTML page (landing teaser injects `CodeExplorer` at build/serve time).
- `src/schema-builders.js`: `.schema.mjs` authoring helpers exported as `@async/db/schema`.
- `tests/helpers.js`: shared test project helpers.
- `tests/**/*.test.js`: general Node test runner suite.
- `src/**/*.test.js`: co-located protocol/module tests.
- `examples/basic`: smoke-testable example project.

Common edit paths:

- Public API surface or user-facing package usage: update `API_SURFACE.md` for the contract ledger and `docs/package-api.md` for reference/examples when the same change affects both.
- Source discovery or custom readers: start in `src/features/schema/sources.js`.
- Schema inference or field normalization: start in `src/features/schema/fields.js` and `src/features/schema/resource.js`.
- Schema validation or diagnostics: start in `src/features/schema/validation.js`.
- Runtime mirror sync or generated outputs: start in `src/features/sync/index.js`, `src/types.js`, and `src/schema-manifest.js`.
- Package runtime APIs: start in `src/features/runtime/collection.js`, `src/features/runtime/document.js`, and `src/features/runtime/db.js`.
- REST routes, request bodies, and response shaping: start in `src/rest/handler.js` and `src/rest/shape.js`.
- GraphQL parsing or execution: start in `src/graphql/parser.js` and `src/graphql/execute.js`.
- Built-in viewer behavior: start in `src/web/viewer.js`.
- CLI command behavior: start in `src/cli/index.js` and `src/cli/commands/`.
- Example discovery and the examples index: start in `scripts/serve-examples.js`, `scripts/example-launcher.js`, and `examples/*/example.json`. Optional per-example `serve-example.mjs` exports `createExampleRuntime({ cwd, basePath, url, repoRoot })`.

## Commands

Use these while actively editing the package:

```bash
pnpm run dev          # watch src and relaunch all examples
pnpm run examples     # one-shot all examples server for smoke checks
pnpm run docs:dev     # live docs preview from website/
pnpm run docs:build   # static docs build to website/dist/
pnpm run watch        # compile dist and test-build in watch mode only
pnpm run cli -- sync --cwd ./examples/basic
```

Keep npm task entrypoints under `scripts/tasks/`. Keep reusable helper scripts directly under `scripts/`.

Run these before handing off changes:

```bash
pnpm run check
pnpm run api-surface:check
pnpm run test
npm pack --dry-run
```

Useful CLI smoke checks:

```bash
node ./src/cli.js sync --cwd ./examples/basic
node ./src/cli.js schema validate --cwd ./examples/basic
node ./src/cli.js create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}' --cwd ./examples/basic
pnpm run examples
```

The local REST server binds a loopback port. In sandboxed environments this may require explicit approval:

```bash
node ./src/cli.js serve --cwd ./examples/basic
```

## Generated Files

`.db/` is generated runtime output and should normally stay uncommitted.

`website/.db/` and `website/dist/` are generated docs-site output and should stay uncommitted.

Committed generated types are allowed when configured through `types.commitOutFile`. The examples and docs site intentionally include:

```txt
examples/advanced/src/generated/db.types.ts
examples/basic/src/generated/db.types.ts
examples/schema-first/src/generated/db.types.ts
examples/schema-manifest/src/generated/db.types.ts
examples/schema-ui/src/generated/db.types.ts
website/src/generated/db.types.d.ts
```

Committed schema manifests are allowed when configured through `schemaOutFile`. The schema manifest example intentionally includes:

```txt
examples/schema-manifest/src/generated/db.schema.json
examples/schema-manifest/src/generated/db.types.ts
examples/schema-ui/src/generated/db.schema.json
examples/schema-ui/src/generated/db.types.ts
```

If a smoke command writes `.db/` inside any example, remove those generated files before finalizing unless the task explicitly asks to commit generated runtime state.

## Implementation Rules

- Keep the package ESM and dependency-light. Prefer Node standard library APIs unless a feature clearly needs a dependency.
- `API_SURFACE.md` is the current-state public contract ledger, not a tutorial or changelog. Update it whenever a change adds, removes, renames, or changes package exports, declaration names, CLI commands/flags/output, runtime package methods, HTTP routes, generated contract shapes, or config keys. If a public-adjacent change does not require an `API_SURFACE.md` update, be ready to explain why.
- `docs/package-api.md` is the user-facing package API reference. Update it when a public API or CLI behavior needs discoverable usage guidance, examples, option documentation, or migration notes.
- When a change both alters a public contract and changes how users should call it, update both files: `API_SURFACE.md` for the contract boundary and `docs/package-api.md` for the usage/reference story.
- Preserve support for Node.js 24 and newer.
- Treat `.schema.mjs`, `db.config.mjs`, source readers, format renderers, and schema manifest hooks as trusted project code because they execute locally.
- Remember that `async-db serve` exposes writable local development endpoints on loopback by default, and the viewer CSV import endpoint writes into the configured `dbDir`.
- Keep schema source support focused on `.json`, `.jsonc`, `.csv`, `.schema.json`, `.schema.jsonc`, and `.schema.mjs`.
- Do not add TypeScript schema execution in v1 without adding an explicit loader/build story.
- When adding schema features, first ask whether the same value can be inferred from data files. If not, add the smallest db-native schema shape and pair it with `doctor` guidance when useful.
- Schema files are authoritative in mixed mode; data files provide seed records.
- Default local behavior for unknown fields is warning, with strict mode available through `schema.unknownFields: 'error'`.
- Defaults should apply on create and safe additive store hydration unless config disables them.
- Field `description` values should feed generated TypeScript JSDoc and GraphQL SDL descriptions.
- Collection data files without `id` should receive counter ids in the selected runtime store. Default JSON store behavior must not rewrite source files; the `sourceFile` store may write generated ids back to plain `.json` data files.
- `async-db serve` watches `db/` for source changes, ignores `.db/`, reloads valid resources, and surfaces file-specific diagnostics in the viewer without breaking unrelated resources.
- Keep Hono and SQLite optional. Do not add mandatory package dependencies for `hono`, `@hono/node-server`, or SQLite libraries; generated starters may declare their own dependencies.
- `async-db generate hono` should fail on schema errors and block warning diagnostics unless explicitly allowed with `--allow-warnings`.

## Testing Guidance

Use `node:test` and temporary project directories under the system temp directory. Tests should create their own `db/` data files and avoid depending on generated repo state.

Put broad package behavior in `tests/*.test.js`. Put protocol-specific tests next to their implementation, such as `src/graphql/graphql.test.js` and `src/rest/handler.test.js`.

When testing `.schema.mjs`, symlink this repo into the temp project's `node_modules/@async/db` so package self-imports behave like a consumer install.

Add tests for every behavior change that touches:

- data file discovery
- schema inference
- mixed-mode diagnostics
- generated types
- defaults
- CLI path handling
- Hono/SQLite starter generation output shape
- optional SQLite behavior, gated when `node:sqlite` is unavailable
- runtime collection/document APIs
- server routes
- GraphQL parser/executor behavior, especially aliases, variables, and mutations
- GraphQL and REST batching behavior
- client direct and automatic batching behavior, including 10ms default windows and dedupe
- mock delay/error behavior
- error messages; assert code, human message, hint, and useful details for new failure modes
- built-in viewer behavior and generated examples
- docs site build output, link rewriting, and allowlist enforcement in `website/`

## GitHub Actions

CI is generated from `pipeline.ts` into `.github/workflows/async-pipeline.yml`
and runs on Node.js 24:

- `pnpm run check`
- `pnpm run test`
- `npm pack --dry-run`

Docs site deployment is generated from the `pages` job in `pipeline.ts` and
publishes `.async/pages/` to GitHub Pages on pushes to `main`.

Dependabot is configured in `.github/dependabot.yml` for GitHub Actions updates.
