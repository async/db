# Prototype To Production REST Guide

@async/db starts with fixture-like local REST routes so a prototype can move
quickly. When the contract settles, keep the same resource model but move app
traffic behind an owned API namespace, registered operations, or a generated
server.

## Prototype Defaults

Local development is intentionally open by default:

```txt
GET     /db/users.json
GET     /db/users/:id.json
POST    /db/users
PATCH   /db/users/:id
DELETE  /db/users/:id

GET     /__db
GET     /__db/manifest.json
GET     /__db/schema
POST    /__db/batch
POST    /__db/operations/:ref
```

Use `/db/*` while the data shape is still changing. It mirrors the `db/`
fixture folder, works well with `.json` reads, and keeps the browser viewer
and import tools under `/__db`.

This default is local development infrastructure. Do not expose `async-db
serve` directly to customers as a public database API.

The JSON store can still be production-appropriate for small low-write
resources such as settings, feature flags, content, templates, policy rules,
and seed data. Treat it as a file-backed store behind your app API, not as a
public hosted database. Use registered operations, app-owned auth, rate limits,
and monitoring for production-facing traffic.

## Pick A Production Namespace

When a prototype turns into app-owned API surface, use an API namespace that
fits the surrounding app:

| Namespace | Use when |
| --- | --- |
| `/api/db/{resource}` | The app already has other `/api/*` routes and db routes should be clearly grouped. |
| `/api/{resource}` | The API is dedicated to db resources and there is no need for an extra `/db` segment. |
| `/db/{resource}` | Local prototype and test routes. Avoid this as the customer-facing production namespace. |

For a production-like local server, move the fixture-style alias and dev-tool
base together:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  server: {
    dataPath: '/api/db',
    apiBase: '/api/db',
  },
});
```

That makes raw app-facing reads look like:

```txt
GET /api/db/users.json
GET /api/db/users/u_1.json
```

It also moves registered operation execution to:

```txt
POST /api/db/operations/GetUserProfile
POST /api/db/operations/users.profile.get
```

The operation templates themselves still use internal resource paths such as
`/users/{id}.json`. The public route is the `/operations/:ref` endpoint.

## Register Stable Operation Refs

Registered operations let app code call a named contract instead of exploring
raw resource URLs. Any non-path string can be the ref. Use refs that do not
start with `/` and do not look like `GET /...`, because `client.query()` treats
those as literal REST templates.

Server config:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  operations: {
    enabled: true,
    registry: {
      GetUserProfile: {
        method: 'GET',
        path: '/users/{id}.json',
        query: {
          select: 'id,name,email',
        },
      },
    },
  },
  server: {
    apiBase: '/api/db',
    dataPath: '/api/db',
  },
});
```

Client code:

```ts
import { createDbClient } from '@async/db/client';

const db = createDbClient({
  baseUrl: 'https://example.com',
  apiBase: '/api/db',
});

const user = await db.query('GetUserProfile', { id: 'u_1' });
```

The client sends:

```txt
POST /api/db/operations/GetUserProfile
```

The server looks up `GetUserProfile`, substitutes variables, and executes the
registered REST template through normal @async/db shaping and validation.

## Use Opaque Refs When You Need Them

Readable refs are convenient. Opaque refs are useful when you do not want
customer-facing client bundles to reveal raw route names, selected fields, or
query templates.

By default, generated refs are derived from the canonical operation contents:

```txt
/users/{id}.json?select=id,name,email
```

and become a stable ref like:

```txt
op_9d66...
```

Build a server registry and client-safe refs from operation source files:

```bash
async-db operations build \
  --out ./src/generated/db.operations.json \
  --refs-out ./src/generated/db.operation-refs.json
```

Keep `db.operations.json` server-side because it contains full templates. Ship
only names and callable refs from `db.operation-refs.json` to browser code.
The client file does not expose paths, query templates, variables, request
bodies, or the full server registry.

Operation names and refs must be unique; the build fails rather than silently
generating refs that could resolve to a different registry entry.

```ts
import operationRefs from './generated/db.operation-refs.json' assert { type: 'json' };

await db.query(operationRefs.operations.GetUserProfile.ref, { id: 'u_1' });
```

To make the exposed client contract reviewable in CI, print or check the
deterministic contract:

```bash
async-db operations contract
async-db operations contract --check
```

`--check` compares the current operation sources with `outputs.operationRefs`
or an explicit `--out <file>` and fails when exposed names or refs change.

