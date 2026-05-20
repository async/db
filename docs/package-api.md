# Package API

This page covers the CLI, runtime API, HTTP client, and package exports.

## CLI

With a package script like `"db": "jsondb"`:

```bash
npm run db -- sync
npm run db -- types
npm run db -- types --watch
npm run db -- types --out ./src/generated/jsondb.types.ts
npm run db -- schema
npm run db -- schema users
npm run db -- schema infer users
npm run db -- schema infer users --out db/users.schema.jsonc
npm run db -- schema manifest --out ./src/generated/jsondb.schema.json
npm run db -- schema validate
npm run db -- doctor
npm run db -- doctor --json
npm run db -- check --strict
npm run db -- create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
npm run db -- serve
npm run db -- generate hono
npm run db -- generate hono --api rest,graphql --out ./server
```

Inside npm scripts, `jsondb` resolves to the local dependency binary. Equivalent direct commands:

```bash
jsondb sync
jsondb types
jsondb schema validate
jsondb doctor
jsondb check --strict
jsondb serve
jsondb generate hono
```

With pnpm and a `"db": "jsondb"` script, pass arguments directly to the script name:

```bash
pnpm db sync
pnpm db schema validate
pnpm db serve
```

## Runtime API

```ts
import { openJsonFixtureDb } from 'jsondb';

const db = await openJsonFixtureDb({
  dbDir: './db',
  stateDir: './.jsondb',
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

Singleton document usage:

```ts
const settings = db.document('settings');

await settings.set('/theme', 'dark');

const value = settings.get('/theme');
```

Import generated `JsonDbTypes` from `.jsondb/types/index.ts` or from a committed output file when typed collection names and records should be available to TypeScript.

## HTTP Client

```ts
import { createJsonDbClient } from 'jsondb/client';

const client = createJsonDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  batching: true,
});

const users = await client.rest.get('/users');

await client.rest.post('/users', {
  id: 'u_2',
  name: 'Grace Hopper',
  email: 'grace@example.com',
});

const batch = await client.rest.batch([
  { method: 'GET', path: '/users' },
  { method: 'GET', path: '/settings' },
]);
```

The client can batch requests made within a short timeout. The default batching window is `10ms`. Identical REST `GET` requests are deduped by default. Writes are not deduped unless you explicitly choose `dedupe: 'all'`.

## Fork Client

```ts
import { createJsonDbClient } from 'jsondb/client';

const legacyDb = createJsonDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  fork: 'legacy-demo',
});

const users = await legacyDb.rest.get('/users');
```

In Vite apps using `jsondbPlugin()`, the virtual client exposes the same helper:

```ts
import jsondb, { fork } from 'virtual:jsondb/client';

const users = await jsondb.rest.get('/users');
const legacyUsers = await fork('legacy-demo').rest.get('/users');
```

The helper is also attached to the default client as `jsondb.fork('legacy-demo')`.

## Package Exports

| Export | Use |
| --- | --- |
| `jsondb` | Runtime API such as `openJsonFixtureDb`. |
| `jsondb/schema` | `.schema.mjs` authoring helpers. |
| `jsondb/config` | `defineConfig` and manifest helpers. |
| `jsondb/client` | HTTP client with REST, GraphQL, and batching helpers. |
| `jsondb/vite` | Optional Vite dev server plugin. |
| `jsondb/hono` | Optional Hono route registration helpers. |
| `jsondb/sqlite` | Optional SQLite adapter helpers. |

The core package stays dependency-light. Optional integrations use dynamic imports or generated app dependencies.

## Repo Example Launcher

Run every repo example and open an index of their viewers:

```bash
npm run examples
```

The examples index starts each example on its own port and lists links to each `/__jsondb` viewer.
