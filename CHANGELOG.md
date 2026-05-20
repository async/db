# Changelog

This project does not have versioned releases yet. Until releases start, this file
tracks the repository history by feature area from the first commit onward.

Dates are commit dates from the git history. Changelog-only maintenance commits
are omitted. Commit links point at the canonical GitHub repository:
<https://github.com/PatrickJS/jsondb>.

## Feature History

### Unreleased

- Breaking: Replaced runtime mode config with store-based resource binding. Use `sources.writePolicy`, `stores.default`, named `stores`, and `resources.<name>.store`; legacy `mode`, `runtime.default`, `runtime.adapters`, and `resources.<name>.runtime` config is rejected with migration diagnostics.
- Added the first-party `sqliteStore()` export for opt-in resource stores, defaulting to `./.jsondb/runtime.sqlite`.
- Added `resources.<name>.indexes` metadata and `doctor` diagnostics for missing stores and large JSON-backed collections without index intent.
- Added `JsonFixtureDb.close()` so custom stores and SQLite-backed stores can release open handles in long-running processes.

### Project Foundation

- 2026-05-07 - Created the dependency-light Node.js ESM package with JSON/JSONC fixture loading, schema helpers, runtime mirror sync, generated TypeScript types, a CLI, and the basic example project. Commit [4ee9630](https://github.com/PatrickJS/jsondb/commit/4ee9630d84739f738eb8d6add2deb311ad725303).
- 2026-05-07 - Added CI, Dependabot, repository agent guidance, and the package check script. Commit [1d9600c](https://github.com/PatrickJS/jsondb/commit/1d9600cec0ea4a994436ce315e7ab9bb553bf9ce).
- 2026-05-07 - Clarified the basic README instructions for `db/users.json`. Commit [836aade](https://github.com/PatrickJS/jsondb/commit/836aade4dae66119983d06545fe003b5b549f2fb).

### Runtime API, REST, and Server

- 2026-05-07 - Added the REST runtime, GraphQL runtime, GraphQL parser, HTTP handlers, and protocol tests. Commit [d24dd9a](https://github.com/PatrickJS/jsondb/commit/d24dd9adb0a33e85d29dc921b9c055bfc644c31c).
- 2026-05-07 - Added structured `JsonDbError` handling for clearer API and server failures. Commit [f25659e](https://github.com/PatrickJS/jsondb/commit/f25659e66ff19f2fd0a32653784fbeef9994dad9).
- 2026-05-07 - Added schema-backed validation, request body limits, and safer batching behavior. Commit [af60a9c](https://github.com/PatrickJS/jsondb/commit/af60a9c4a98514aef1f56cb70530db7d15777dbf).
- 2026-05-11 - Renamed the package-facing API to `jsondb` and added an embeddable request handler for mounting jsondb into other servers. Commit [0b7f9d5](https://github.com/PatrickJS/jsondb/commit/0b7f9d51519f9f14fb8e9d97abb90a5ea062a96a).
- 2026-05-14 - Added pluggable runtimes, runtime write events, an HTTP feature registry, and a `/__jsondb/log` server-sent event stream. Commit [69337fa](https://github.com/PatrickJS/jsondb/commit/69337fa347fa20f6186f5afd70d95fb766c561ea).
- 2026-05-14 - Added the `source` runtime for reading and writing source-backed JSON fixtures, with source metadata hydration and dot-folder ignoring. Commit [80ecfff](https://github.com/PatrickJS/jsondb/commit/80ecfffcd8c969902f9552e0b421ff8adc9c7e96).
- 2026-05-14 - Avoided redundant disk writes by skipping unchanged output, preserving generated metadata, and centralizing source metadata updates. Commits [9ec39b1](https://github.com/PatrickJS/jsondb/commit/9ec39b11e0a93de72e6b62d3187a379aaccc4ede) and [c14e799](https://github.com/PatrickJS/jsondb/commit/c14e79933091f54a4ce98d9a7eb9e6c10ffd8085).
- 2026-05-14 - Added `JsonDbCollection.exists()` to the package API and SQLite adapter. Commit [9586d5f](https://github.com/PatrickJS/jsondb/commit/9586d5f2e1fc6211fe9cb2b2ba9b8f5e7bcfaabe).

### Client, Viewer, Examples, and Mocking

- 2026-05-07 - Added the HTTP client, automatic and direct batching, example projects, built-in viewer, and mock behavior tests. Commit [d8373b1](https://github.com/PatrickJS/jsondb/commit/d8373b16bf3b7d7aa7f1155b406b7082809c672c).
- 2026-05-07 - Added live reload, generated collection ids, source diagnostics, and viewer updates for broken source files. Commit [7e4cce7](https://github.com/PatrickJS/jsondb/commit/7e4cce7d9abc57cb68464add8aac0c8da5b14e2a).
- 2026-05-14 - Expanded the example catalog with metadata, richer READMEs, relations, REST client, and schema-manifest examples, plus a metadata-driven examples index. Commit [0b4d31e](https://github.com/PatrickJS/jsondb/commit/0b4d31e9329121a4e6c419451774e908360a021f).
- 2026-05-14 - Added the Hono auth example showing bearer-token auth, permission checks, lifecycle hooks, and write normalization. Commit [bbad836](https://github.com/PatrickJS/jsondb/commit/bbad8360b4524e43f6ddddbef823cb6693a41248).

### CSV Fixtures and Import

- 2026-05-07 - Added CSV fixture loading, CSV examples, viewer CSV import, and CSV-backed sync support. Commit [6312e0b](https://github.com/PatrickJS/jsondb/commit/6312e0bb4cccddbb2f264367dbfb6c5677dc9acb).
- 2026-05-11 - Added CSV array coercion for schema-backed CSV fixtures, including semicolon-delimited and JSON array string cells. Commit [28bf08b](https://github.com/PatrickJS/jsondb/commit/28bf08b2d3fa014180c0d6128159f358340e12c1).

### Schema Sources, Types, and Validation

- 2026-05-07 - Added `.schema.json` support and synthetic seed generation for schema-first resources. Commit [03a5da9](https://github.com/PatrickJS/jsondb/commit/03a5da95394177b3e7f714d0fd1abb2c103f84a9).
- 2026-05-11 - Added nullable fields, datetime fields, schema builder updates, and generated type support for those field shapes. Commit [28bf08b](https://github.com/PatrickJS/jsondb/commit/28bf08b2d3fa014180c0d6128159f358340e12c1).
- 2026-05-11 - Added field constraints and unique-field validation across sync, package API writes, REST writes, GraphQL mutations, and schema validation. Commit [d38aa6b](https://github.com/PatrickJS/jsondb/commit/d38aa6b3cc92018feb1818a34803c5bc8805cb21).
- 2026-05-14 - Added recursive nested fixture discovery, basename-derived resource names, recursive source watching, and nested schema-manifest context. Commit [27b3125](https://github.com/PatrickJS/jsondb/commit/27b3125047906b90a156594e5be29e88ff37f1ba).
- 2026-05-14 - Added the custom source readers pipeline for user-defined formats, built-in reader normalization, source hashes, and structured reader diagnostics. Commit [53604b9](https://github.com/PatrickJS/jsondb/commit/53604b93e162b4063655cdd49834ed6295cb5991).
- 2026-05-14 - Added `jsondb schema infer`, doctor guidance for adding or removing schemas, and discriminated object variants in inference, validation, manifests, and generated TypeScript types. Commits [9586d5f](https://github.com/PatrickJS/jsondb/commit/9586d5f2e1fc6211fe9cb2b2ba9b8f5e7bcfaabe) and [0d9bf62](https://github.com/PatrickJS/jsondb/commit/0d9bf62efc1259ea51fe043725d9a0b134b5ad38).
- 2026-05-14 - Added `jsondb schema bundle` / `unbundle` for moving inline seeds between schema and data fixtures, with mixed-mode warnings, safe output handling, overwrite controls, empty-seed support, and `--cwd`-relative output paths. Commits [f57a9cc](https://github.com/PatrickJS/jsondb/commit/f57a9ccb0d28d285ce208367b4291efa3aed2806), [c0cb2fa](https://github.com/PatrickJS/jsondb/commit/c0cb2fa2cf099dd51bf0f98358cb6fd288a28ae0), [e9618ec](https://github.com/PatrickJS/jsondb/commit/e9618ecb5e7e45e0c75f960edec96441043801f1), and [353c861](https://github.com/PatrickJS/jsondb/commit/353c861d085b7a58edf33ef379103a866aeb9f39).

### Configuration

- 2026-05-11 - Added configurable fixture directories with `dbDir`, while preserving `sourceDir` compatibility. Commit [d5371c8](https://github.com/PatrickJS/jsondb/commit/d5371c824d061e0bde11e8d9549dae7cc6709e9f).
- 2026-05-11 - Added `defineConfig`, config typings, the example config file, and expanded README configuration guidance. Commit [15f559b](https://github.com/PatrickJS/jsondb/commit/15f559b42ba319c3d4ebf166ced04c73737eaadb).

### REST Shaping and Relations

- 2026-05-11 - Added REST response shaping with `select`, `offset`, and `limit`; added explicit depth-1 to-one relation metadata and `expand` support. Commit [d9f7c70](https://github.com/PatrickJS/jsondb/commit/d9f7c7026d943a78ddf64688173e3c00089c6287).
- 2026-05-14 - Added REST response formats, fixture-based resource naming strategies, custom resource naming hooks, and duplicate-resource diagnostics. Commit [0c95b52](https://github.com/PatrickJS/jsondb/commit/0c95b5237d3d4530f6f5cdf534df1358943cc1dc).
- 2026-05-14 - Added canonical resource alias resolution and collision diagnostics across CLI commands, runtime APIs, REST, SQLite, generated starters, schema loading, and the viewer. Commit [b7089b1](https://github.com/PatrickJS/jsondb/commit/b7089b13d3cbca060d5b51fb04ccd8a89a87ad70).

### GraphQL

- 2026-05-11 - Added GraphQL `operationName` selection, named fragments, inline fragments, `@include`, `@skip`, `__typename`, and minimal `__schema` / `__type` introspection. Commit [f196625](https://github.com/PatrickJS/jsondb/commit/f196625f2eb6c57d03565b35b0bdb7cafcb26efb).

### Doctor and Fixture Diagnostics

- 2026-05-11 - Added `jsondb doctor` / `jsondb check`, JSON output, strict mode, fixture diagnostics, relation suggestions, and fork health checks. Commit [22cb816](https://github.com/PatrickJS/jsondb/commit/22cb8168daaa8779893e175ea23906e12a8f41fc).
- 2026-05-11 - Documented the `doctor` CLI health check behavior in the product spec. Commit [bf29064](https://github.com/PatrickJS/jsondb/commit/bf2906458c944b18fa4a57f6de02ef9aacb3f153).
- 2026-05-11 - Added the shape-layer MVP with the Vite plugin, REST shaping, relation support, and doctor work. Commit [bea5776](https://github.com/PatrickJS/jsondb/commit/bea5776816b6e20f65750e331e3b6330b59c7e51).

### Vite Integration

- 2026-05-11 - Added the dependency-light Vite dev-server plugin, scoped `/__jsondb` routes, optional root REST routes, and the `virtual:jsondb/client` module. Commit [d9f7c70](https://github.com/PatrickJS/jsondb/commit/d9f7c7026d943a78ddf64688173e3c00089c6287).
- 2026-05-14 - Documented Vite watch behavior, generated artifact ignores, and guidance for avoiding unnecessary reloads while keeping runtime imports visible. Commit [8e0c2a3](https://github.com/PatrickJS/jsondb/commit/8e0c2a3d9a35a64fa7676b3071a512d519e78dcf).

### Database Forks

- 2026-05-11 - Added configured database forks with separate fixture folders, fork-scoped runtime state, fork-aware clients, fork-scoped HTTP routes, Vite helpers, and diagnostics. Commit [1873c67](https://github.com/PatrickJS/jsondb/commit/1873c6724b93137fbf736fb8f2310444dfe4b088).

### Schema Manifest

- 2026-05-11 - Added committed schema manifest generation for model-driven admin/CMS UIs, including `schemaOutFile`, `jsondb schema manifest`, manifest render helpers, field UI hints, and customization hooks. Commit [7a2e819](https://github.com/PatrickJS/jsondb/commit/7a2e8197ec0d5f0dc391e17ed429693e80147d10).
- 2026-05-11 - Landed the schema manifest work through PR #5. Commit [11a2d8d](https://github.com/PatrickJS/jsondb/commit/11a2d8d31c97844d59d2ea7088fcd1ea0b40b686).
- 2026-05-14 - Added `customizeResource`, `mergeManifest`-based field and resource customization, resource naming support, and non-serializable customization diagnostics. Commit [0c95b52](https://github.com/PatrickJS/jsondb/commit/0c95b5237d3d4530f6f5cdf534df1358943cc1dc).

### Hono and SQLite Graduation Path

- 2026-05-07 - Added the Hono and SQLite starter generator, optional Hono integration, optional SQLite adapter, generation CLI, and related tests. Commit [4e4770e](https://github.com/PatrickJS/jsondb/commit/4e4770e71eb376a524562c2a739c2a41bc40b9ac).
- 2026-05-14 - Reused the opened Hono database promise in `jsonDbContext` so middleware calls share one opened database instance. Commit [434c7b6](https://github.com/PatrickJS/jsondb/commit/434c7b6be48320ff6d495f116a21a210d22b8f8b).
- 2026-05-14 - Added `registerRestRoutes` for Hono with route prefixes, resource include/exclude controls, method filters, global hooks, per-resource hooks, and short-circuiting. Commits [9586d5f](https://github.com/PatrickJS/jsondb/commit/9586d5f2e1fc6211fe9cb2b2ba9b8f5e7bcfaabe) and [0d9bf62](https://github.com/PatrickJS/jsondb/commit/0d9bf62efc1259ea51fe043725d9a0b134b5ad38).
- 2026-05-14 - Added Hono REST lifecycle hooks with `beforeRequest` and write-only `beforeWrite` handling, including hook ordering and short-circuit support. Commit [bbad836](https://github.com/PatrickJS/jsondb/commit/bbad8360b4524e43f6ddddbef823cb6693a41248).

### Maintenance

- 2026-05-07 - Ignored the temporary folder in git. Commit [ad4e52a](https://github.com/PatrickJS/jsondb/commit/ad4e52aac9ba2dc39eb320ec4262d660dfb7f2c3).
- 2026-05-11 - Bumped `actions/setup-node` from v4 to v6. Commit [d4b23e4](https://github.com/PatrickJS/jsondb/commit/d4b23e4dd614c9367e4dbb512755124384fb5918).
- 2026-05-11 - Bumped `actions/checkout` from v4 to v6. Commit [7dffcc0](https://github.com/PatrickJS/jsondb/commit/7dffcc0c70d5173fddf07ac23737a22dcabb9e49).
- 2026-05-14 - Split the monolithic test suite into focused test files for CLI, config, doctor, package, runtime, schema, sync, and examples coverage. Commit [e8e4e8e](https://github.com/PatrickJS/jsondb/commit/e8e4e8e208b90707e664a9717a474b7cc8bec4fd).
- 2026-05-14 - Extracted schema logic into feature modules for fields, generated metadata, project loading, relations, resources, sources, and validation. Commit [4503af8](https://github.com/PatrickJS/jsondb/commit/4503af8a19b6f6e1296347a90183c4eb93eef8c6).
- 2026-05-14 - Modularized the CLI, runtime, config, doctor, sync, integration, and generator code into feature and shared namespaces while preserving compatibility exports. Commit [d7de49b](https://github.com/PatrickJS/jsondb/commit/d7de49b66fa3f59e8dcaf4905edd73920cbc80a4).
- 2026-05-14 - Added the May 14 source-reader, runtime, REST formatting, resource naming, schema-manifest, and modularization work together. Commit [58ac729](https://github.com/PatrickJS/jsondb/commit/58ac729c7edf56da65512f2bd2e7181f1d7ff7f3).
- 2026-05-14 - Added architecture documentation, README and agent-guide cross-references, package globs for example metadata/source files, and command-specific CLI help handling. Commit [0b4d31e](https://github.com/PatrickJS/jsondb/commit/0b4d31e9329121a4e6c419451774e908360a021f).
- 2026-05-14 - Printed subcommand help before loading project config, with focused help for `types`, `schema`, `doctor`, `serve`, and `generate`. Commit [0ba1c13](https://github.com/PatrickJS/jsondb/commit/0ba1c13e9e3a4b4d35e5618fc94a7db3acfdfb9c).
- 2026-05-14 - Added redundant-write avoidance and generated metadata preservation together. Commit [d15b30c](https://github.com/PatrickJS/jsondb/commit/d15b30c938ee216e9765ca6ef8fecafa664d6e32).