For app-to-app sharing, put resource and operation limits under `contracts`.
Schema tags can help infer a starting point, but `contracts` are the enforced
API:

```js
export default defineConfig({
  contracts: {
    public: {
      resources: {
        users: {
          fields: ['id', 'name', 'avatarUrl'],
          read: true,
          write: false,
        },
      },
      operations: ['GetPublicUser', 'SearchPublicUsers'],
    },
    admin: {
      resources: {
        users: {
          fields: ['id', 'name', 'email', 'role'],
          read: true,
          write: ['create', 'patch'],
        },
      },
      operations: ['GetUserAdmin', 'UpdateUserRole'],
    },
  },
});
```

Generate or check contract-scoped refs:

```bash
async-db contracts infer --from-tags
async-db contracts infer --from-usage ./src
async-db contracts check
async-db contracts refs --out ./src/generated/db.contract-refs.json
```

Runtime callers can pass the contract they are executing under:

```ts
await db.query(operationRefs.contracts.public.operations.GetPublicUser.ref, {
  id: 'u_1'
}, {
  contract: 'public'
});
```

The runtime checks that the ref belongs to the contract, the REST operation
touches allowed resources, selected fields stay inside the field list, and
writes match the contract write policy.

By default, `operations.*.ref` is generated with `hashOperation()`. Set an
explicit `ref` in the operation source when the app wants a readable or
app-owned callable id:

```json
{
  "name": "GetUserProfile",
  "ref": "users.profile.get",
  "path": "/users/{id}.json",
  "query": {
    "select": "id,name"
  }
}
```

For opaque production clients, keep generated refs or generate your own refs
with `hashOperation()`, then accept only refs on the server:

```js
export default defineConfig({
  operations: {
    acceptRefs: 'ref',
  },
});
```

If an app has its own registry build step or policy, keep generated client refs
simple and customize server lookup with `operations.resolveRef` or
`operations.validateRef`. Inline registries can use operation objects or string
REST templates:

```js
registerDbRoutes(app, db, {
  prefix: '/api/db',
  operations: {
    registry: {
      GetUserProfile: '/users/{id}.json?select=id,name',
    },
    acceptRefs: 'name',
  },
});
```

If the generated `outputs.operationRegistry` is missing, invalid, or points at
the client-safe refs file instead of the server registry, operation execution
fails with `OPERATION_REGISTRY_LOAD_FAILED` so you can rebuild the registry or
fix the configured path. A loaded registry that simply lacks a ref still returns
`OPERATION_NOT_FOUND`.

Refs are allowlist identifiers, not secrets. They reduce route exploration and
hide query shape from casual client inspection, but anyone who can call your API
still needs normal auth, authorization, rate limits, and monitoring.

## Operation-Only Exposure

