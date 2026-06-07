# @async/db

`@async/db` gives frontend teams a gradual path from mock JSON to production data contracts. You can keep easy fixture files where they work, use the first-party JSON file database for small low-write resources, and move other resources to SQLite, Postgres, or custom stores as they get serious. The app keeps talking to one data layer while persistence changes behind each resource.

Use it to:

- Start from editable JSON, JSONC, or CSV fixtures in `db/`.
- Infer schema contracts and generate TypeScript types from fixtures and schemas.
- Serve local REST routes and a lightweight viewer while the backend contract is still forming.
- Upgrade persistence per resource without rewriting frontend data access.
- Keep static fixtures, the first-party JSON file database, SQLite, Postgres, KV/Redis-like stores, and custom stores behind the same app-facing resource model.
- Emit schema metadata for admin, CMS, or form-building screens.

`@async/db` is not a universal key/value driver layer; storage is one boundary inside the fixture-to-contract workflow.

## File Map

| Files | Purpose |
| --- | --- |
| `db/*.json`, `db/*.jsonc`, `db/*.csv` | Fixture data |
| `db/*.schema.json`, `db/*.schema.jsonc`, `db/*.schema.js` | Optional stricter schema contracts |
| `db.schema.js` | Optional root schema registry for all resources |
| `db/<resource>/index.schema.js` | Folder-backed content collection marker |
| `.db/state/*` | Generated writable JSON store state |
| `.db/schema.generated.json`, `.db/types/index.d.ts` | Generated metadata and types |

## Quick Summary

Most projects can start with the defaults:

1. Put fixtures in `db/`.
2. Run `async-db sync` to generate schema metadata, TypeScript types, and runtime state.
3. Run `async-db serve` to start the local API and viewer.
4. Open `http://127.0.0.1:7331/__db`.
5. Call REST routes like `GET /db/users.json` and `POST /db/users`.
6. Add per-resource schemas or `db.schema.js` only when the fixture shape needs a clearer contract.

The default server is REST-first. GraphQL is available at `/graphql`, but you do not need it for the core workflow.

## Examples

Start with [`examples/basic`](./examples/basic) for the shortest schema-backed workflow.

Other useful paths:

- [`examples/data-first`](./examples/data-first): plain fixtures before schemas exist.
- [`examples/content-collections`](./examples/content-collections): docs and blog folders as static content collections.
- [`examples/computed-fields`](./examples/computed-fields): computed field patterns across several schema-backed models.
- [`examples/production-json`](./examples/production-json): feature flags and settings in the JSON store behind registered operations.
- [`examples/rest-client`](./examples/rest-client): calling @async/db from app or test code.
- [`examples/local-web-app`](./examples/local-web-app): loopback app state saved directly to `db/*.json`.
- [`examples/schema-manifest`](./examples/schema-manifest): schema metadata for admin/CMS UI.
- [`examples/standard-schema`](./examples/standard-schema): Standard Schema validators with Async DB metadata overlays.
- [`examples/hono-auth`](./examples/hono-auth): optional Hono auth and write hooks.

