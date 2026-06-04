# Package API

This page covers the CLI, runtime API, HTTP client, and package exports.

## CLI

With a package script like `"db": "async-db"`:

```bash
npm run db -- sync
npm run db -- types
npm run db -- types --watch
npm run db -- types --out ./src/generated/db.types.d.ts
npm run db -- schema
npm run db -- schema users
npm run db -- schema infer users
npm run db -- schema infer users --out db/users.schema.jsonc
npm run db -- schema manifest --out ./src/generated/db.schema.json
npm run db -- schema validate
npm run db -- viewer manifest --out ./src/generated/db.viewer.json
npm run db -- operations build
npm run db -- operations build --out ./src/generated/db.operations.json --refs-out ./src/generated/db.operation-refs.json
npm run db -- doctor
npm run db -- doctor --production
npm run db -- doctor --json
npm run db -- check --strict --production
npm run db -- create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
npm run db -- serve
npm run db -- generate hono
npm run db -- generate hono --api rest,graphql --out ./server
```

Inside npm scripts, `db` resolves to the local dependency binary. Equivalent direct commands:

```bash
async-db sync
async-db types
async-db schema validate
async-db viewer manifest --out ./src/generated/db.viewer.json
async-db operations build
async-db doctor
async-db doctor --production
async-db check --strict --production
async-db serve
async-db generate hono
```

With pnpm and a `"db": "async-db"` script, pass arguments directly to the script name:

```bash
pnpm db sync
pnpm db schema validate
pnpm db serve
```

## Runtime API

```ts
import { openDb } from '@async/db';

const db = await openDb({
  outputs: {
    stateDir: './.db',
  },
  stores: {
    default: 'json',
  },
});

const users = db.collection('users');

await users.create({
  id: 'u_2',
  name: 'Grace Hopper',
  email: 'grace@example.com',
  role: 'user',
});

const ada = await users.get('u_1');
const hasGrace = await users.exists('u_2');

await db.close();
```

Call `db.close()` when a long-running process is done with the database so stores with open handles, such as SQLite, can release them.

Use `createDbRuntime()` when custom Node middleware should own the same
development lifecycle as `async-db serve`: open the db, sync or hydrate, watch
fixture sources, publish lifecycle events, expose request middleware, and clean
everything up together.

```ts
import http from 'node:http';
import { createDbRuntime } from '@async/db';

const runtime = await createDbRuntime({
  cwd: process.cwd(),
  watch: true,
});

const server = http.createServer((request, response) => {
  runtime.handleRequest(request, response).then((handled) => {
    if (!handled) {
      response.writeHead(404).end();
    }
  });
});

server.once('close', () => {
  void runtime.close();
});
```

Use `createDbRequestHandler(db, options)` only when app code already owns the
database lifecycle and file watching.

Singleton document usage:

```ts
const settings = db.document('settings');

await settings.set('/theme', 'dark');

const value = await settings.get('/theme');
```

Fork and branch usage:

```ts
const tenant = await db.forks.ensure('tenant_acme', {
  from: 'main',
  metadata: {
    purpose: 'tenant',
    plan: 'free',
  },
});

const snapshot = await tenant.snapshots.create({
  label: 'before-projects-migration',
  resources: ['projects'],
});

await tenant.migrations.start('projects-to-postgres', {
  resources: ['projects'],
  mode: 'read-only',
});
await tenant.resources.migrate('projects', {
  from: 'json',
  to: 'postgres',
});
await tenant.migrations.verify('projects-to-postgres', {
  resources: ['projects'],
  checks: ['count', 'checksum'],
});
await tenant.routing.set({
  projects: 'postgres',
});
await tenant.migrations.finish('projects-to-postgres');

void snapshot;
```

These are low-level database lifecycle APIs. App code decides whether a fork is a tenant, preview, debug copy, demo, or test environment.

