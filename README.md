# @async/db

@async/db is the Async data workflow package for local fixtures, generated APIs, and production graduation.

Use it to:

- Put editable JSON, JSONC, or CSV fixtures in `db/` as the built-in prototype source mode.
- Browse records in a lightweight built-in viewer.
- Call local REST routes while the backend contract is still forming.
- Generate TypeScript types from fixtures and schemas.
- Emit schema metadata for admin, CMS, or form-building screens.
- Start data-first, then graduate toward SQLite-backed APIs when stricter contracts and production storage pay for themselves.

## File Map

| Files | Purpose |
| --- | --- |
| `db/*.json`, `db/*.jsonc`, `db/*.csv` | Fixture data |
| `db/*.schema.json`, `db/*.schema.jsonc`, `db/*.schema.mjs` | Optional stricter schema contracts |
| `.db/state/*` | Generated writable JSON store state |
| `.db/schema.generated.json`, `.db/types/index.ts` | Generated metadata and types |

## Quick Summary

Most projects can start with the defaults:

1. Put fixtures in `db/`.
2. Run `async-db sync` to generate schema metadata, TypeScript types, and runtime state.
3. Run `async-db serve` to start the local API and viewer.
4. Open `http://127.0.0.1:7331/__db`.
5. Call REST routes like `GET /db/users.json` and `POST /db/users`.
6. Add schema only when the fixture shape needs a clearer contract.

The default server is REST-first. GraphQL is available at `/graphql`, but you do not need it for the core workflow.

## Examples

Start with [`examples/basic`](./examples/basic) for the shortest schema-backed workflow.

Other useful paths:

- [`examples/data-first`](./examples/data-first): plain fixtures before schemas exist.
- [`examples/rest-client`](./examples/rest-client): calling @async/db from app or test code.
- [`examples/schema-manifest`](./examples/schema-manifest): schema metadata for admin/CMS UI.
- [`examples/hono-auth`](./examples/hono-auth): optional Hono auth and write hooks.