See [Which Example Should I Start With?](#which-example-should-i-start-with) for the full examples map.

## Install

Install the published package in the app or package that will use it:

```bash
npm install @async/db
```

Add package scripts for the CLI commands you want to run often:

```json
{
  "scripts": {
    "db": "async-db",
    "db:sync": "async-db sync",
    "db:serve": "async-db serve",
    "db:types": "async-db types"
  }
}
```

If you need an unreleased fix, pin a reviewed GitHub commit or release tag instead of the moving default branch:

```json
{
  "devDependencies": {
    "@async/db": "github:async-framework/async-db#<reviewed-commit-sha-or-tag>"
  }
}
```

The package import name is `@async/db`; helpers are available from `@async/db/config`, `@async/db/schema`, `@async/db/client`, and `@async/db/json`. The root package exports runtime helpers such as `openDb()` and schema contract helpers such as `loadDbSchema()`.

## Five-Minute Start

Create a fixture:

```bash
mkdir -p db
cat > db/users.json <<'JSON'
[
  {
    "id": "u_1",
    "name": "Ada Lovelace",
    "email": "ada@example.com"
  }
]
JSON
```

Sync generated metadata, types, and runtime state:

```bash
npm run db:sync
```

Start the local API and viewer in terminal 1:

```bash
npm run db:serve
```

Open the viewer:

```txt
http://127.0.0.1:7331/__db
```

Call the REST API from terminal 2:

```bash
curl http://127.0.0.1:7331/db/users.json
```

Create a local record:

```bash
curl -X POST http://127.0.0.1:7331/db/users \
  -H 'content-type: application/json' \
  -d '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
```

The default sync output is generated:

```txt
.db/schema.generated.json
.db/types/index.d.ts
.db/state/users.json
```

`serve` syncs on startup, watches the fixture folder, refreshes valid resources when files change, and surfaces file-specific diagnostics in the viewer without breaking unrelated resources.

See [docs/getting-started.md](./docs/getting-started.md) for the expanded walkthrough.

## Operational Contract

| Behavior | Default |
| --- | --- |
| Source fixtures | Read from `./db` recursively. |
| App data routes | Exposed under `/db` by default, such as `GET /db/users.json`. |
| Runtime writes | Go to the default JSON store under `.db/state`. |
| Source writes | Only happen for resources bound to the `sourceFile` store, and only for supported writebacks such as generated ids in plain `.json` collections. |
| Optional stores | SQLite, Postgres, generic KV, and Redis-like stores plug into the same runtime store boundary without adding mandatory database client dependencies. |
| Generated output | `.db/` is runtime output and normally stays uncommitted. |
| Schema contract API | `loadDbSchema({ from })` loads metadata only by default; `openDb({ schema })` opens the runtime database from the same schema locator. |
| Local server | Binds to `127.0.0.1:7331` by default and exposes writable local development endpoints. |
| Trusted code | `.schema.js`, `db.config.mjs`, source readers, and manifest hooks execute as local project code. |
| Mock latency | Responses include a small `30-100ms` delay by default so loading states are visible. |

The built-in JSON store is production-appropriate only for file-suitable resources: app settings, feature flags, content, templates, plan definitions, policy rules, seed data, and other small low-write data that can safely live with a single writer. Keep high-write user data, chat/messages, analytics/events, ledgers, inventory counters, multi-writer data, and compliance-heavy transactional records in SQLite, Postgres, or another app-owned store.

@async/db is not an auth layer, an ORM, a hosted database service, or a broad JSON Schema compatibility project. For production-facing APIs, put app traffic behind registered operations, app-owned auth/authorization, rate limits, and observability. See [Production JSON Database](./docs/json-production.md), [Resource Graduation And Mixed Stores](./docs/store-graduation.md), and [Prototype To Production REST Guide](./docs/prototype-to-production.md).

When another app consumes your data, define a `contracts` boundary in
`db.config.mjs`. Contracts list the resources, fields, operations, and writes a
consumer is allowed to use. Generate starting points with
`async-db contracts infer --from-tags`, scan callers with
`async-db contracts infer --from-usage`, validate with
`async-db contracts check`, and emit contract-scoped refs with
`async-db contracts refs`.

## Save Directly To `db/*.json`

The default `json` store keeps source fixtures unchanged and writes app edits to
the generated mirror under `.db/state`. For small local apps where saved state
should live in the project folder, use the `sourceFile` store:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  stores: {
    default: 'sourceFile',
  },
});
```

Now writes to plain JSON resources update `db/<resource>.json` directly.
Override individual resources when some data should still use the mirror:

```js
export default defineConfig({
  stores: {
    default: 'sourceFile',
  },
  resources: {
    importedRows: { store: 'json' },
  },
});
```

See [`examples/local-web-app`](./examples/local-web-app) for a loopback app that
saves on blur/change, keeps server state canonical, and uses browser storage
only for transient reload recovery.

For simple local websites, keep the shape boring:

```txt
db/          saved JSON documents and seed data
src/         browser HTML, CSS, and app code
server/      loopback request handlers and @async/db mounting
framework/   small reload, draft, and DOM helpers
```

Run `async-db sync` in that loop even when every resource uses `sourceFile`.
Sync still validates the fixture folder, infers the schema, and writes generated
metadata/types for tools. The difference is that app writes go back to plain
`db/*.json` instead of the `.db/state` mirror, so the project folder contains
the state you want to save, copy, or commit.

## Open With An In-Memory Filesystem

`openDb()` can take a filesystem adapter when a tool, test, or embedded runtime
needs to boot from virtual files and keep generated output out of the real
project folder:

```js
import { createMemoryFs, openDb } from '@async/db';

const fs = createMemoryFs({
  cwd: '/virtual-app',
  files: {
    'db/users.json': JSON.stringify([
      { id: 'u_1', name: 'Ada Lovelace' },
    ]),
  },
});

const db = await openDb({
  cwd: '/virtual-app',
  fs,
  stores: {
    default: 'json',
  },
});

await db.collection('users').create({
  id: 'u_2',
  name: 'Grace Hopper',
});

const state = await fs.readFile('/virtual-app/.db/state/users.json', 'utf8');
```

The adapter is used for fixture reads, generated outputs, JSON runtime state,
`sourceFile` writebacks, operations manifests, forks, branches, and snapshots.
Executable local code such as `db.config.mjs` and `.schema.js` still runs
through Node's module loader, so virtual projects should use inline options or
JSON/JSONC/CSV schema sources.

## Add Schema When It Pays For It

Data-first fixtures are enough until the shape matters. Inspect what @async/db infers:

```bash
npm run db -- schema infer
npm run db -- schema infer users
npm run db -- schema infer users --out db/users.schema.jsonc
```

Add `db/users.schema.json`, `db/users.schema.jsonc`, or `db/users.schema.js` when you need stricter behavior:

```json
{
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": { "type": "string", "required": true },
    "name": { "type": "string", "required": true },
    "email": {
      "type": "string",
      "required": true,
      "unique": true,
      "description": "Email address used for local sign-in."
    },
    "role": {
      "type": "enum",
      "values": ["admin", "user"],
      "default": "user"
    }
  }
}
```

Then validate:

```bash
npm run db -- schema validate
```

In mixed mode, schema files define the contract and data files provide seed records. Unknown fields warn by default; configure `schema.unknownFields: 'error'` when drift should fail.

Schema defaults fill omitted fields on create and safe additive runtime hydration. Updates, patches, and document puts preserve omitted fields; include a field in the write body when you want to change it.

Executable `.schema.js` files can also accept Standard Schema-compatible validators:

```js
import { collection, field } from '@async/db/schema';

export default collection({
  validator: UserSchema,
  fields: {
    email: field.string({ required: true, unique: true }),
    displayName: field.computed(field.string(), ({ record }) => record.email),
  },
});
```

The validator owns runtime parsing through `~standard.validate`; Async DB overlays keep generated metadata, relations, defaults, and computed resolvers. Async validators run in package, REST, and GraphQL writes. Sync schema helpers throw `DB_SCHEMA_ASYNC_VALIDATOR_REQUIRED` when the validator returns a Promise; use `validateAsync()` or `assertAsync()` for that path.

See [docs/concepts.md](./docs/concepts.md) and [docs/fixtures-and-schemas.md](./docs/fixtures-and-schemas.md).

## Validate Or Resolve From Schema

Use `loadDbSchema({ from })` when server code wants schema validation or field
resolver access without opening stores:

```ts
import { loadDbSchema, openDb } from '@async/db';

const schema = await loadDbSchema({ from: './db.schema.js' });
const input = schema.validator('users', { unknownFields: 'strip' }).assert(await request.json());

const userResolvers = schema.resolver('users', {
  value: input,
  context: { locale: 'en-US', nameFormatter },
});

const fullName = await userResolvers.fullName();
const db = await openDb({ schema });
```

Validators reject computed and read-only fields. Resolver functions receive a
delegated `this` context with `this.get(name)`, so app-provided context can
override internal values while `this._internal` still exposes the original
runtime view.

## Admin/CMS Schema Metadata

Schemas can also drive local admin, CMS, custom data viewers, and form-building screens. Use `GET /__db/manifest.json` at runtime when a UI runs beside `async-db serve`, or configure `outputs.viewerManifest` when app code needs a committed JSON artifact with the same viewer metadata. Browser requests can open `GET /__db/manifest.html`; AI clients can use `GET /__db/manifest.md`; `GET /__db/manifest` lets the `Accept` header choose among registered response formats.

Use `outputs.schemaManifest` when an app only needs the smaller model metadata file without server route links, diagnostics, or viewer capabilities.

```js
import { defineConfig, mergeManifest } from '@async/db/config';

export default defineConfig({
  outputs: {
    schemaManifest: './src/generated/db.schema.json',
    viewerManifest: './src/generated/db.viewer.json',
  },

  server: {
    viewerLinks: [
      { label: 'App Data Viewer', href: 'http://127.0.0.1:5173/db' },
    ],
  },

  schemaManifest: {
    customizeResource({ file, defaultManifest }) {
      // Group fields by source folder so an admin shell can show CMS records
      // separately from operational data without hard-coding that in the UI.
      return mergeManifest(defaultManifest, {
        editor: {
          group: file?.startsWith('db/cms/') ? 'CMS' : 'Data',
        },
      });
    },

    customizeField({ fieldName, path, defaultManifest }) {
      if (fieldName.endsWith('Markdown')) {
        // Markdown body fields need a richer editor than a plain text input,
        // but the fixture record should still stay normal JSON data.
        return mergeManifest(defaultManifest, {
          ui: { component: 'markdown' },
        });
      }

      if (path === 'blocks.chartId') {
        // Relation ids stay as strings in fixtures, while the generated
        // manifest tells the admin UI to render a picker backed by charts.
        return mergeManifest(defaultManifest, {
          ui: {
            component: 'relation-select',
            relationTo: 'charts',
          },
        });
      }

      return defaultManifest;
    },
  },
});
```

The generated manifest is metadata output; schema defaults and validation still come from the schema contract. Actual records stay on REST or GraphQL routes, so a custom viewer fetches `manifest.json` for fields and route links, then calls the listed resource routes for rows. `server.viewerLinks` exposes custom viewer URLs in root discovery and the shared manifest.

See [docs/generated-files.md](./docs/generated-files.md) and [examples/schema-manifest](./examples/schema-manifest).

## Common Commands

With the `db` script from the install snippet:

```bash
npm run db -- sync
npm run db -- types
npm run db -- types --watch
npm run db -- types --out ./src/generated/db.types.d.ts
npm run db -- schema
npm run db -- schema users
npm run db -- schema infer users
npm run db -- schema validate
npm run db -- integrate inspect ./src --sqlite ./data/app.sqlite
npm run db -- doctor
npm run db -- check --strict
npm run db -- create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
npm run db -- serve
npm run db -- generate hono
```

With pnpm and the same `"db": "async-db"` script:

```bash
pnpm db sync
pnpm db schema validate
pnpm db serve
```

See [docs/package-api.md](./docs/package-api.md) for CLI and package export details.

## REST, GraphQL, Falcor, And Viewer

The local server exposes REST routes for collections and singleton documents, plus focused GraphQL and Falcor endpoints at `/graphql` and `/model.json`. REST remains the default path because it pairs directly with the viewer and local fixture workflow.
Set `rest.enabled: false` when an app wants schema, manifest, viewer, import, events, GraphQL, and Falcor routes without generated REST resource routes or REST batching.
Set `graphql.enabled: false` when an app wants REST and dev-tool routes without a GraphQL endpoint.
Set `falcor.enabled: false` when an app wants REST, GraphQL, and dev-tool routes without a Falcor JSONGraph endpoint.
Run `async-db usage scan --production` to produce a source-scan usage manifest with endpoint exposure recommendations.

```txt
GET     /db/users.json
GET     /db/users/:id.json
POST    /db/users
PATCH   /db/users/:id
DELETE  /db/users/:id

GET     /db/settings.json
PUT     /db/settings
PATCH   /db/settings
```

Standalone dev also exposes canonical REST aliases and a meta batch endpoint:

```txt
GET     /resources/users
GET     /resources/users/:id
POST    /resources/users
PATCH   /resources/users/:id
DELETE  /resources/users/:id
POST    /batch
```

Bulk resource requests use the collection route: `POST /resources/users` accepts an array of records, `PATCH /resources/users` accepts `{ "ids": [...], "patch": {...} }` or per-record patch items, `PUT /resources/users` replaces listed records, and `DELETE /resources/users?id=u_1&id=u_2` deletes multiple records.

Use `select`, `offset`, and `limit` when a prototype only needs part of a collection:

```bash
curl 'http://127.0.0.1:7331/db/users.json?select=id,name&offset=0&limit=20'
curl 'http://127.0.0.1:7331/db/users.json?id=u_1&select=id,name'
```

The `?id=` shortcut is only for explicit JSON routes. Extensionless REST routes
use normal record URLs such as `/db/users/u_1`.

The `.json` route is a fixture-like URL for the synced runtime resource:
`db/users.json` maps to `GET /db/users.json`, while local writes still go to
the selected runtime store. See [Fixture-Like `.json` Routes](./docs/server-and-viewer.md#fixture-like-json-routes).

GraphQL remains available at `/graphql`, and Falcor browser clients can point `falcor.HttpDataSource` at `/model.json`. Scoped aliases also exist under the tool base as `/__db/graphql`, `/__db/model.json`, and `/__db/batch` for embedded dev servers.

The viewer at `/__db` lets you inspect resources, import CSV files into the configured fixture folder, view generated schema metadata, read GraphQL SDL/operation references, and try REST requests without writing client code first.

The built-in viewer and custom viewer UIs use the same JSON manifest at `/__db/manifest.json`. `/__db/manifest.html` opens a formatted JSON viewer, `/__db/manifest.md` returns an AI-friendly Markdown wrapper, and `/__db/manifest` chooses from registered media types in `Accept`. Apps can use `api.formats` from the manifest to discover supported extensions and build their own viewer UI against REST, GraphQL, or Falcor records.

See [docs/server-and-viewer.md](./docs/server-and-viewer.md). When local
`/db/*` routes are ready to become `/api/db/*` or `/api/*` production API
routes, see the
[Prototype To Production REST Guide](./docs/prototype-to-production.md).

## Which Example Should I Start With?

The examples are a learning path. Run most examples with `npm run db -- sync --cwd ./examples/<name>` and `npm run db -- serve --cwd ./examples/<name>`, or run `npm run examples` to open one lazy examples index. Use `npm run examples` for examples with custom app routes such as `local-web-app` and `schema-ui`. The examples index binds to `127.0.0.1` by default; use `npm run examples -- --tailscale-serve` when you want Tailscale Serve to proxy that local port over HTTPS for devices in your tailnet.

| If you want to learn... | Start with | What it shows |
| --- | --- | --- |
| The shortest schema-backed workflow | [`examples/basic`](./examples/basic) | Sync, viewer, REST create, committed generated types |
| Plain data before schemas exist | [`examples/data-first`](./examples/data-first) | Inferred collections, documents, routes, and types |
| Docs and blog folders as content collections | [`examples/content-collections`](./examples/content-collections) | `index.schema.mjs`, `files(..., { read })`, raw MDX bodies, config-owned static stores, computed fields |
| Different computed field patterns | [`examples/computed-fields`](./examples/computed-fields) | Shorthand resolvers, `resolveMany`, formatting, and runtime-context lookups |
| Contract-first resources | [`examples/schema-first`](./examples/schema-first) | Schema-only resources, empty seed records, committed types |
| Calling @async/db from app or test code | [`examples/rest-client`](./examples/rest-client) | `createDbClient`, direct REST calls, REST batching |
| Local app state saved in the project | [`examples/local-web-app`](./examples/local-web-app) | `stores.default: 'sourceFile'`, blur/change saves, transient reload state, custom example runtime |
| Related local records | [`examples/relations`](./examples/relations) | Relation metadata, `expand`, and nested `select` |
| CSV as the source of truth | [`examples/csv`](./examples/csv) | CSV inference, source hashes, mirror refreshes |
| Admin/CMS-style field metadata | [`examples/schema-manifest`](./examples/schema-manifest) | `outputs.schemaManifest` and manifest customization |
| Schema JSON to simple CMS UI templates | [`examples/schema-ui`](./examples/schema-ui) | `serve.mjs` SSR view/editor HTML from manifest + mirror (`node ./examples/schema-ui/serve.mjs`); `/templates` route keeps static placeholders |
| Standard Schema validators | [`examples/standard-schema`](./examples/standard-schema) | Dependency-free Standard Schema validation, `field.meta(...)` overlays, async write validation, computed fields, and conservative type fallback |
| Diagnostics for schema/data drift | [`examples/diagnostics`](./examples/diagnostics) | Warnings surfaced without breaking unrelated resources |
| Production-suitable JSON control data | [`examples/production-json`](./examples/production-json) | Feature flags, app settings, explicit schemas, and registered operation refs |
| Several advanced features together | [`examples/advanced`](./examples/advanced) | `.schema.mjs`, mixed mode, defaults, nested objects |
| Hono auth and write hooks | [`examples/hono-auth`](./examples/hono-auth) | Optional Hono integration with auth lifecycle hooks |

Each example README is the runnable authority for that example.

## Docs Map

| Task | Read |
| --- | --- |
| Start a project | [docs/getting-started.md](./docs/getting-started.md) |
| Understand the model | [docs/concepts.md](./docs/concepts.md) |
| Author fixtures and schemas | [docs/fixtures-and-schemas.md](./docs/fixtures-and-schemas.md) |
| Manage generated output | [docs/generated-files.md](./docs/generated-files.md) |
| Configure @async/db | [docs/configuration.md](./docs/configuration.md) |
| Use JSON in production safely | [docs/json-production.md](./docs/json-production.md) |
| Serve local data and use REST/GraphQL/viewer | [docs/server-and-viewer.md](./docs/server-and-viewer.md) |
| Graduate REST prototypes to production API routes | [docs/prototype-to-production.md](./docs/prototype-to-production.md) |
| Use the package API, CLI, or exports | [docs/package-api.md](./docs/package-api.md) |
| Review public API surface changes | [API_SURFACE.md](./API_SURFACE.md) |
| Integrate with Vite, Hono, or SQLite | [docs/integrations.md](./docs/integrations.md) |
| Understand implementation boundaries | [docs/architecture.md](./docs/architecture.md) |
| Work on the repo or publish releases | [CONTRIBUTING.md](./CONTRIBUTING.md) |

For the full product behavior and acceptance model, see [SPEC.md](./SPEC.md).
