# Configuration

Most projects can skip `db.config.mjs` at first. Add config when defaults stop matching the project.

Use `defineConfig` for editor autocomplete and inline type checks:

```js
// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  stores: {
    default: 'json',
  },
  mock: {
    delay: [30, 100],
  },
});
```

See [db.config.example.mjs](../db.config.example.mjs) for a commented config with common values.

## Config Map

| Need | Default | Configure |
| --- | --- | --- |
| Fixture folder | `./db` | `dbDir` |
| Custom source formats | Built-in readers | `sources.readers` |
| Nested resource names | Fixture basename | `resources.naming` or `resources.customizeResource` |
| Runtime store behavior | JSON files under `.db/state` | `stores.default` or `resources.<name>.store` |
| Index intent metadata | Off | `resources.<name>.indexes` |
| Generated output paths | `.db`, `.db/types/index.ts` | `outputs` |
| Importable generated types | Off | `outputs.committedTypes` |
| Importable schema manifest | Off | `outputs.schemaManifest` |
| Importable viewer manifest | Off | `outputs.viewerManifest` |
| Registered query operation refs | Off | `operations` |
| REST response formats | `.json`, `.html`, `.md` | `rest.formats` |
| App-facing data route base | `/db` | `server.dataPath` |
| Route exposure policy | Open | `server.expose` |
| Unknown fields | Warn | `schema.unknownFields` |
| Standard Schema-first output | Off | `schema.standardSchema` |
| Schema defaults | Create and safe hydration | `defaults` |
| Schema-only mock records | Off | `seed.generateFromSchema` |
| Local latency | `30-100ms` | `mock.delay` |
| Random local failures | Off | `mock.errors` |
| GraphQL endpoint | `/graphql`, enabled | `graphql` |
| Legacy database shapes | Off | `forks` |
| Host, port, dev-tool route base, body limit | `127.0.0.1:7331`, `/__db`, 1 MB bodies | `server` |

## Full Example

```js
// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',

  outputs: {
    stateDir: './.db',
    types: './.db/types/index.ts',
    committedTypes: './src/generated/db.types.ts',
    schemaManifest: './src/generated/db.schema.json',
    viewerManifest: './src/generated/db.viewer.json',
    operationRegistry: './src/generated/db.operations.json',
    operationRefs: './src/generated/db.operation-refs.json',
  },

  sources: {
    writePolicy: 'preserve',
    readers: [],
  },

  stores: {
    default: 'json',
  },

  types: {
    enabled: true,
    useReadonly: false,
    emitComments: true,
  },

  schema: {
    standardSchema: false,
    unknownFields: 'warn',
  },

  defaults: {
    applyOnCreate: true,
    applyOnSafeMigration: true,
  },

  seed: {
    generateFromSchema: false,
    generatedCount: 5,
  },

  server: {
    apiBase: '/__db',
    dataPath: '/db',
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
    expose: {
      rest: 'open',
      graphql: 'open',
      viewer: 'dev',
      schema: 'dev',
      manifest: 'dev',
    },
    viewerLinks: [
      { label: 'App Data Viewer', href: 'http://127.0.0.1:5173/db' },
    ],
  },

  operations: {
    enabled: false,
    sourceDir: './db/operations',
    acceptRefs: 'both',
  },

  rest: {
    enabled: true,
    formats: {
      default: 'json',
      md({ resourceName, data }) {
        return {
          body: `# ${resourceName}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`,
          contentType: 'text/markdown; charset=utf-8',
        };
      },
      // yaml: {
      //   mediaTypes: ['application/yaml', 'text/yaml'],
      //   contentType: 'application/yaml; charset=utf-8',
      //   render({ data }) {
      //     return stringifyYaml(data);
      //   },
      // },
    },
  },

  graphql: {
    enabled: true,
    path: '/graphql',
  },

  mock: {
    delay: [30, 100],
    errors: null,
  },

  forks: ['legacy-demo'],
});
```

## Fixture Folder

Use `dbDir` when fixtures live somewhere other than `./db`:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',
});
```

Existing `sourceDir` configs still work; `dbDir` is the shorter fixture-folder name. If both are provided, `sourceDir` wins for backwards compatibility.

## Source And Store Binding

Source fixtures and runtime persistence are separate concerns. By default, source fixtures stay unchanged and app writes go to the generated JSON store under `.db/state`.

