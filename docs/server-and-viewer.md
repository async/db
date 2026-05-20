# Server And Viewer

`jsondb serve` starts a local development server. It syncs on startup, watches fixture sources, serves REST and GraphQL endpoints, and exposes the built-in data viewer.

## Local Trust Boundary

The server binds to `127.0.0.1` by default. It is intended for local development and tests, not public hosting.

Important write surfaces:

- REST writes update runtime state.
- GraphQL mutations update runtime state.
- Viewer CSV import writes CSV files into the configured `dbDir`.
- Resources bound to the `sourceFile` store may write supported changes back to source fixtures.

Config and schema JavaScript are trusted project code. Do not treat `.schema.mjs` or config hooks as untrusted data.

## Viewer

Open the built-in viewer after starting the server:

```txt
http://127.0.0.1:7331/__jsondb
```

The default viewer and dev-tool route base is `/__jsondb`. Change it with
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
GET /__jsondb/manifest
GET /__jsondb/manifest.json
GET /__jsondb/manifest.html
GET /__jsondb/manifest.md
```

`/manifest.json` returns JSON. `/manifest.html` returns the built-in formatted JSON viewer with dark mode by default, dark/light/system theme controls, copy, and pretty/raw formatting controls. `/manifest.md` returns Markdown with the manifest JSON in a fenced code block for AI clients. `/manifest` chooses from registered response formats using the request `Accept` header. If `server.apiBase` changes, the routes move with it, for example `GET /_jsondb/manifest`.

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
import { defineConfig } from 'jsondb/config';
import { stringify as stringifyYaml } from 'yaml';

export default defineConfig({
  server: {
    viewerLinks: [
      { label: 'App Data Viewer', href: 'http://127.0.0.1:5173/jsondb' },
    ],
  },
});
```

You can also write the same shape to a committed artifact:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  viewerManifestOutFile: './src/generated/jsondb.viewer.json',
});
```

```bash
jsondb viewer manifest --out ./src/generated/jsondb.viewer.json
```

## REST Routes

REST routes are enabled by default. Set `rest.enabled: false` to turn off
generated resource routes and REST batching while keeping dev-tool routes such
as the viewer, schema, manifest, import, events, and GraphQL available.

Collections:

```txt
GET     /users
GET     /users/:id
POST    /users
PATCH   /users/:id
DELETE  /users/:id
```

Singleton documents:

```txt
GET     /settings
PUT     /settings
PATCH   /settings
```

REST examples:

```bash
curl http://127.0.0.1:7331/users
curl 'http://127.0.0.1:7331/users?select=id,name&offset=0&limit=20'
curl http://127.0.0.1:7331/users/u_1
```

```bash
curl -X POST http://127.0.0.1:7331/users \
  -H 'content-type: application/json' \
  -d '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
```

```bash
curl -X PATCH http://127.0.0.1:7331/users/u_2 \
  -H 'content-type: application/json' \
  -d '{"name":"Rear Admiral Grace Hopper"}'
```

```bash
curl -X DELETE http://127.0.0.1:7331/users/u_2
```

## REST Formats

Resource `GET` routes return JSON by default. The explicit `.json` extension uses the same shaped data:

```txt
GET /users
GET /users.json
GET /users.html
GET /users.md
GET /users/u_1
GET /users/u_1.json
GET /users/u_1.html
GET /users/u_1.md
```

`.json`, `.html`, and `.md` are built in. Config entries with the same extension override the built-in resource renderer, and object entries can also override manifest rendering. Extensionless resource and manifest routes negotiate registered media types from `Accept`; unsupported `Accept` values fall back to the configured default format. Format renderers receive data after normal REST shaping, so `select`, `expand`, `offset`, and `limit` apply before rendering.

```js
import { defineConfig } from 'jsondb/config';

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

Function shorthand is resource-only for compatibility. Use object syntax when a format needs media-type negotiation or manifest support, such as `GET /__jsondb/manifest.yaml`. jsondb does not execute `.jsx` routes directly; JSX is a source/runtime choice for your renderer, while `.html` is the response format.

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
curl 'http://127.0.0.1:7331/posts/p_1?expand=author&select=id,title,author.name'
```

`select` supports top-level fields and one nested expanded relation field. Relation expansion is depth 1 in this MVP. Reverse to-many expansion is intentionally deferred.

## REST Batching

REST batching is supported through:

```txt
POST /__jsondb/batch
```

If `server.apiBase` is changed, the batch endpoint follows that base, for
example `POST /_jsondb/batch`.

```json
[
  {
    "method": "GET",
    "path": "/users"
  },
  {
    "method": "PATCH",
    "path": "/settings",
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
    "hint": "Use absolute local paths such as \"/users\", \"/settings\", or \"/__jsondb/schema\".",
    "details": {
      "path": "users"
    }
  }
}
```

## GraphQL Boundary

GraphQL is available at `/graphql` for apps that prefer it. It supports aliases, variables, `operationName`, `__typename`, named and inline fragments, `@include`/`@skip`, HTTP batching, and minimal `__schema`/`__type` introspection for local tooling.

Set `graphql.enabled: false` when an app wants REST, schema, manifest, viewer, import, and events without a GraphQL endpoint. Root discovery reports the GraphQL link as unavailable, and direct GraphQL requests return a structured `GRAPHQL_DISABLED` error.

GraphQL HTTP batches execute sequentially and are intentionally non-transactional. If an earlier mutation succeeds and a later batch item fails, the earlier mutation stays committed.

REST remains the documented happy path because REST plus the viewer is the intended default workflow.

Unsupported in v1:

- subscriptions
- full GraphQL spec introspection
- general-purpose GraphQL validation beyond jsondb's local subset
- relation traversal from schema relation metadata; GraphQL projects stored fields in v1

## Watch Behavior

`serve` watches fixture sources, ignores `.jsondb/`, reloads valid resources when files change, and surfaces file-specific diagnostics in the viewer without breaking unrelated resources.

If an app commits generated jsondb files under frontend source folders, Vite may still reload when those files genuinely change. Only ignore generated files that the browser does not need to hot reload.

## Advanced: Fork Routes

Fork-scoped routes are derived automatically:

```txt
GET  /__jsondb/forks/legacy-demo/rest/users
POST /__jsondb/forks/legacy-demo/batch
POST /__jsondb/forks/legacy-demo/graphql
GET  /__jsondb/forks/legacy-demo/schema
```

These routes also follow `server.apiBase`.

See [Configuration](./configuration.md) for fork setup and [Package API](./package-api.md) for client usage.
