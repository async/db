# Resource Graduation And Mixed Stores

`@async/db` lets each resource choose the store that matches its operational risk while the app keeps one data layer. The usual production shape is:

- JSON for control-plane resources such as settings, feature flags, templates, policy rules, and seed data.
- SQLite, Postgres, or a custom store for data-plane resources such as orders, activity, user-owned records, and high-write collections.
- Registered operations as the public API boundary so client code does not care which store backs a resource.

## When To Graduate A Resource

Move one resource out of JSON when it starts needing database behavior:

- writes happen often enough that whole-file rewrites are wasteful
- more than one process or app instance can write it
- users need filtered, indexed, or paginated queries over a growing dataset
- records need transactional guarantees, audit controls, or operational retention
- the data is business-critical enough that database backup and restore should own it

Do not graduate the whole app by default. Keep file-suitable resources in JSON and move only the resource that outgrew it.

## Postgres Example

Keep control-plane resources on JSON and put app data in Postgres:

```js
import { defineConfig } from '@async/db/config';
import { postgresStore } from '@async/db/postgres';
import { pool } from './src/server/postgres-client.js';

export default defineConfig({
  stores: {
    default: 'json',
    appDb: postgresStore({
      client: pool,
      namespace: 'production',
    }),
  },
  resources: {
    appSettings: { store: 'json' },
    featureFlags: { store: 'json' },
    promptTemplates: { store: 'json' },
    orders: { store: 'appDb' },
    activityEvents: { store: 'appDb' },
  },
  operations: {
    enabled: true,
    acceptRefs: 'ref',
    sourceDir: './db/operations',
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

The built-in Postgres store persists each resource value in JSONB envelopes. That is enough for a resource graduation path behind the `@async/db` API. If a mature resource needs relational tables, custom SQL, or Postgres-native indexes per field, move that resource behind an app-owned custom store or generated API while preserving the same operation refs.

## SQLite Example

For single-node production apps, desktop apps, internal tools, and small deployments, SQLite can be the first graduation step:

```js
import { defineConfig } from '@async/db/config';
import { sqliteStore } from '@async/db/sqlite';

export default defineConfig({
  stores: {
    default: 'json',
    appDb: sqliteStore({
      file: './.db/app.sqlite',
    }),
  },
  resources: {
    appSettings: { store: 'json' },
    featureFlags: { store: 'json' },
    orders: { store: 'appDb' },
  },
});
```

SQLite keeps the deployment simple, but it still changes the operational boundary: backup the SQLite file, avoid multi-writer network filesystems, and move to Postgres when many app instances need concurrent writes.

## What The App Keeps

When a resource graduates, preserve these contracts:

- resource name, such as `orders`
- schema fields and generated TypeScript names where possible
- registered operation name and ref
- client call shape, such as `db.query(operationRefs.operations.ListOrders.ref)`
- app-owned auth and policy checks around the operation route

The store config changes, but app code keeps calling the same data layer:

```ts
await db.query(operationRefs.operations.GetControlPlane.ref);
await db.query(operationRefs.operations.ListOrders.ref, { accountId });
```

`GetControlPlane` can read JSON-backed `appSettings` and `featureFlags`; `ListOrders` can read a database-backed `orders` resource. Both calls still go through `@async/db` registered operations.

## Graduation Steps

1. Add or tighten the explicit schema for the resource while it is still JSON-backed.
2. Add a registered operation for the browser-facing read or write path.
3. Generate and commit the client-safe operation contract if the app ships refs.
4. Add the target store to `db.config.mjs`.
5. Set only the graduating resource to that store with `resources.<name>.store`.
6. Run `async-db sync` so the target store hydrates from the existing seed or fixture.
7. Move existing production state with an app-owned migration or export/import script.
8. Keep JSON resources in JSON unless they have their own reason to graduate.
9. Run `async-db doctor --production`, operation contract checks, and app integration tests before deploying.

See [examples/production-json](../examples/production-json/README.md) for the feature flags/settings side of this pattern.