`operations.enabled: true` enables registered operation execution without
closing local REST or viewer routes. Once the app uses registered operation
refs as its public data contract, opt into operation-only exposure to block raw
REST exploration:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  outputs: {
    operationRegistry: './src/generated/db.operations.json',
    operationRefs: './src/generated/db.operation-refs.json',
  },
  operations: {
    enabled: true,
    acceptRefs: 'ref',
  },
  server: {
    apiBase: '/api/db',
    dataPath: '/api/db',
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

`registered-only` is not a general hardening switch. It specifically means only
registered operations may use the REST data API. With that policy, raw routes
such as these are rejected:

```txt
GET /api/db/users.json
POST /api/db/batch
GET /users
```

Registered operations still run:

```txt
POST /api/db/operations/GetUserProfile
POST /api/db/operations/users.profile.get
```

`registered-only` does not make @async/db define production policy for your
app. The built-in server still starts if registered operations are disabled;
raw REST stays blocked and operation requests fail at request time. If you want
startup and `async-db doctor` to fail early when operations are missing or
unresolved, opt into that readiness check:

```js
export default defineConfig({
  operations: {
    enabled: true,
    strict: true,
    acceptRefs: 'ref',
  },
  server: {
    expose: {
      rest: 'registered-only',
    },
  },
});
```

With `operations.strict: true`, provide `outputs.operationRegistry`,
`operations.registry`, `operations.resolveRef`, or operation files under
`operations.sourceDir`.

Use `server.expose.graphql: false` when the production-facing API is REST-only.
If you use registered GraphQL operations, keep `graphql.enabled` on and use
`server.expose.graphql: false` to hide only the direct GraphQL endpoint.

## Turn Off Unused Endpoints

@async/db keeps endpoint choices separate so each app can decide what
production means. Use the smallest surface that matches the app code:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  rest: {
    enabled: false,
  },
  graphql: {
    enabled: false,
  },
  falcor: {
    enabled: false,
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

`rest.enabled: false` removes generated REST resource routes and REST batching.
Use `server.expose.rest: 'registered-only'` instead when registered operations
should keep working but raw REST should close. `graphql.enabled: false`
disables GraphQL execution entirely. If registered GraphQL operations still
need GraphQL execution, keep `graphql.enabled: true` and set
`server.expose.graphql: false` to hide the direct GraphQL endpoint.
`falcor.enabled: false` disables `/model.json`. Keep viewer, schema, and
manifest exposure at `'dev'` for local tools, or set them to `false` when a
production-facing mount should not serve those metadata routes.

Use the static usage scanner to review what the app appears to call:

```bash
async-db usage scan ./src --production
async-db usage scan ./src --production --out ./src/generated/db.usage.json
async-db usage scan ./src --production --check ./src/generated/db.usage.json
async-db doctor --production --usage ./src --json
```

The scanner reads source text only; it does not execute app files. The generated
`db.usageManifest` records package imports, client calls, route literals,
config toggles, and advisory endpoint recommendations. Treat the manifest as a
review aid, not telemetry or proof that dynamic code cannot call an endpoint.

## Move To An Owned API Server

For app-specific auth, permissions, sessions, logging, and rate limiting, mount
db behind the framework that owns your production API.

With Hono route registration:

```ts
import { registerDbRoutes } from '@async/db/hono';

registerDbRoutes(app, db, {
  prefix: '/api/db',
  operations: true,
  lifecycleHooks: {
    beforeRequest({ c }) {
      const session = readSession(c.req.header('authorization'));
      if (!session) return c.json({ error: 'Unauthorized' }, 401);
      c.set('session', session);
    },
    beforeWrite({ c }) {
      if (c.get('session')?.role !== 'admin') {
        return c.json({ error: 'Forbidden' }, 403);
      }
    },
  },
});
```

`operations: true` mounts `POST /api/db/operations/:ref` using
`db.config.operations`. Omit it to use automatic mounting when
`db.config.operations.enabled` is true, set `operations: false` to keep only
raw REST routes on that mount, or pass a local operation registry when this
Hono app owns a custom build step:

Hono registered operation routes run `lifecycleHooks.beforeRequest` with
`method: 'operation'` and the operation `ref`, so shared auth/session checks can
protect both resource routes and registered operations. Resource write hooks do
not run for registered operations; enforce operation-specific permissions in the
app layer or with `operations.validateRef`.

```ts
registerDbRoutes(app, db, {
  prefix: '/api/db',
  operations: {
    registry: generatedOperations.operations,
    acceptRefs: 'ref',
  },
});
```

Use `/api` instead of `/api/db` when the generated or registered API is only
for db resources:

```ts
registerDbRoutes(app, db, {
  prefix: '/api',
});
```

When fixtures and schemas have settled enough for a standalone service, use the
Hono/SQLite starter:

```bash
async-db generate hono --api rest --out ./server
```

The generated server is the right direction when the data API needs its own
repository, deploy process, migrations, and production storage.

## Graduation Checklist

- Keep `/db/*` for prototype and test traffic.
- Move app-facing routes to `/api/db/*` or `/api/*`.
- Register string operation names or refs for stable app contracts.
- Import generated operation refs and call `.ref`; set explicit refs when app-owned callable ids are clearer.
- Use `acceptRefs: 'ref'` for opaque public clients, or `acceptRefs: 'name'` for readable internal APIs.
- Run `async-db usage scan --production` before choosing endpoint exposure.
- Set `server.expose.rest: 'registered-only'` before treating operation refs as the public contract.
- Disable unused GraphQL and Falcor endpoints with `graphql.enabled: false` and `falcor.enabled: false`.
- Add app-owned auth, authorization, rate limits, and observability outside the registered operation registry.
- Generate a Hono/SQLite API when the endpoint needs production storage and deployment boundaries.
- Keep low-write control-plane resources in JSON when that is operationally appropriate, but move high-write, transactional, or multi-writer resources to SQLite, Postgres, or another app-owned store.