See [Which Example Should I Start With?](#which-example-should-i-start-with) for the full examples map.

## Install

Until the package is published, install it from GitHub in the app or package that will use it. Pin a reviewed commit SHA or release tag instead of the moving default branch:

```json
{
  "devDependencies": {
    "@async/db": "github:PatrickJS/async-db#<reviewed-commit-sha-or-tag>"
  },
  "scripts": {
    "db": "async-db",
    "db:sync": "async-db sync",
    "db:serve": "async-db serve",
    "db:types": "async-db types"
  }
}
```

Replace the placeholder with the commit SHA or tag you reviewed. After package publication, prefer the published semver version. Then run:

```bash
npm install
```

The package import name is `@async/db`; helpers are available from `@async/db/config`, `@async/db/schema`, and `@async/db/client`.

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
.db/types/index.ts
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
| Generated output | `.db/` is runtime output and normally stays uncommitted. |
| Local server | Binds to `127.0.0.1:7331` by default and exposes writable local development endpoints. |
| Trusted code | `.schema.mjs`, `db.config.mjs`, source readers, and manifest hooks execute as local project code. |
| Mock latency | Responses include a small `30-100ms` delay by default so loading states are visible. |

@async/db is local development/test infrastructure. It is not a production database, not an auth layer, and not a broad JSON Schema compatibility project.

## Add Schema When It Pays For It

Data-first fixtures are enough until the shape matters. Inspect what @async/db infers:

```bash
npm run db -- schema infer
npm run db -- schema infer users
npm run db -- schema infer users --out db/users.schema.jsonc
```

Add `db/users.schema.json`, `db/users.schema.jsonc`, or `db/users.schema.mjs` when you need stricter behavior:

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

See [docs/concepts.md](./docs/concepts.md) and [docs/fixtures-and-schemas.md](./docs/fixtures-and-schemas.md).

## Admin/CMS Schema Metadata

Schemas can also drive local admin, CMS, custom data viewers, and form-building screens. Use `GET /__db/manifest.json` at runtime when a UI runs beside `async-db serve`, or configure `viewerManifestOutFile` when app code needs a committed JSON artifact with the same viewer metadata. Browser requests can open `GET /__db/manifest.html`; AI clients can use `GET /__db/manifest.md`; `GET /__db/manifest` lets the `Accept` header choose among registered response formats.

Use `schemaOutFile` when an app only needs the smaller model metadata file without server route links, diagnostics, or viewer capabilities.

```js
import { defineConfig, mergeManifest } from '@async/db/config';

export default defineConfig({
  schemaOutFile: './src/generated/db.schema.json',
  viewerManifestOutFile: './src/generated/db.viewer.json',

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
npm run db -- types --out ./src/generated/db.types.ts
npm run db -- schema
npm run db -- schema users
npm run db -- schema infer users
npm run db -- schema validate
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

## REST, GraphQL, And Viewer

The local server exposes REST routes for collections and singleton documents, plus a focused GraphQL endpoint at `/graphql` for apps that prefer GraphQL. REST remains the default path because it pairs directly with the viewer and local fixture workflow.
Set `rest.enabled: false` when an app wants schema, manifest, viewer, import, events, and GraphQL routes without generated REST resource routes or REST batching.
Set `graphql.enabled: false` when an app wants REST and dev-tool routes without a GraphQL endpoint.

```txt
GET     /db/users.json
GET     /db/users/:id.json
POST    /db/users
PATCH   /db/users/:id
DELETE  /db/users/:id

GET     /settings
PUT     /settings
PATCH   /settings
```

Use `select`, `offset`, and `limit` when a prototype only needs part of a collection:

```bash
curl 'http://127.0.0.1:7331/db/users.json?select=id,name&offset=0&limit=20'
curl 'http://127.0.0.1:7331/db/users.json?id=u_1&select=id,name'
```

The `?id=` shortcut is only for explicit JSON routes. Extensionless REST routes
use normal record URLs such as `/db/users/u_1` or `/users/u_1`.

The viewer at `/__db` lets you inspect resources, import CSV files into the configured fixture folder, view generated schema metadata, read GraphQL SDL/operation references, and try REST requests without writing client code first.

The built-in viewer and custom viewer UIs use the same JSON manifest at `/__db/manifest.json`. `/__db/manifest.html` opens a formatted JSON viewer, `/__db/manifest.md` returns an AI-friendly Markdown wrapper, and `/__db/manifest` chooses from registered media types in `Accept`. Apps can use `api.formats` from the manifest to discover supported extensions and build their own viewer UI against REST or GraphQL records.

See [docs/server-and-viewer.md](./docs/server-and-viewer.md).

## Generated Files

| Path | Commit? | Notes |
| --- | --- | --- |
| `.db/` | Normally no | Runtime stores, source metadata, generated schema, and generated types. |
| `.db/state/*.json` | Normally no | Writable local JSON store state. |
| `.db/types/index.ts` | Normally no | Default generated TypeScript output. |
| `types.commitOutFile` output | Yes, when configured | Use for stable imports before sync runs. |
| `schemaOutFile` output | Yes, when configured | Use for model-driven admin/CMS metadata. |
| `viewerManifestOutFile` output | Yes, when configured | Use for custom data viewers that need metadata plus route links. |
| `examples/*/src/generated/db.types.ts` | Yes, in selected examples | Intentionally committed example type output. |
| `examples/*/src/generated/db.schema.json` | Yes, in selected examples | Intentionally committed example manifest. |

Smoke commands may create `.db/` under examples. Remove generated runtime state before finalizing unless a task explicitly asks to commit it.

See [docs/generated-files.md](./docs/generated-files.md).

## Which Example Should I Start With?

The examples are a learning path. Run any example with `node ./src/cli.js sync --cwd ./examples/<name>` and `node ./src/cli.js serve --cwd ./examples/<name>`, or run `npm run examples` to start every viewer from one index.

| If you want to learn... | Start with | What it shows |
| --- | --- | --- |
| The shortest schema-backed workflow | [`examples/basic`](./examples/basic) | Sync, viewer, REST create, committed generated types |
| Plain data before schemas exist | [`examples/data-first`](./examples/data-first) | Inferred collections, documents, routes, and types |
| Contract-first resources | [`examples/schema-first`](./examples/schema-first) | Schema-only resources, empty seed records, committed types |
| Calling @async/db from app or test code | [`examples/rest-client`](./examples/rest-client) | `createDbClient`, direct REST calls, REST batching |
| Related local records | [`examples/relations`](./examples/relations) | Relation metadata, `expand`, and nested `select` |
| CSV as the source of truth | [`examples/csv`](./examples/csv) | CSV inference, source hashes, mirror refreshes |
| Admin/CMS-style field metadata | [`examples/schema-manifest`](./examples/schema-manifest) | `schemaOutFile` and manifest customization |
| Schema JSON to simple CMS UI templates | [`examples/schema-ui`](./examples/schema-ui) | `serve.mjs` SSR view/editor HTML from manifest + mirror (`node ./examples/schema-ui/serve.mjs`); `/templates` route keeps static placeholders |
| Diagnostics for schema/data drift | [`examples/diagnostics`](./examples/diagnostics) | Warnings surfaced without breaking unrelated resources |
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
| Serve local data and use REST/GraphQL/viewer | [docs/server-and-viewer.md](./docs/server-and-viewer.md) |
| Use the package API, CLI, or exports | [docs/package-api.md](./docs/package-api.md) |
| Integrate with Vite, Hono, or SQLite | [docs/integrations.md](./docs/integrations.md) |
| Validate CI and package contents | [docs/ci-and-release.md](./docs/ci-and-release.md) |
| Understand implementation boundaries | [docs/architecture.md](./docs/architecture.md) |

For the full product behavior and acceptance model, see [SPEC.md](./SPEC.md).
