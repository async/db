# Configuration

Most projects can skip `db.config.js` at first. Add config when defaults stop matching the project.

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

See [db.config.example.js](../db.config.example.js) for a commented config with common values.

## Config Map

| Need | Default | Configure |
| --- | --- | --- |
| Fixture folder | `./db` | `dbDir` |
| Custom source formats | Built-in readers | `sources.readers` |
| Nested resource names | Fixture basename | `resources.naming` or `resources.customizeResource` |
| Runtime store behavior | JSON files under `.db/state` | `stores.default` or `resources.<name>.store` |
| Index intent metadata | Off | `resources.<name>.indexes` |
| Generated output paths | `.db`, `.db/types/index.d.ts` | `outputs` |
| Importable generated types | Off | `outputs.committedTypes` |
| Importable schema manifest | Off | `outputs.schemaManifest` |
| Importable viewer manifest | Off | `outputs.viewerManifest` |
| Registered query operation refs | Off | `operations` |
| Contract-scoped operation refs | Off | `outputs.contractRefs` and `contracts` |
| REST response formats | `.json`, `.html`, `.md` | `rest.formats` |
| App-facing data route base | `/db` | `server.dataPath` |
| Route exposure policy | Open | `server.expose` |
| Unknown fields | Warn | `schema.unknownFields` |
| Standard Schema-first output | Off | `schema.standardSchema` |
| Schema defaults | Create and safe hydration | `defaults` |
| Schema-only mock records | Off | `seed.generateFromSchema` |
| Local latency | `30-100ms` | `mock.delay` |
| Random local failures | Off | `mock.errors` |
| GraphQL endpoint | `/graphql`, disabled until enabled | `graphql.enabled: true` |
| Falcor endpoint | `/model.json`, disabled until enabled | `falcor.enabled: true` |
| Host, port, dev-tool route base, body limit | `127.0.0.1:7331`, `/__db`, 1 MB bodies | `server` |

## Fixture Folder

Use `dbDir` when fixtures live somewhere other than `./db`:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './fixtures',
});
```

Existing `sourceDir` configs still work; `dbDir` is the shorter fixture-folder name. If both are provided, `sourceDir` wins for backwards compatibility.

## Source And Store Binding

Source fixtures and runtime persistence are separate concerns. By default, source fixtures stay unchanged and app writes go to the generated JSON store under `.db/state`.

Use `stores.default` when every resource should use the same runtime store:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  stores: {
    default: 'sourceFile',
  },
});
```

With that config, writes to plain JSON resources update `db/<resource>.json` directly. This is useful for small local web apps where the project folder should contain the saved app state. JSONC and CSV files remain source inputs; they cannot use `sourceFile` as writable state.

Use `resources.<name>.store` to override the default for one resource:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  stores: {
    default: 'sourceFile',
  },
  resources: {
    importedRows: {
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

## Schema JavaScript Modules

`.schema.js` files are loaded as ESM. If the project root is not already `"type": "module"`, @async/db creates `db/package.json` with `"type": "module"` before loading schema files inside the fixture folder. Aggregate unbundle uses the same rule: it writes generated `.schema.js` files under `db/` when that folder can be loaded as ESM. For custom output folders, add an ESM package boundary or generate JSONC drafts instead.

Disable that marker when you manage fixture-folder package metadata yourself:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  schema: {
    autoModulePackageJson: false,
  },
});
```

## Standard Schema Output

@async/db detects Standard Schema validators by shape without installing a
validator dependency. Set `schema.standardSchema: true` when generated
executable schema files should prefer the validator-first authoring form for
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
viewer, schema, batch, import, live events, and runtime log. REST
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

Explicit integration options such as `createDbRuntime({ handler: { trace } })`,
`createDbRequestHandler(db, { trace })`, `dbPlugin({ trace })`,
`createDbHonoApp({ trace })`, and
`registerDbRoutes(app, db, { trace })` win over `db.config.js`
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

`registered-only` does not make @async/db decide what production means for an
app. If a project wants startup and `async-db doctor` to fail when registered
operations are missing or unresolved, set `operations.strict: true`:

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

With `operations.strict: true`, the built-in server and doctor require
registered operations to be enabled and resolvable through
`operations.registry`, `operations.resolveRef`, `outputs.operationRegistry` /
`operations.outFile`, or operation files under `operations.sourceDir`. Missing,
invalid, or empty operation sources fail early with
`OPERATIONS_STRICT_MODE_WITHOUT_OPERATIONS`. For public operation-only APIs,
prefer `operations.acceptRefs: 'ref'`; doctor reports this as non-blocking
guidance only when operation strict mode is enabled.

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
If `outputs.operationRegistry` is missing, invalid, or points at the client-safe
`db.operation-refs.json` file instead of the server `db.operations.json`
registry, registered operation execution returns
`OPERATION_REGISTRY_LOAD_FAILED`; rebuild the registry or fix the configured
path before treating operation misses as missing refs.

## Production Doctor Checks

`async-db doctor --production` adds production-readiness findings for
JSON-backed resources. It keeps ordinary local prototype checks quiet by
default, then warns when production JSON resources do not have explicit schema
files and emits review guidance for keeping JSON-backed production resources
small, low-write, single-writer, and backed up.

Use `async-db doctor --production --usage ./src` to add static app-usage
findings for endpoint exposure choices. The usage scanner reads source text and
emits a `db.usageManifest`; it does not execute app files.

Use strict production checks in CI when those warnings should fail:

```bash
async-db check --strict --production
```

For CI review, `async-db operations contract` prints a deterministic
client-exposed contract with `generatedAt` removed. Commit the approved refs or
contract file, then run:

```bash
async-db operations contract --check
```

`--check` compares against `outputs.operationRefs` by default, or against
`--out <file>` when provided, and fails when the exposed operation names or refs
change.

## Runtime Forks

Runtime forks are package API state, not `db.config.js` fixture folders. Use `db.forks.create()`, `db.forks.open()`, `db.forks.ensure()`, branches, snapshots, migrations, and routing when an app needs tenants, previews, debug copies, or upgrade flows.

```js
const tenant = await db.forks.ensure('tenant_acme', {
  from: 'main',
  metadata: { purpose: 'tenant' },
});

const draft = await tenant.branches.ensure('draft', {
  from: 'main',
  metadata: { purpose: 'draft' },
});
```

The old fixture-folder `forks` and `templates` config surfaces were removed so `fork` has one meaning: an isolated logical database instance.
