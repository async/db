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

The built-in Postgres store persists each resource value in JSONB envelopes.
That is enough for a resource graduation path behind the `@async/db` API. If a
mature resource needs relational tables, custom SQL, or Postgres-native indexes
per field, move that resource behind an app-owned custom store, existing-table
mapping, or generated API while preserving the same operation refs.

## Inspecting Existing Postgres Apps

When an app already has Postgres tables, inspect before migrating. The default
story is wrapper-first: keep the Postgres schema, migrations, indexes,
transactions, RLS, triggers, ORM layer, and existing DB facade as the write
source of truth.

```bash
async-db integrate inspect ./src --postgres
async-db integrate inspect ./src --postgres --postgres-url-env DATABASE_URL --schema public --json
async-db integrate inspect ./src --postgres --postgres-url-env DATABASE_URL --schema public --out ./src/generated/db.integration.json
async-db integrate inspect ./src --postgres --postgres-url-env DATABASE_URL \
  --target-postgres-table public._async_db_resources \
  --out ./src/generated/db.integration.json
```

`--postgres` without a URL performs source-only guidance. `--postgres-url-env`
opts into live read-only catalog inspection and redacts the connection string
from reports and errors. Connection failures fail the command unless
`--allow-partial` is passed. Exact row counts are opt-in with
`--exact-row-counts`; catalog estimates are the default.

Use the recommendation as the migration path:

- `operation-wrapper`: keep current Postgres writes and expose existing DB facade methods through Async DB operations.
- `read-model`: keep writes app-owned and expose views, materialized views, event logs, dashboards, or reporting data as read-only Async DB resources.
- `table-backed-adapter`: map a simple single non-generated primary-key table with `openPostgresDb({ tables })` while the existing Postgres database stays in place.
- `app-owned-sql`: leave compound-key, join-table, no-primary-key, generated/identity, RLS-heavy, trigger-dependent, partitioned, transactional, high-write, or ORM-owned tables app-owned.
- `manual-review`: inspect ORM/query-builder code and wrap it instead of bypassing its schema, hooks, transactions, migrations, or RLS assumptions.

Compound-key tables should keep their real identity. Do not add a surrogate id
by default. Expose operation inputs that match the Postgres key, such as
`{ tenantId, slug }`, and only add a generated Async DB id during an explicit
import or storage-model migration.

Low-level Postgres driver imports can move behind `@async/db/postgres/compat`.
Compat adapts `pg`, `postgres`, `@neondatabase/serverless`,
`@vercel/postgres`, and `pg-promise` clients so transitional wrappers and
generated importers do not import those packages directly. Prisma, Drizzle,
Kysely, Knex, Sequelize, TypeORM, MikroORM, Objection, Slonik, and Supabase
stay advisory in this pass: wrap their existing facade instead of bypassing
their migrations, hooks, transactions, or RLS assumptions.

For existing tables, `postgresStore()` is not the right first move: it stores
Async DB resource envelopes in its own table, defaulting to
`public._async_db_resources`. Use `openPostgresDb({ tables, migrate: false })`
or operation wrappers when the app already owns relational Postgres tables:

```js
const db = await openPostgresDb({
  client: pool,
  migrate: false,
  tables: {
    users: {
      schema: 'public',
      table: 'app_users',
      columns: { id: 'user_id', name: 'full_name' },
      primaryKey: 'id',
    },
    projectSlugs: {
      schema: 'public',
      table: 'project_slugs',
      primaryKey: ['tenant_id', 'slug'],
      readOnly: true,
    },
  },
});
```

Only use import mode when the app intentionally wants to copy rows into
Async DB-owned state:

```bash
async-db integrate generate importer \
  --plan ./src/generated/db.integration.json \
  --out ./scripts/import-legacy-postgres.js
node ./scripts/import-legacy-postgres.js
node ./scripts/import-legacy-postgres.js --apply
```

Generated import plans map single-primary-key tables to collections, compound
keys to deterministic import ids while preserving the real key fields,
settings tables to documents, and event/log tables to append-only collections.
The generated importer is dry-run by default and only writes when passed
`--apply`.

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

The built-in SQLite store requires a runtime that exposes `node:sqlite` (it fails with `SQLITE_RUNTIME_UNAVAILABLE` otherwise; the package itself supports Node 24 or newer for every JSON-backed path). SQLite under local Deno is preview-only and depends on Deno's current `node:sqlite` compatibility. Like the JSON store, query helpers such as `find`, `count`, and `aggregate` load the collection into memory first, and generated ids scan existing ids per create, so keep collections in the small-thousands range or move query-heavy resources behind app-owned SQL or registered operations.

## Inspecting Existing SQLite Apps

