# Server And Viewer

`async-db serve` starts a local development server. It syncs on startup, watches fixture sources, serves REST and GraphQL endpoints, and exposes the built-in data viewer.

## Local Trust Boundary

The server binds to `127.0.0.1` by default. It is intended for local development and tests, not public hosting.

Important write surfaces:

- REST writes update runtime state.
- GraphQL mutations update runtime state.
- Viewer CSV import writes CSV files into the configured `dbDir`.
- Resources bound to the `sourceFile` store may write supported changes back to source fixtures.

Config and schema JavaScript are trusted project code. Do not treat `.schema.mjs` or config hooks as untrusted data.

## Request Tracing

Enable request tracing when a local page appears stuck or slow and you need to
see where a DB request spent time:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  server: {
    trace: true,
  },
});
```

Tracing adds an `x-async-db-request-id` response header, emits
`request-trace` events through `GET /__db/log`, and prints concise console
lines unless disabled. Traces include method, pathname, query keys, route
family, resource, operation, id when known, status, handled state, duration,
slow status, safe error code/message, and phase timings for clear boundaries
such as route matching, mock behavior, REST handling, Hono hooks, collection or
document reads/writes, response shaping, registered operations, batch items, and
fork dispatch.

Trace data intentionally omits request bodies, response bodies, cookie headers,
authorization headers, and query values. Query strings are represented as keys
only, for example `["select", "expand"]`.

## Viewer

Open the built-in viewer after starting the server:

```txt
http://127.0.0.1:7331/__db
```

The default viewer and dev-tool route base is `/__db`. Change it with
`server.apiBase` when an app needs a different reserved path; schema, batch,
import, events, log, and fork routes move with that base.

Opening `http://127.0.0.1:7331/` in a browser shows a small index with links to the data viewer, schema, GraphQL endpoint, and resource routes. API-style requests to `/` keep returning JSON discovery data by default.

The viewer includes:

- resource and data browsing
- drag-and-drop CSV import into the configured fixture folder
- REST specs with copyable examples
- a REST request runner
- GraphQL SDL and operation references
- schema and field inspection
- source diagnostics when one fixture file is broken

## Custom Viewer Manifest

The built-in viewer reads the same JSON manifest that custom viewer UIs can use:

```txt
GET /__db/manifest
GET /__db/manifest.json
GET /__db/manifest.html
GET /__db/manifest.md
```

`/manifest.json` returns JSON. `/manifest.html` returns the built-in formatted JSON viewer with dark mode by default, dark/light/system theme controls, copy, and pretty/raw formatting controls. `/manifest.md` returns Markdown with the manifest JSON in a fenced code block for AI clients. `/manifest` chooses from registered response formats using the request `Accept` header. If `server.apiBase` changes, the routes move with it, for example `GET /_db/manifest`.

The manifest includes:

- API links for the viewer, manifest, manifest JSON/HTML/Markdown routes, schema, events, batch, import, GraphQL, and each REST resource
- built-in and configured custom viewer links
- resource and field metadata, including generated UI hints and relation hints
- viewer capabilities such as writes, batching, CSV import, GraphQL, and live events
- diagnostics suitable for display in a custom UI

The manifest does not include seed records, source paths, source hashes, runtime state paths, or GraphQL SDL. Custom viewers should fetch `manifest.json` for UI metadata and route links, then fetch actual records from REST or GraphQL. `api.formats` lists the registered response formats, media types, and manifest paths for custom viewers and tools.

Add custom viewer links when a project ships its own data UI:

Override the built-in Markdown renderer when a project needs a different shape:

```js
import { defineConfig } from '@async/db/config';
import { stringify as stringifyYaml } from 'yaml';

export default defineConfig({
  server: {
    viewerLinks: [
      { label: 'App Data Viewer', href: 'http://127.0.0.1:5173/db' },
    ],
  },
});
```

