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

Opening `http://127.0.0.1:7331/` in a browser shows a small index with links to the data viewer, schema, GraphQL endpoint, and resource routes. API-style requests to `/` keep returning JSON discovery data by default.

The viewer includes:

- resource and data browsing
- drag-and-drop CSV import into the configured fixture folder
- REST specs with copyable examples
- a REST request runner
- GraphQL SDL and operation references
- schema and field inspection
- source diagnostics when one fixture file is broken

## REST Routes

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
GET /users/u_1
GET /users/u_1.json
```

Configure `rest.formats` to add formats such as `.md` or `.html`. Format renderers receive data after normal REST shaping, so `select`, `expand`, `offset`, and `limit` apply before rendering.

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
    },
  },
});
```

jsondb does not execute `.jsx` routes directly; JSX is a source/runtime choice for your renderer, while `.html` is the response format.

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

See [Configuration](./configuration.md) for fork setup and [Package API](./package-api.md) for client usage.