Import generated `DbTypes` from `.db/types/index.d.ts` or from a committed output file when typed collection names and records should be available to TypeScript. Apps can also add a TypeScript `paths` alias such as `#db/types` for the committed generated file; see [Generated Types](./generated-files.md#generated-types).

## Schema Contract API

Use `loadDbSchema({ from })` when app code needs the schema contract without
opening runtime stores or reading source records. `from` can point at a project
root, a `db/` folder, the root `db.schema.mjs` / `db.schema.js`, or one resource schema file.

```ts
import { loadDbSchema, openDb } from '@async/db';

const schema = await loadDbSchema({ from: './db.schema.mjs' });

const validateUserInput = schema.validator('users', {
  mode: 'create',
  unknownFields: 'strip',
});

const input = validateUserInput.assert(await request.json());
```

Validators reject computed and read-only fields. They default unknown fields to
`error`; use `strip`, `allow`, or `warn` when an endpoint has a different input
contract. `mode: 'patch'` allows partial records and `mode: 'replace'` keeps
required-field checks strict.

Call computed field resolvers directly when server code wants the same field
logic that REST and GraphQL use:

```ts
const userResolvers = schema.resolver('users', {
  value: input,
  context: {
    locale: 'en-US',
    nameFormatter,
  },
});

const fullName = await userResolvers.fullName();
```

`schema.resolver('users.fullName')` returns one callable resolver. The resolver
`this` value is a delegated context with `this.get(name)` and `this.has(name)`.
User context values win over internal values; `this._internal` exposes the
unoverridden internal view when a resolver needs it. A resolver call can also
pass ad hoc arguments, such as `{ record: input }`, when the schema function is
written to receive them.

Pass a loaded schema to `openDb({ schema })` when one process wants to inspect
or validate the contract first, then open the runtime database from the same
schema locator:

```ts
const schema = await loadDbSchema({ from: './db.schema.mjs' });
const db = await openDb({ schema });
```

`loadDbSchema()` is metadata-only by default and does not call content/data
readers, runtime stores, or computed resolvers. `openDb()` defaults to runtime
loading and reads the matching fixture/content sources.

JavaScript schema files can describe folder content sources with the helper
exported from `@async/db/schema`:

```js
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'frontmatter' }),
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string(),
  },
});
```

Keep runtime store selection in `db.config.mjs`, for example
`resources.docs.store = 'static'`.

## HTTP Client

```ts
import { createDbClient } from '@async/db/client';

const client = createDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  batching: true,
});

const users = await client.rest.get('/db/users.json');

await client.rest.post('/db/users', {
  id: 'u_2',
  name: 'Grace Hopper',
  email: 'grace@example.com',
});

const batch = await client.rest.batch([
  { method: 'GET', path: '/db/users.json' },
  { method: 'GET', path: '/db/settings.json' },
]);
```

When using `createDbClient()` directly against standalone `async-db serve`, use
the app-facing `/db` routes. Scoped clients, such as the Vite virtual client or
a fork client, can keep resource paths like `/users` because the client sets a
`restBasePath` for you.

The client can batch requests made within a short timeout. The default batching window is `10ms`. Identical REST `GET` requests are deduped by default. Writes are not deduped unless you explicitly choose `dedupe: 'all'`.

Enable the browser cache explicitly when app code should reuse normalized REST
and GraphQL reads:

```ts
import { createDbClient, createIndexedDbCacheStorage } from '@async/db/client';

const client = createDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  cache: {
    enabled: true,
    storage: 'memory',
    readPolicy: 'cache-first',
    writePolicy: 'merge-and-invalidate',
    eventPolicy: 'invalidate',
  },
});

await client.rest.get('/db/users.json?select=id,name', { cache: 'cache-first' });
await client.graphql('{ users { id name __typename } }', {}, { cache: 'cache-and-network' });

const stop = client.cache.watch(
  { kind: 'rest', method: 'GET', path: '/db/users.json?select=id,name' },
  (snapshot) => {
    render(snapshot.data);
  },
);

const persistedClient = createDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  cache: {
    enabled: true,
    storage: createIndexedDbCacheStorage({ name: 'async-db' }),
  },
});
```

The cache is off by default. When enabled, the client fetches the viewer
manifest once, normalizes collection records by resource id, normalizes
documents by resource name, and keeps query results by canonical request key.
Cacheable reads use exact in-flight dedupe outside the batching window. Runtime
write events from `/__db/log` invalidate or refetch affected resources according
to `eventPolicy`; fixture/source reload events from `/__db/events` refresh the
manifest and invalidate cached queries. IndexedDB is explicit opt-in because it
persists record data in the browser.

Run registered queries or literal operation templates through the same client.
`query()` is the app-facing alias for `operation()`:

```ts
import operationRefs from './generated/db.operation-refs.json' assert { type: 'json' };

await client.query('GetUser', { id: 'u_1' });

await client.query('/db/users/{id}.json?select=id,name', { id: 'u_1' });

await client.query({
  method: 'GET',
  path: '/db/users/{id}.json',
  query: {
    select: 'id,name',
  },
}, { id: 'u_1' });

await client.query({
  query: 'query GetUser($id: ID!) { user(id: $id) { id name } }',
  operationName: 'GetUser',
  variables: {
    id: '{id}',
  },
}, { id: 'u_1' });

await client.query({ name: 'GetUser', ref: 'users.get' }, { id: 'u_1' });

await client.query(operationRefs.operations.GetUser.ref, { id: 'u_1' });
```

String values passed to `query()` that start with `/`, or with an HTTP method
followed by `/`, are literal REST templates. Other strings are registered query
refs, such as an operation name or explicit ref, and call `POST
/__db/operations/:ref`. Object REST templates execute as normal REST requests.
Object GraphQL templates are inferred when an object has `query` and no REST
`path`, and execute as normal GraphQL requests. The server looks up registered
refs, substitutes variables, and runs REST templates through normal REST shaping
or GraphQL templates through the GraphQL executor.

Generated operation refs include `.name` and `.ref`. `.ref` is the value app
code should call. It defaults to `hashOperation(template)` unless the operation
source provides an explicit `ref`. Server acceptance is controlled separately
with `operations.acceptRefs`.

## Package Exports

| Export | Use |
| --- | --- |
| `@async/db` | Runtime API such as `openDb`. |
| `@async/db/schema` | `.schema.mjs` and `.schema.js` authoring helpers. |
| `@async/db/config` | `defineConfig` and manifest helpers. |
| `@async/db/client` | HTTP client with REST, GraphQL, and batching helpers. |
| `@async/db/json` | First-party JSON file database capabilities and safe JSON state helpers. |
| `@async/db/vite` | Optional Vite dev server plugin. |
| `@async/db/hono` | Optional Hono route registration helpers. |
| `@async/db/sqlite` | Optional SQLite adapter helpers. |
| `@async/db/postgres` | Optional Postgres runtime store helpers using an injected client. |
| `@async/db/kv` | Optional generic KV runtime store helpers using an injected `get`/`set` client. |
| `@async/db/redis` | Optional Redis-named helper over the generic KV store. |

The core package stays dependency-light. Optional integrations use dynamic
imports, generated app dependencies, or injected database clients.

`@async/db/json` is the first-party JSON file database subpath. It exposes the
JSON store capability metadata and safe file-state helpers for tooling,
diagnostics, exports, and migrations. Most app code should still use `openDb()`,
`createDbClient()`, and registered operations so resources can graduate from
JSON to SQLite, Postgres, or custom stores without changing client calls.

The root export also includes `hashOperation()`, `buildOperationManifest()`,
and `createDbOperationHandler()` for tools and framework adapters that want to
build or execute registered operation registries without shelling out to the
CLI.

`createDbOperationHandler(db, options?)` returns a small operation executor:

```ts
const handler = createDbOperationHandler(db, {
  registry: generatedOperations.operations,
  acceptRefs: 'ref',
});

const result = await handler.execute(operationRefs.operations.GetUser.ref, {
  id: 'u_1',
});
```

Use `execute(ref, variables)` for direct calls or `executeRequest(ref, body)`
when adapting an HTTP request body shaped as `{ variables }`. Framework adapters
should pass registry, `acceptRefs`, `resolveRef`, or `validateRef` at handler
creation time instead of relying on per-execution public options.

Inline registries can use full operation objects or string REST templates. The
registry key is used as the fallback name and ref, so custom build steps can
keep a small manual registry:

```js
const handler = createDbOperationHandler(db, {
  registry: {
    GetUser: '/users/{id}.json?select=id,name',
  },
  acceptRefs: 'name',
});
```

## Repo Example Launcher

Run every repo example and open an index of their viewers:

```bash
npm run examples
```

The examples index runs on one loopback port and starts each example runtime lazily when you open its demo or `/__db` viewer.

To get an HTTPS URL for the examples index inside your tailnet, opt in to
Tailscale Serve:

```bash
npm run examples -- --tailscale-serve
```

This runs `tailscale serve --bg <port>` after the local examples host starts.
@async/db does not call `tailscale cert`, manage local certificate files, or
change tailnet settings directly. If MagicDNS or HTTPS certificates still need
admin setup, the Tailscale CLI output is shown so you can follow its prompt.