You can also write the same shape to a committed artifact:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  outputs: {
    viewerManifest: './src/generated/db.viewer.json',
  },
});
```

```bash
async-db viewer manifest --out ./src/generated/db.viewer.json
```

## REST Routes

REST routes are enabled by default. Set `rest.enabled: false` to turn off
generated resource routes and REST batching while keeping dev-tool routes such
as the viewer, schema, manifest, import, events, and GraphQL available.

The app-facing REST route base defaults to `/db`, matching the fixture folder.
For a fixture at `db/users.json`, fetch the synced runtime resource with:

```js
const users = await fetch('/db/users.json').then((response) => response.json());
```

Scoped REST remains available under the tool route base, such as
`GET /__db/rest/users.json`. Standalone `async-db serve` also keeps root REST
routes such as `GET /users` for local convenience. Set `server.dataPath: false`
to disable only the `/db` alias.

When a prototype route needs to become an app-owned API route, see the
[Prototype To Production REST Guide](./prototype-to-production.md) for
`/api/db/*`, `/api/*`, registered operation refs, and route lockdown.

### Fixture-Like `.json` Routes

Use `.json` routes when you want the URL to resemble the source fixture path:
`db/users.json` becomes `GET /db/users.json`. The server still reads the
synced runtime resource, not the source fixture file directly, so local writes
continue going to the selected runtime store.

Collections can use `.json` for list and record reads:

```txt
GET /db/users.json
GET /db/users/u_1.json
```

Singleton documents can use the same fixture-like read shape:

```txt
GET /db/settings.json
```

Use `?id=` only with the explicit collection `.json` route:

```txt
GET /db/users.json?id=u_1
```

Extensionless REST routes keep normal REST semantics and return a structured
error for `?id=`. Use `GET /db/users/u_1.json` or `GET /db/users/u_1` there.
Query options such as `select`, `expand`, `offset`, and `limit` apply before
the response format renders. Sibling `.html` and `.md` routes use the same
shaped data for browser or Markdown views.

Collections:

```txt
GET     /db/users.json
GET     /db/users/:id.json
POST    /db/users
PATCH   /db/users/:id
DELETE  /db/users/:id
```

Singleton documents:

```txt
GET     /db/settings.json
PUT     /db/settings
PATCH   /db/settings
```

REST examples:

```bash
curl http://127.0.0.1:7331/db/users.json
curl 'http://127.0.0.1:7331/db/users.json?select=id,name&offset=0&limit=20'
curl 'http://127.0.0.1:7331/db/users.json?id=u_1&select=id,name'
curl http://127.0.0.1:7331/db/users/u_1.json
curl http://127.0.0.1:7331/db/settings.json
```

```bash
curl -X POST http://127.0.0.1:7331/db/users \
  -H 'content-type: application/json' \
  -d '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
```

```bash
curl -X PATCH http://127.0.0.1:7331/db/users/u_2 \
  -H 'content-type: application/json' \
  -d '{"name":"Rear Admiral Grace Hopper"}'
```

```bash
curl -X DELETE http://127.0.0.1:7331/db/users/u_2
```

Schema-backed computed fields are resolved only when selected. For example,
`GET /db/users/u_1.json?select=id,fullName` calls the trusted resolver registered
by `field.computed(...)`; default reads continue returning only stored fixture
fields.

## REST Formats

Resource `GET` routes return JSON by default. The explicit `.json` extension uses the same shaped data:

```txt
GET /db/users
GET /db/users.json
GET /db/users.html
GET /db/users.md
GET /db/users/u_1
GET /db/users/u_1.json
GET /db/users/u_1.html
GET /db/users/u_1.md
```

`.json`, `.html`, and `.md` are built in. Config entries with the same extension override the built-in resource renderer, and object entries can also override manifest rendering. Extensionless resource and manifest routes negotiate registered media types from `Accept`; unsupported `Accept` values fall back to the configured default format. Format renderers receive data after normal REST shaping, so `select`, `expand`, `offset`, and `limit` apply before rendering.

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  rest: {
    formats: {
      default: 'json',
      md({ resourceName, data }) {
        return {
          body: `# ${resourceName}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`,
          contentType: 'text/markdown; charset=utf-8',
        };
      },
      yaml: {
        mediaTypes: ['application/yaml', 'text/yaml'],
        contentType: 'application/yaml; charset=utf-8',
        render({ data }) {
          return stringifyYaml(data);
        },
        renderManifest({ data }) {
          return stringifyYaml(data);
        },
      },
    },
  },
});
```

Function shorthand is resource-only for compatibility. Use object syntax when a format needs media-type negotiation or manifest support, such as `GET /__db/manifest.yaml`. @async/db does not execute `.jsx` routes directly; JSX is a source/runtime choice for your renderer, while `.html` is the response format.

## Relationship Expansion

Schema-backed scalar fields can declare relation metadata while fixtures keep plain ids:

```json
{
  "authorId": {
    "type": "string",
    "required": true,
    "relation": {
      "name": "author",
      "to": "users",
      "toField": "id",
      "cardinality": "one"
    }
  }
}
```

Then REST can expand that to-one relation:

```bash
curl 'http://127.0.0.1:7331/db/posts/p_1.json?expand=author&select=id,title,author.name'
```

`select` supports top-level fields and one nested expanded relation field. Relation expansion is depth 1 in this MVP. Reverse to-many expansion is intentionally deferred.

## REST Batching

REST batching is supported through:

```txt
POST /__db/batch
```

If `server.apiBase` is changed, the batch endpoint follows that base, for
example `POST /_db/batch`.

```json
[
  {
    "method": "GET",
    "path": "/db/users.json"
  },
  {
    "method": "PATCH",
    "path": "/db/settings",
    "body": {
      "theme": "dark"
    }
  }
]
```

REST batches execute sequentially and are intentionally non-transactional. If an earlier write succeeds and a later batch item fails, the earlier write stays committed.

Errors are shaped for humans and automation:

```json
{
  "error": {
    "code": "REST_BATCH_INVALID_PATH",
    "message": "REST batch path must start with \"/\": users",
    "hint": "Use absolute local paths such as \"/users\", \"/settings\", or \"/__db/schema\".",
    "details": {
      "path": "users"
    }
  }
}
```

## Registered REST Operations

Registered queries are optional REST or GraphQL request templates with callable
refs and optional names. They let production-style apps allowlist specific
reads and writes while local fixture CRUD can stay open by default. The
underlying config and CLI still use the `operations` name.

```txt
GET /users/{id}.json?select=id,name
```

```json
{
  "name": "GetUser",
  "method": "GET",
  "path": "/users/{id}.json",
  "query": {
    "select": "id,name"
  }
}
```

GraphQL templates use the same registry and ref execution route:

```json
{
  "name": "GetUser",
  "query": "query GetUser($id: ID!) { user(id: $id) { id name } }",
  "operationName": "GetUser",
  "variables": {
    "id": "{id}"
  }
}
```

Build the registry and optional client-safe refs:

```bash
async-db operations build --out ./src/generated/db.operations.json --refs-out ./src/generated/db.operation-refs.json
```

At runtime, registered operation execution is always a POST to the dev-tool base:

```bash
curl -X POST http://127.0.0.1:7331/__db/operations/users.get \
  -H 'content-type: application/json' \
  -d '{"variables":{"id":"u_1"}}'
```

Readable names work as app-facing operation refs. Refs are allowlist identifiers, not
secrets. Generated refs default to `hashOperation(template)`, and apps can set
their own `ref` in operation sources when they want readable or app-owned ids.
Keep the full registry server-side. Client refs contain names and callable refs
but not full request templates, variables, or request bodies. Use
`async-db operations contract --check` in CI when committed refs need approval
before the browser-facing operation contract changes. `operations.acceptRefs`
controls whether the server accepts refs, names, or both. Use `operations.resolveRef` or
`operations.validateRef` for custom server-side registry lookup or policy.

To block raw REST while allowing registered operations:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  outputs: {
    operationRegistry: './src/generated/db.operations.json',
  },
  operations: {
    enabled: true,
    acceptRefs: 'ref',
  },
  server: {
    expose: {
      rest: 'registered-only',
      graphql: false,
      viewer: 'dev',
      schema: 'dev',
      manifest: 'dev',
    },
  },
});
```

`registered-only` blocks raw REST resource and batch routes. Registered REST
operation execution still uses normal REST shaping, including `select`,
formats, schema validation, and computed resolver projection. Registered
GraphQL operations execute through the same GraphQL executor as direct GraphQL
requests, and still require `graphql.enabled !== false`.

## GraphQL Boundary

GraphQL is available at `/graphql` for apps that prefer it. It supports aliases, variables, `operationName`, `__typename`, named and inline fragments, `@include`/`@skip`, HTTP batching, and minimal `__schema`/`__type` introspection for local tooling.

Set `graphql.enabled: false` when an app wants REST, schema, manifest, viewer, import, and events without a GraphQL endpoint. Root discovery reports the GraphQL link as unavailable, and direct GraphQL requests return a structured `GRAPHQL_DISABLED` error.

GraphQL HTTP batches execute sequentially and are intentionally non-transactional. If an earlier mutation succeeds and a later batch item fails, the earlier mutation stays committed.

REST remains the documented happy path because REST plus the viewer is the intended default workflow.

GraphQL selections use the same read projection/fanout path as REST for computed
fields. Registered GraphQL operations are fixed query templates; they are not a
direct database query language and do not expose backend SQL or Redis commands.

Use `server.expose.graphql`, `server.expose.viewer`, `server.expose.schema`, and
`server.expose.manifest` to keep non-REST surfaces `open`, `dev`, or disabled in
production-like servers.

Unsupported in v1:

- subscriptions
- full GraphQL spec introspection
- general-purpose GraphQL validation beyond @async/db's local subset
- relation traversal from schema relation metadata; GraphQL projects stored fields in v1

## Watch Behavior

`serve` watches fixture sources, ignores `.db/`, reloads valid resources when files change, and surfaces file-specific diagnostics in the viewer without breaking unrelated resources.

If an app commits generated files under frontend source folders, Vite may still reload when those files genuinely change. Only ignore generated files that the browser does not need to hot reload.

## Advanced: Fork Routes

Fork-scoped routes are derived automatically:

```txt
GET  /__db/forks/legacy-demo/rest/users
POST /__db/forks/legacy-demo/batch
POST /__db/forks/legacy-demo/graphql
GET  /__db/forks/legacy-demo/schema
```

These routes also follow `server.apiBase`.

See [Configuration](./configuration.md) for fork setup and [Package API](./package-api.md) for client usage.