When an app already has SQLite tables, inspect before migrating. The default
story is wrapper-first: keep the SQLite file, schema, migrations, indexes, ORM
layer, and existing DB facade as the write source of truth.

```bash
async-db integrate inspect ./src --sqlite ./data/app.sqlite
async-db integrate inspect ./src --sqlite ./data/app.sqlite --json
async-db integrate inspect ./src --sqlite ./data/app.sqlite --out ./src/generated/db.integration.json
async-db integrate inspect ./src --sqlite ./data/app.sqlite \
  --target-state ./data/app.asyncdb \
  --out ./src/generated/db.integration.json
```

The inspector is advisory and read-only. It inventories tables, primary keys,
indexes, foreign keys, row counts, source files with SQLite usage, suggested
adoption paths, low-level driver hints, optional import plans, and suggested
files for an incremental `@async/db` adoption.

Use the recommendation as the migration path:

- `operation-wrapper`: keep current SQLite writes and expose existing DB facade methods through Async DB operations.
- `read-model`: keep writes app-owned and expose views, event logs, dashboards, or reporting data as read-only Async DB resources.
- `table-backed-adapter`: map a simple single-primary-key table with `openSqliteDb({ tables })` while the SQLite file stays in place.
- `app-owned-sql`: leave compound-key, join-table, no-primary-key, specialized SQL, high-write, or ORM-owned tables app-owned.
- `manual-review`: inspect ORM/query-builder code and wrap it instead of bypassing its schema, hooks, or migrations.

Compound-key tables should keep their real identity. Do not add a surrogate id
by default. Expose operation inputs that match the SQLite key, such as
`{ name, version }`, and only add a new id column during an explicit
storage-model migration.

Low-level SQLite driver imports can move behind `@async/db/sqlite/compat`.
Compat adapts `node:sqlite`, `better-sqlite3`, `sqlite3`, and the `sqlite`
promise wrapper so transitional wrappers and generated importers do not import
those packages directly. Drizzle, Kysely, and Prisma stay advisory in this pass:
wrap their existing facade instead of bypassing their migrations or hooks.

For existing tables, `sqliteStore()` is not the right first move: it stores
Async DB resource envelopes in its own `_db_resources` table. Use
`openSqliteDb({ tables, migrate: false })` or operation wrappers when the app
already owns relational SQLite tables:

```js
const db = await openSqliteDb({
  file: './data/app.sqlite',
  migrate: false,
  tables: {
    users: {
      table: 'app_users',
      columns: { id: 'user_id', name: 'full_name' },
      primaryKey: 'id',
    },
    packageVersions: {
      table: 'package_versions',
      primaryKey: ['name', 'version'],
    },
  },
});
```

Only use import mode when the app intentionally wants to retire direct SQLite
and copy rows into an Async DB-owned state file:

```bash
async-db integrate generate importer \
  --plan ./src/generated/db.integration.json \
  --out ./scripts/import-legacy-sqlite.js
node ./scripts/import-legacy-sqlite.js
node ./scripts/import-legacy-sqlite.js --apply
```

Generated import plans map single-primary-key tables to collections, compound
keys to deterministic import ids while preserving the real key fields, settings
tables to documents, and event/log tables to append-only collections. The
generated importer is dry-run by default and only writes when passed `--apply`.

For dashboard reads that used to be small SQL queries, prefer collection helper
methods before adding app SQL back:

```js
const events = db.collection('installEvents');
const recentBlocks = await events.find({
  where: { decision: 'block' },
  orderBy: '-at',
  limit: 50,
});
const byDecision = await events.aggregate({
  groupBy: 'decision',
  metrics: { count: 'count', bytes: { op: 'sum', field: 'bytes' } },
});
```

Event logs can opt into `writePolicy: 'append-only'` and write through
`collection.append(record)`, which blocks update, patch, delete, and replace-all
calls for that resource.

If event writes repeat the same `id`, `type`, `level`, `message`, `payload`, and
`createdAt` shaping in several apps, use `eventResource()` as ergonomic sugar
over those append-only resources. It should not be treated as missing
append-only storage support.

For example, a local package registry with firewall tables may keep package
blocking writes in app-owned SQLite, while using `@async/db` for dashboard
read-model resources such as package inventory, auth/private package views,
download metrics, and event timelines.

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
4. Add the target store to `db.config.js`.
5. Set only the graduating resource to that store with `resources.<name>.store`.
6. Run `async-db sync` so the target store hydrates from the existing seed data.
7. Move existing production state with an app-owned migration or export/import script.
8. Keep JSON resources in JSON unless they have their own reason to graduate.
9. Run `async-db doctor --production`, operation contract checks, and app integration tests before deploying.

See [examples/production-json](../examples/production-json/README.md) for the feature flags/settings side of this pattern.