Use `resources.<name>.store` to bind a resource to a different store:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  stores: {
    default: 'json',
  },
  resources: {
    users: { store: 'sourceFile' },
    activityEvents: {
      store: 'json',
      indexes: [
        { fields: ['observedAt'] },
        { fields: ['domain', 'observedAt'] },
      ],
    },
  },
});
```

The `sourceFile` store is intentionally narrow. It is only for resources where supported writebacks should update plain `.json` source fixtures. JSONC and CSV sources remain source inputs and still hydrate runtime state.

`indexes` is metadata for store selection, generated tooling, and `doctor` scale warnings. The default JSON store does not build physical indexes.

Optional database stores keep the same fixture/schema workflow while moving
runtime persistence out of `.db/state`. They store whole resources as JSON
values in v1, so package API, REST, GraphQL, defaults, and source-hash refresh
behavior stay the same:

```js
import { defineConfig } from '@async/db/config';
import { postgresStore } from '@async/db/postgres';
import { redisStore } from '@async/db/redis';

export default defineConfig({
  resources: {
    users: { store: 'postgres' },
    sessions: { store: 'redis' },
  },
  stores: {
    postgres: postgresStore({ client: pgPool }),
    redis: redisStore({ client: redisClient, prefix: 'my-app:' }),
  },
});
```

The package does not install database clients for you. Pass a `pg` Pool/Client
or compatible object to `postgresStore({ client })`, and pass a Redis-like,
edge KV, Valkey, Dragonfly, or compatible object with `get(key)` and
`set(key, value)` to `kvStore()` or `redisStore()`.

## Schema Strictness

Unknown fields in schema-backed data warn by default. Use strict checks when fixture drift should fail:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  schema: {
    unknownFields: 'error',
  },
});
```

Keep the default `warn` while fixture shape is still changing.

## Standard Schema Output

@async/db detects Standard Schema validators by shape without installing a
validator dependency. Set `schema.standardSchema: true` when generated
`.schema.mjs` files should prefer the validator-first authoring form for
resources that have a Standard Schema validator:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  schema: {
    standardSchema: true,
  },
});
```

With that option, aggregate bundle/unbundle output can emit
`collection(UserSchema, { fields })` or `document(SettingsSchema, { fields })`
for Standard Schema-backed resources. Resources without a validator keep the
normal Async DB-first shape.

## Schema Defaults

Schema defaults apply when creating collection records through the package API, REST, GraphQL, SQLite adapter, and generated Hono SQLite starter. Updates, patches, and document puts preserve omitted fields instead of backfilling defaults; include a field in the write body when you want to change it.

Safe runtime hydration also applies defaults to additive store migrations by default. Disable that separately when existing runtime records should remain untouched:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  defaults: {
    applyOnCreate: true,
    applyOnSafeMigration: false,
  },
});
```

## Generated Schema Seed Data

