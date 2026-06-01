# Integrations

@async/db keeps integrations optional. The core package remains dependency-light; apps opt into Vite, Hono, SQLite, or generated starter code when they need those paths.

## Vite Dev Server Plugin

Vite apps can mount @async/db into the existing dev server instead of running `async-db serve` on a second port:

```js
import { defineConfig } from 'vite';
import { dbPlugin } from '@async/db/vite';

export default defineConfig({
  plugins: [
    dbPlugin(),
  ],
});
```

The plugin is dev-only (`apply: 'serve'`). It does not run during `vite build`, and it does not add a mandatory Vite dependency to @async/db.

By default, app data routes use `/db`, while dev-tool routes stay scoped under `/__db`:

```txt
GET  /db/users.json
GET  /__db
GET  /__db/schema
POST /__db/batch
POST /__db/graphql
GET  /__db/rest/users
GET  /__db/rest/users/u_1
```

Use the virtual browser client from app code:

```ts
import db, { fork } from 'virtual:db/client';

const users = await db.rest.get('/users');
const selected = await db.rest.get('/users?select=id,name');

const legacyDb = fork('legacy-demo');
const legacyUsers = await legacyDb.rest.get('/users');
```

Plugin options include `cwd`, `dbDir`, `outputs`, legacy `stateDir`, `forks`, `apiBase`, `dataPath`, `restBasePath`, `graphqlPath`, `rootRoutes`, `clientVirtualModule`, `clientImport`, and `clientCache`.
The plugin uses `apiBase` first, then `server.apiBase`, then `/__db` for scoped dev routes.
Use `server.dataPath: false` to disable the `/db` app-facing data route alias.

Set `clientCache: true` to opt the virtual browser client into the default
memory cache during Vite dev. Object form supports serializable cache policy
options:

```ts
dbPlugin({
  clientCache: {
    enabled: true,
    readPolicy: 'cache-and-network',
    writePolicy: 'merge-and-invalidate',
    eventPolicy: 'refetch',
  },
});
```

Use `createDbClient()` directly when you need an explicit browser storage
adapter such as `createIndexedDbCacheStorage(...)`.

Add `trace` to the plugin options to override `db.config.mjs` for Vite dev
requests:

```ts
dbPlugin({
  trace: {
    enabled: true,
    slowMs: 100,
  },
});
```

Set `rootRoutes: true` only when you intentionally want Vite dev to also answer unscoped routes like `/users`. Standalone `async-db serve` keeps those root REST routes by default.

The plugin watches fixture sources, not generated runtime output. @async/db also skips rewriting generated and state files when their content is unchanged, so normal `sync` or `openDb()` calls should not trigger Vite reloads by changing mtimes alone.

If an app commits generated files under frontend source, Vite may still reload when those files genuinely change. Ignore only generated files that the browser does not need to hot reload.

```ts
export default defineConfig({
  server: {
    watch: {
      ignored: [
        '../.db/**',
        // Only include committed generated files here when browser code
        // does not import them at runtime.
        'src/generated/db.schema.json',
        'src/generated/db.types.d.ts',
      ],
    },
  },
});
```

## Hono Route Registration

Apps that own a Hono instance can register @async/db REST routes and wrap them with lifecycle hooks.

```ts
import { registerDbRoutes } from '@async/db/hono';

registerDbRoutes(app, db, {
  prefix: '/api',
  operations: true,
  trace: true,
  resources: ['pages', 'charts'],
  lifecycleHooks: {
    beforeRequest({ c }) {
      const session = readSession(c.req.header('authorization'));
      if (!session) return c.json({ error: 'Unauthorized' }, 401);
      c.set('session', session);
    },
    beforeWrite({ c, body }) {
      if (c.get('session')?.role !== 'admin') {
        return c.json({ error: 'Forbidden' }, 403);
      }
      if (body) body.updatedAt = new Date().toISOString();
    },
  },
  hooks: {
    beforeCreate({ body }) {
      body.createdAt ??= body.updatedAt;
    },
  },
});
```

Resource hook order is deterministic:

1. `beforeRequest`
2. `beforeWrite` for `create`, `patch`, `put`, or `delete`
3. matching global method hook
4. matching resource method hook
5. @async/db operation

Any hook can return a Hono response to short-circuit the request. Write hooks can mutate `body` before @async/db validates and writes it.
Registered operation routes run `lifecycleHooks.beforeRequest` before operation
execution with `method: 'operation'` and the operation `ref`. They do not run
resource write or resource method hooks.
When tracing is enabled, hook phases and short-circuit responses are included in
the request trace event without recording request or response bodies.

Registered operations mount at `POST {prefix}/operations/:ref` when
`db.config.operations.enabled` is true. Set `operations: false` for a REST-only
mount, `operations: true` to explicitly use global config, or pass a local
registry/resolver when a Hono app owns a custom build step:

```ts
registerDbRoutes(app, db, {
  prefix: '/api/db',
  operations: {
    registry: generatedOperations.operations,
    acceptRefs: 'ref',
  },
});
```

See [examples/hono-auth](../examples/hono-auth/README.md) for a runnable Hono app with bearer-token auth.

For guidance on moving local `/db/*` prototype routes to `/api/db/*` or
`/api/*` production namespaces, registered operation refs, and locked-down
route exposure, see the
[Prototype To Production REST Guide](./prototype-to-production.md).

## Hono And SQLite Starter Generation

When fixtures and schemas have settled enough to graduate toward a real database API, generate a Hono starter:

```bash
async-db generate hono
async-db generate hono --api rest,graphql --out ./server
async-db generate hono --api none --app module
```

The default output is `./db-api` with REST routes, a portable repository interface, a `node:sqlite` adapter, validators, and an initial SQL migration.

Generated standalone apps are TypeScript-first and target Node.js `>=22.13` because SQLite output uses `node:sqlite`.

The main package stays dependency-light. Generated apps declare their own `hono`, `@hono/node-server`, `typescript`, and `tsx` dependencies.

Generation fails on schema errors and, by default, on schema warnings so production starter code only uses declared schema fields. Pass `--allow-warnings` only when you intentionally want to generate with warning diagnostics.

## Optional Runtime Hono/SQLite

Apps can also use optional runtime exports directly:

```ts
import { Hono } from 'hono';
import { createDbHonoApp } from '@async/db/hono';

const app = new Hono();
app.route('/api', await createDbHonoApp({
  dbDir: './db',
  storage: {
    kind: 'sqlite',
    file: './data/app.sqlite',
  },
  api: ['rest'],
}));
```

These integrations are opt-in. They should not make `hono`, `@hono/node-server`, or SQLite libraries mandatory dependencies of the core package.
