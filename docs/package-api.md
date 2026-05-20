# Package API

This page covers the CLI, runtime API, HTTP client, and package exports.

## CLI

With a package script like `"db": "async-db"`:

```bash
npm run db -- sync
npm run db -- types
npm run db -- types --watch
npm run db -- types --out ./src/generated/db.types.ts
npm run db -- schema
npm run db -- schema users
npm run db -- schema infer users
npm run db -- schema infer users --out db/users.schema.jsonc
npm run db -- schema manifest --out ./src/generated/db.schema.json
npm run db -- schema validate
npm run db -- viewer manifest --out ./src/generated/db.viewer.json
npm run db -- doctor
npm run db -- doctor --json
npm run db -- check --strict
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
async-db doctor
async-db check --strict
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
  dbDir: './db',
  stateDir: './.db',
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

Import generated `DbTypes` from `.db/types/index.ts` or from a committed output file when typed collection names and records should be available to TypeScript.

## HTTP Client

```ts
import { createDbClient } from '@async/db/client';

const client = createDbClient({
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
import { createDbClient } from '@async/db/client';

const legacyDb = createDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  fork: 'legacy-demo',
});

const users = await legacyDb.rest.get('/users');
```

In Vite apps using `dbPlugin()`, the virtual client exposes the same helper:

```ts
import db, { fork } from 'virtual:db/client';

const users = await db.rest.get('/users');
const legacyUsers = await fork('legacy-demo').rest.get('/users');
```

The helper is also attached to the default client as `db.fork('legacy-demo')`.

## Package Exports

| Export | Use |
| --- | --- |
| `@async/db` | Runtime API such as `openDb`. |
| `@async/db/schema` | `.schema.mjs` authoring helpers. |
| `@async/db/config` | `defineConfig` and manifest helpers. |
| `@async/db/client` | HTTP client with REST, GraphQL, and batching helpers. |
| `@async/db/vite` | Optional Vite dev server plugin. |
| `@async/db/hono` | Optional Hono route registration helpers. |
| `@async/db/sqlite` | Optional SQLite adapter helpers. |

The core package stays dependency-light. Optional integrations use dynamic imports or generated app dependencies.

## Repo Example Launcher

Run every repo example and open an index of their viewers:

```bash
npm run examples
```

The examples index starts each example on its own port and lists links to each `/__db` viewer.