Generate mock runtime records for schema-only resources with empty seed data:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  seed: {
    generateFromSchema: true,
    generatedCount: 5,
  },
});
```

Data files in `db/*.json`, `db/*.jsonc`, and `db/*.csv` remain the source of truth when present.

## Mock Delay And Errors

@async/db delays local responses by `30-100ms` by default. Use `0` to disable delay, a number for fixed delay, or a tuple for a range.

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  mock: {
    delay: [50, 300],
    errors: {
      rate: 0.05,
      status: 503,
      message: 'Random local mock failure',
    },
  },
});
```

Random errors stay off by default. Turn them on when testing retries and error UI.

## Server Options

Use `server` for a different host, port, dev-tool route base, or JSON body limit:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  server: {
    apiBase: '/__db',
    dataPath: '/db',
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
  },
});
```

`server.apiBase` scopes the standalone viewer and internal development routes:
viewer, schema, batch, import, live events, runtime log, and fork routes. REST
resources such as `/users` and the standalone GraphQL path stay unchanged unless
you configure those surfaces separately.

`server.dataPath` scopes the app-facing REST resource alias. It defaults to
`/db`, so `db/users.json` is available at `GET /db/users.json`. Set it to
`false` to disable the alias and use scoped REST under `/__db/rest` plus
standalone root REST routes.

### Request Tracing

Request tracing is opt-in and safe for local debugging. It records handled DB
HTTP requests, phase timings, route/resource/operation metadata, slow status,
and hook short-circuit metadata when available. It records query keys only, not
query values, request bodies, response bodies, cookie headers, or authorization
headers.

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  server: {
    trace: {
      enabled: true,
      slowMs: 100,
      console: true,
      events: true,
      header: 'x-async-db-request-id',
    },
  },
});
```

Use `server.trace: true` to enable tracing with defaults:
`slowMs: 0`, `console: true`, `events: true`, and
`header: 'x-async-db-request-id'`. Set `server.trace: false` or omit it to keep
tracing disabled.

Trace events are emitted through the runtime log stream, so `GET /__db/log`
shows request traces alongside normal resource-change events. Console output is
compact:

```txt
[async-db] GET /db/users 200 18ms route=rest resource=users op=list requestId=...
[async-db:slow] GET /__db/rest/users/u_1 401 122ms route=hono-rest resource=users op=get hook=beforeRequest shortCircuit=true requestId=...
```

Explicit integration options such as `createDbRequestHandler(db, { trace })`,
`dbPlugin({ trace })`, `createDbHonoApp({ trace })`, and
`registerDbRoutes(app, db, { trace })` win over `db.config.mjs`
`server.trace`.

Use `server.expose` when a project wants production-like route hardening.
`operations.enabled: true` only enables registered operation execution; it does
not automatically lock down raw REST routes. To make registered operations the
only data API path, opt into operation-only exposure with
`server.expose.rest: 'registered-only'`:

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

Exposure values are `open`, `registered-only`, `dev`, `disabled`, and `false`.
`dev` routes are available unless `NODE_ENV=production`. `registered-only` is
not a general hardening switch. For REST it specifically means raw REST resource
and batch routes are blocked, while `POST /__db/operations/:ref` can still
execute registered operation templates.

When REST exposure is `registered-only`, `async-db doctor` and the built-in
server require registered operations to be enabled and resolvable through
`operations.registry`, `operations.resolveRef`, `outputs.operationRegistry` /
`operations.outFile`, or operation files under `operations.sourceDir`. Missing,
invalid, or empty operation sources fail early with
`OPERATIONS_STRICT_MODE_WITHOUT_OPERATIONS`. For public operation-only APIs,
prefer `operations.acceptRefs: 'ref'`; doctor reports this as non-blocking
guidance.

## Registered Queries

Registered queries are optional allowlisted REST or GraphQL request templates.
The config and CLI still use the `operations` name. Operation sources live under
`operations.sourceDir`, which defaults to `./db/operations`. When that folder
is inside the fixture folder, @async/db reserves it for operation templates and
does not load it as fixture data. Move it elsewhere by changing
`operations.sourceDir`.

```txt
db/operations/get-user.jsonc
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

GraphQL templates use the same registry:

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

```bash
async-db operations build
```

`outputs.operationRegistry` receives the full server registry with templates.
`outputs.operationRefs` receives client-safe refs with names and callable refs
only. The client-exposed surface is just `operations.<name>.name` and
`operations.<name>.ref`; paths, query templates, variables, request bodies, and
server registry contents stay out of that client file. Generated refs default
to `hashOperation(template)` unless the operation source provides an explicit
`ref`. `operations.acceptRefs` controls which
identifiers the server accepts by default: `'ref'`, `'name'`, or `'both'`. Use
`operations.validateRef` or `operations.resolveRef` only when an app-owned
runtime needs custom server-side policy or a custom registry lookup.
Manual inline registries can use operation objects or string REST templates,
for example `{ GetUser: '/users/{id}.json?select=id,name' }`.
Operation names and refs must be unique; the build fails
instead of generating client refs that could point at the wrong operation.
If `outputs.operationRegistry` is missing or invalid at runtime, registered operation
execution returns `OPERATION_REGISTRY_LOAD_FAILED`; rebuild the registry or fix
the configured path before treating operation misses as missing refs.

For CI review, `async-db operations contract` prints a deterministic
client-exposed contract with `generatedAt` removed. Commit the approved refs or
contract file, then run:

```bash
async-db operations contract --check
```

`--check` compares against `outputs.operationRefs` by default, or against
`--out <file>` when provided, and fails when the exposed operation names or refs
change.

## Database Forks

Use forks when part of an app needs an older fixture shape while other pages move to a new shape.

```txt
db/                         current database shape
db.forks/legacy-demo/       old demo/page shape
.db/state/              generated state for db/
.db/forks/legacy-demo/  generated state for the fork
```

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  forks: ['legacy-demo'],
});
```

For a custom folder:

```js
export default defineConfig({
  forks: {
    'legacy-demo': {
      dbDir: './fixtures/legacy-demo',
    },
  },
});
```

Fork names are folder-style slugs: they must start with an alphanumeric character and may contain letters, numbers, underscores, and hyphens.

See [Server And Viewer](./server-and-viewer.md) for fork routes and [Package API](./package-api.md) for client usage.
