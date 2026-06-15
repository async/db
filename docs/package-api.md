# Package API

This page covers the CLI, runtime API, HTTP client, and package exports.

## CLI

With a package script like `"db": "async-db"`:

```bash
pnpm run db -- sync
pnpm run db -- init --template data-first
pnpm run db -- init --template schema-first
pnpm run db -- init --template source-file
pnpm run db -- types
pnpm run db -- types --watch
pnpm run db -- types --out ./src/generated/db.types.d.ts
pnpm run db -- schema
pnpm run db -- schema users
pnpm run db -- schema infer users
pnpm run db -- schema infer users --out db/users.schema.jsonc
pnpm run db -- schema manifest --out ./src/generated/db.schema.json
pnpm run db -- schema validate
pnpm run db -- schema migrate inspect ./src --out ./src/generated/db.schema-migration.json
pnpm run db -- schema migrate generate --plan ./src/generated/db.schema-migration.json --schema-dir ./db --format mixed
pnpm run db -- viewer manifest --out ./src/generated/db.viewer.json
pnpm run db -- operations build
pnpm run db -- operations build --out ./src/generated/db.operations.json --refs-out ./src/generated/db.operation-refs.json
pnpm run db -- contracts check
pnpm run db -- contracts refs --out ./src/generated/db.contract-refs.json
pnpm run db -- usage scan ./src --production
pnpm run db -- usage scan ./src --production --out ./src/generated/db.usage.json
pnpm run db -- integrate inspect ./src --sqlite ./data/app.sqlite
pnpm run db -- integrate inspect ./src --sqlite ./data/app.sqlite --out ./src/generated/db.integration.json
pnpm run db -- integrate inspect ./src --sqlite ./data/app.sqlite --target-state ./data/app.asyncdb --out ./src/generated/db.integration.json
pnpm run db -- integrate inspect ./src --postgres
pnpm run db -- integrate inspect ./src --postgres --postgres-url-env DATABASE_URL --schema public --out ./src/generated/db.integration.json
pnpm run db -- integrate inspect ./src --postgres --postgres-url-env DATABASE_URL --target-postgres-table public._async_db_resources --out ./src/generated/db.integration.json
pnpm run db -- integrate generate importer --plan ./src/generated/db.integration.json --out ./scripts/import-legacy-sqlite.js
pnpm run db -- doctor
pnpm run db -- doctor --production
pnpm run db -- doctor --production --usage ./src --json
pnpm run db -- doctor --json
pnpm run db -- check --strict --production
pnpm run db -- create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
pnpm run db -- serve
pnpm run db -- generate hono
pnpm run db -- generate hono --api rest,graphql --out ./server
```

Inside npm scripts, `db` resolves to the local dependency binary. Equivalent direct commands:

```bash
async-db init --template data-first
async-db sync
async-db types
async-db schema validate
async-db schema migrate inspect ./src --json
async-db schema migrate inspect ./src --out ./src/generated/db.schema-migration.json
async-db schema migrate generate --plan ./src/generated/db.schema-migration.json --schema-dir ./db --format mixed
async-db viewer manifest --out ./src/generated/db.viewer.json
async-db operations build
async-db usage scan ./src --production
async-db integrate inspect ./src --sqlite ./data/app.sqlite --json
async-db integrate inspect ./src --sqlite ./data/app.sqlite --target-state ./data/app.asyncdb --out ./src/generated/db.integration.json
async-db integrate inspect ./src --postgres
async-db integrate inspect ./src --postgres --postgres-url-env DATABASE_URL --schema public --json
async-db integrate inspect ./src --postgres --postgres-url-env DATABASE_URL --target-postgres-table public._async_db_resources --out ./src/generated/db.integration.json
async-db integrate generate importer --plan ./src/generated/db.integration.json --out ./scripts/import-legacy-sqlite.js
async-db doctor
async-db doctor --production
async-db doctor --production --usage ./src --json
async-db check --strict --production
async-db backup --out ./backups/db-backup.json
async-db restore featureFlags --list
async-db restore featureFlags --version latest
async-db restore --from ./backups/db-backup.json --dry-run
async-db serve
async-db generate hono
```

`backup` bundles every resource's JSON state (with content hashes) into one
file and records backup recency for `doctor --production`. `restore` rolls a
resource back to a version snapshot (requires `stores.json.durability:
'versioned'` for ongoing history) or restores from a backup bundle; both
snapshot the current contents first so restores are undoable.

With pnpm and a `"db": "async-db"` script, pass arguments through `pnpm run`:

```bash
pnpm run db -- sync
pnpm run db -- schema validate
pnpm run db -- serve
```

### `async-db init`

Scaffold the smallest valid local project shape:

```bash
async-db init
async-db init --template schema-first
async-db init --template source-file
async-db init --dry-run --json
```

Templates:

| Template | Writes |
| --- | --- |
| `data-first` | `db/users.json`, `.gitignore`, package scripts |
| `schema-first` | `db/users.schema.jsonc` with empty seed |
| `source-file` | `db.config.js` with `stores.default: 'sourceFile'` and `db/appState.json` |

`init` refuses to overwrite existing files, runs `sync` after writing files, and prints follow-up commands. When no `package.json` exists, init creates a minimal private ESM one with the `db` scripts. When an existing package is not `"type": "module"`, the `source-file` template writes the config with Node's explicit ESM module extension instead of `.js`, so init never changes a project's module type.

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

const recentAdmins = await users.find({
  where: { role: 'admin' },
  orderBy: '-createdAt',
  limit: 10,
});
const userCount = await users.count({ where: { active: true } });

await db.close();
```

### In-Memory Filesystem

`openDb()` can take a filesystem adapter when a tool, test, or embedded runtime
needs to boot from virtual files and keep generated output out of the real
project folder:

```js
import { createMemoryFs, openDb } from '@async/db';

const fs = createMemoryFs({
  cwd: '/virtual-app',
  files: {
    'db/users.json': JSON.stringify([
      { id: 'u_1', name: 'Ada Lovelace' },
    ]),
  },
});

const db = await openDb({
  cwd: '/virtual-app',
  fs,
  stores: {
    default: 'json',
  },
});

await db.collection('users').create({
  id: 'u_2',
  name: 'Grace Hopper',
});

const state = await fs.readFile('/virtual-app/.db/state/users.json', 'utf8');
```

The adapter is used for data-file reads, generated outputs, JSON runtime state,
`sourceFile` writebacks, operations manifests, forks, branches, and snapshots.
Executable local code such as `db.config.js` and `.schema.js` still runs through
Node's module loader, so virtual projects should use inline options or
JSON and `.schema.json` schema sources.

Collections also expose small store-neutral query helpers for local app reads:
`find({ where, orderBy, limit, offset })`, `count({ where })`, and
`aggregate({ groupBy, metrics })`. These helpers run over the collection API
first, so JSON stores, Async DB-owned SQLite stores, and table-backed SQLite
resources share one app-facing shape.

### Minimal Collection Queries

Minimal queries are intended for local app reads, admin screens, dashboards, and
small read models before you need a custom operation or store-specific query
planner. The first implementation runs over `collection.all()`, which means it
works for the default JSON-backed store without extra setup. Existing
table-backed SQLite and Postgres resources expose the same helper shape.

```ts
const packages = db.collection('packages');

const blocked = await packages.find({
  where: {
    status: 'blocked',
    requestCount: { gte: 5 },
    name: { contains: '@company/' },
  },
  orderBy: [{ field: 'requestCount', direction: 'desc' }, 'name'],
  limit: 25,
  offset: 0,
});

const blockedCount = await packages.count({
  where: { status: 'blocked' },
});
```

`where` supports equality shorthand plus small operator objects:

```ts
await packages.find({
  where: {
    status: { in: ['blocked', 'review'] },
    requestCount: { gt: 0, lte: 100 },
    sourceRegistry: { ne: 'internal' },
  },
});
```

Supported operators are `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte`, and
`contains`. `orderBy` accepts a field name, a `-field` descending shorthand, a
`{ field, direction }` object, or an array of those entries.

Aggregates return plain rows. Group fields are copied onto each result row, and
metrics are named by the keys you choose:

```ts
const byStatus = await packages.aggregate({
  where: { sourceRegistry: 'npm' },
  groupBy: 'status',
  metrics: {
    count: 'count',
    requests: { op: 'sum', field: 'requestCount' },
    maxRequests: { op: 'max', field: 'requestCount' },
  },
  orderBy: '-requests',
});
```

Supported aggregate operations are `count`, `sum`, `min`, `max`, and `avg`.
Use registered operations or a store-specific adapter when a query needs indexes,
joins, full SQL semantics, or must stay efficient over large collections.

Call `db.close()` when a long-running process is done with the database so stores with open handles, such as SQLite or Postgres clients, can release them.

Use `createDbRuntime()` when custom Node middleware should own the same
development lifecycle as `async-db serve`: open the db, sync or hydrate, watch
data files in `db/`, publish lifecycle events, expose request middleware, and clean
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

Use `inspectSqliteIntegration()` when an existing app already owns SQLite
tables and you want an adoption plan before changing storage. Existing SQLite
stays the source of truth by default. The inspector is read-only: it opens the
SQLite file for schema metadata, scans source text for common SQLite usage, and
returns a versioned report for people or coding agents.

```ts
import { inspectSqliteIntegration } from '@async/db';

const report = await inspectSqliteIntegration({
  cwd: process.cwd(),
  target: './src',
  sqliteFile: './data/app.sqlite',
  // Optional: only when planning an explicit import into Async DB-owned state.
  targetState: './data/local-registry.asyncdb',
});

console.log(report.recommendations);
```

The report has `kind: "db.integrationReport"` and includes:

- SQLite inventory: tables, columns, primary keys, indexes, foreign keys, row counts, and table classifications.
- Source inventory: high-confidence SQLite imports, prepared statements, raw SQL, migration files, low-level driver hints, and ORM/query-builder signals.
- Recommendations: `direct-resource`, `read-model`, `custom-store`, `app-owned-sql`, or `manual-review`.
- Suggestions: wrapper-first adoption guidance such as keeping existing SQLite as source of truth, using operations for compound keys, and exposing read models first.
- Adoption paths: `operation-wrapper`, `read-model`, `table-backed-adapter`, or `app-owned-sql` with storage migration marked as optional or not recommended.
- Import plan: only when `targetState` or CLI `--target-state` is provided, with explicit legacy-table to Async DB-owned resource mapping.
- Suggested files: `db.config.js`, resource schemas, committed schema/viewer manifests, and optional adapter/read-model modules.
- Agent instructions: a short next-step checklist that favors wrapping existing DB calls before replacing app-owned writes.

For existing SQLite apps, prefer this order:

1. Wrap current DB facade methods with Async DB operations.
2. Expose views, event logs, and dashboard tables as read-only resources.
3. Use `openSqliteDb({ tables })` for simple table-backed resources.
4. Move storage only after app parity tests pass.

`sqliteStore()` is Async DB-owned SQLite storage for resource JSON envelopes.
Use `openSqliteDb({ tables })` when the app already owns relational SQLite
tables and the database file must stay in place:

```ts
import { openSqliteDb } from '@async/db/sqlite';

const db = await openSqliteDb({
  cwd: process.cwd(),
  file: './data/app.sqlite',
  migrate: false,
  tables: {
    users: {
      table: 'app_users',
      columns: {
        id: 'user_id',
        name: 'full_name',
      },
      primaryKey: 'id',
    },
    packageVersions: {
      table: 'package_versions',
      primaryKey: ['name', 'version'],
    },
  },
});

await db.table('users').get('u_1');
await db.table('packageVersions').get({ name: '@async/db', version: '0.4.0' });
```

Use `@async/db/sqlite/compat` when transitional code already has a low-level
SQLite driver handle. Compat supports `node:sqlite`, `better-sqlite3`,
`sqlite3`, and the `sqlite` promise wrapper without adding mandatory
dependencies:

```ts
import { openLegacySqlite, compoundKeyId } from '@async/db/sqlite/compat';

const legacy = await openLegacySqlite({
  driver: 'node:sqlite',
  file: './data/local-registry.sqlite',
  readOnly: true,
  tables: {
    packageVersions: {
      table: 'package_versions',
      primaryKey: ['name', 'version'],
    },
  },
});

const packageVersion = await legacy.table('packageVersions').get({
  name: '@async/db',
  version: '0.4.0',
});
const id = compoundKeyId(['name', 'version'], packageVersion);
```

For explicit import mode, generate a dry-run importer from an integration
report:

```bash
async-db integrate inspect ./src --sqlite ./data/local-registry.sqlite \
  --target-state ./data/local-registry.asyncdb \
  --out ./src/generated/db.integration.json
async-db integrate generate importer \
  --plan ./src/generated/db.integration.json \
  --out ./scripts/import-legacy-sqlite.js
node ./scripts/import-legacy-sqlite.js
node ./scripts/import-legacy-sqlite.js --apply
```

Use `inspectPostgresIntegration()` when an existing app already owns Postgres
tables and you want an adoption plan before changing storage. Existing Postgres
stays the source of truth by default. Without `postgresUrlEnv`, the inspector
does source-only guidance. With `postgresUrlEnv`, it performs read-only catalog
inspection and redacts the URL value from reports and errors.

```ts
import { inspectPostgresIntegration } from '@async/db';

const report = await inspectPostgresIntegration({
  cwd: process.cwd(),
  target: './src',
  postgresUrlEnv: 'DATABASE_URL',
  schemas: ['public'],
  // Optional: only when planning an explicit import into Async DB-owned state.
  targetPostgresTable: 'public._async_db_resources',
});

console.log(report.postgres.mode);
console.log(report.recommendations);
```

The Postgres report has `kind: "db.integrationReport"` and includes:

- Postgres mode: `source-only`, `catalog`, or `partial`.
- Catalog inventory: schemas, tables, views, materialized views, columns, primary keys, unique indexes, foreign keys, triggers, RLS policies, and estimated row counts.
- Source inventory: low-level driver imports, raw SQL, migration/schema ownership files, DB facade files, and ORM/query-builder signals.
- Recommendations and adoption paths parallel to SQLite: wrapper, read-model, table-backed, app-owned SQL, and manual review.
- Import plan: only when `targetPostgresTable`, `targetState`, or CLI import flags are provided.

For existing Postgres apps, prefer this order:

1. Wrap current DB facade methods with Async DB operations.
2. Expose views, materialized views, event logs, and dashboards as read-only resources.
3. Use `openPostgresDb({ tables })` for simple single non-generated primary-key tables.
4. Move storage only after app parity tests pass.

`postgresStore()` is Async DB-owned JSONB envelope storage for resources. Use
`openPostgresDb({ tables })` when the app already owns relational Postgres
tables and the schema must stay in place:

```ts
import { openPostgresDb } from '@async/db/postgres';
import { pool } from './src/postgres.js';

const db = await openPostgresDb({
  cwd: process.cwd(),
  client: pool,
  migrate: false,
  tables: {
    users: {
      schema: 'public',
      table: 'app_users',
      columns: {
        id: 'user_id',
        name: 'full_name',
      },
      primaryKey: 'id',
    },
    packageVersions: {
      schema: 'public',
      table: 'package_versions',
      primaryKey: ['name', 'version'],
      readOnly: true,
    },
  },
});

await db.table('users').get('u_1');
await db.table('packageVersions').get({ name: '@async/db', version: '0.5.1' });
```

Use `@async/db/postgres/compat` when transitional code already has a low-level
Postgres client. Compat supports `pg`, `postgres`, Neon serverless, Vercel
Postgres, and `pg-promise` without adding mandatory dependencies:

```ts
import { adaptPostgresClient, openLegacyPostgres, compoundKeyId } from '@async/db/postgres/compat';

const client = adaptPostgresClient(existingPool, { driver: 'pg' });
const legacy = await openLegacyPostgres({
  client,
  readOnly: true,
  tables: {
    packageVersions: {
      schema: 'public',
      table: 'package_versions',
      primaryKey: ['name', 'version'],
    },
  },
});

const packageVersion = await legacy.table('packageVersions').get({
  name: '@async/db',
  version: '0.5.1',
});
const id = compoundKeyId(['name', 'version'], packageVersion);
```

For explicit Postgres import mode, generate a dry-run importer from an
integration report:

```bash
async-db integrate inspect ./src --postgres --postgres-url-env DATABASE_URL \
  --target-postgres-table public._async_db_resources \
  --out ./src/generated/db.integration.json
async-db integrate generate importer \
  --plan ./src/generated/db.integration.json \
  --out ./scripts/import-legacy-postgres.js
node ./scripts/import-legacy-postgres.js
node ./scripts/import-legacy-postgres.js --apply
```

Use `--target-state ./data/app.asyncdb` instead of
`--target-postgres-table ...` when the import target should be an Async
DB-owned local SQLite state file.

Event-log resources can use `writePolicy: "append-only"` and
`collection.append(record)`. Append-only collections reject patch, update,
delete, and replace-all calls while still allowing append-style event writes.

Singleton document usage:

```ts
const settings = db.document('settings');

await settings.set('/theme', 'dark');
await settings.set(['ui', 'sidebar', 'collapsed'], true);
await settings.set('locale', 'en-US');

const value = await settings.get('/theme');
const collapsed = await settings.get(['ui', 'sidebar', 'collapsed']);
```

Document paths support JSON Pointer strings such as `/ui/theme`, exact array
paths such as `['ui', 'theme']`, and bare top-level string shorthand such as
`'theme'`. Use `document.put(value)` to replace the whole document.

### Optimistic Concurrency With ETags

Collection `update`/`patch`/`delete` and document `put`/`update` accept an
optional `{ ifMatch }` precondition. The write only applies when the stored
value's current tag matches; otherwise it fails with a 412
`DB_PRECONDITION_FAILED` error instead of overwriting a concurrent edit.
`recordEtag(value)` computes the tag for a value you previously read:

```ts
import { openDb, recordEtag } from '@async/db';

const users = db.collection('users');
const ada = await users.get('u_1');
const etag = recordEtag(ada);

// Later: only apply the edit if nobody else changed the record meanwhile.
await users.patch('u_1', { name: 'Ada King' }, { ifMatch: etag });
```

REST exposes the same behavior over HTTP: single-record `GET` responses carry
an `ETag` header, and item-level `PATCH`/`DELETE` plus document `PUT`/`PATCH`
honor the `If-Match` request header (`*` means "must exist"). Mismatches answer
`412` with the `DB_PRECONDITION_FAILED` error envelope. Bulk routes ignore
`If-Match`.

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
root, a `db/` folder, the root `db.schema.js` / `db.schema.js`, or one resource schema file.

```ts
import { loadDbSchema, openDb } from '@async/db';

const schema = await loadDbSchema({ from: './db.schema.js' });

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

Database-derived fields use serializable `derived` metadata and are also
read-only. Use them for generated columns, identity columns,
trigger-maintained timestamps, view columns, or externally-owned values:

```json
{
  "type": "datetime",
  "readOnly": true,
  "derived": {
    "source": "database",
    "kind": "trigger"
  }
}
```

Executable schema files can use `field.derived(field.datetime(), { source:
'database', kind: 'trigger' })`. `computed` remains reserved for Async DB
resolver-backed fields.

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

## Schema Declaration Migration API

Use `schema migrate` when a project already declares contracts through Prisma,
Drizzle, SQL migrations, JSON Schema/OpenAPI, TypeBox, Zod, Valibot, ArkType,
or ORM model files and wants reviewable Async DB schema drafts.

```bash
async-db schema migrate inspect ./src --out ./src/generated/db.schema-migration.json
async-db schema migrate generate --plan ./src/generated/db.schema-migration.json --schema-dir ./db --format mixed
```

`inspect` does not execute app schema files. It emits
`kind: "db.schemaMigrationReport"` with detected source matches, resource
drafts, suggestions, and an output plan. `generate` writes
`db/<resource>.schema.jsonc` drafts where possible and refuses to overwrite
existing schema files unless `--force` is passed.

`--format mixed` is the default. It writes `.schema.jsonc` for static contracts
and `.schema.js` drafts when executable validator behavior needs manual
preservation. `--format jsonc` forces JSONC-only output and reports warnings for
unsupported behavior.

Programmatic inspection is available from the root package:

```ts
import { inspectSchemaMigration } from '@async/db';

const report = await inspectSchemaMigration({
  cwd: process.cwd(),
  target: './src',
  schemaDir: './db',
  format: 'mixed',
});

console.log(report.kind);
console.log(report.resources.map((resource) => resource.output.file));
```

Pass a loaded schema to `openDb({ schema })` when one process wants to inspect
or validate the contract first, then open the runtime database from the same
schema locator:

```ts
const schema = await loadDbSchema({ from: './db.schema.js' });
const db = await openDb({ schema });
```

`loadDbSchema()` is metadata-only by default and does not call content/data
readers, runtime stores, or computed resolvers. `openDb()` defaults to runtime
loading and reads the matching data/content sources.

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

Keep runtime store selection in `db.config.js`, for example
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
to `eventPolicy`; data-file reload events from `/__db/events` refresh the
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

Package/runtime callers can also pass contract context for enforcement:

```ts
await db.query(operationRefs.operations.GetUser.ref, {
  id: 'u_1',
}, {
  contract: 'public',
});
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
| `@async/db` | Runtime API such as `openDb`, schema loading, and `inspectSchemaMigration`. |
| `@async/db/schema` | `.schema.js` and `.schema.js` authoring helpers, including `field.derived`. |
| `@async/db/config` | `defineConfig` and manifest helpers. |
| `@async/db/client` | HTTP client with REST, GraphQL, and batching helpers. |
| `@async/db/json` | Compatibility exports for `@async/json` file database capabilities and safe JSON state helpers. |
| `@async/db/vite` | Optional Vite dev server plugin. |
| `@async/db/hono` | Optional Hono route registration helpers. |
| `@async/db/sqlite` | Optional SQLite adapter helpers. |
| `@async/db/sqlite/compat` | Low-level SQLite driver adapters for migration wrappers and generated importers. |
| `@async/db/postgres` | Optional Postgres runtime store helpers using an injected client. |
| `@async/db/kv` | Optional generic KV runtime store helpers using an injected `get`/`set` client. |
| `@async/db/redis` | Optional Redis-named KV helper plus additive RedisJSON store adapter. |

The core package stays dependency-light. Optional integrations use dynamic
imports, generated app dependencies, or injected database clients.

`@async/json` owns the standalone JSON file/folder engine. `@async/db/json`
keeps the existing compatibility subpath for JSON store capability metadata and
safe file-state helpers used by tooling, diagnostics, exports, and migrations.
Most app code should still use `openDb()`, `createDbClient()`, and registered
operations so resources can graduate from JSON to RedisJSON, SQLite, Postgres,
or custom stores without changing client calls.

`@async/db/redis` keeps the existing `redisStore()` KV-style resource store and
adds `redisJson()` for Redis JSON runtimes. `redisJson()` uses per-record JSON
keys for collections and maps only explicit `resources.<name>.indexes` metadata
to Redis Search indexes.

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
}, {
  contract: 'public',
});
```

Use `execute(ref, variables, options)` for direct calls or
`executeRequest(ref, body, options)` when adapting an HTTP request body shaped
as `{ variables, contract }`. Framework adapters should pass registry,
`acceptRefs`, `resolveRef`, or `validateRef` at handler creation time, and pass
the request contract at execution time.

Use `buildContractRefsManifest()`, `checkContracts()`,
`inferContractsFromTags()`, and `inferContractsFromUsage()` for build-tool
workflows that need the same contract logic without shelling out to the CLI.

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

Run every repo example and open an index of their local data explorers:

```bash
pnpm run examples
```

The examples index runs on one loopback port and starts each example runtime lazily when you open its demo or `/__db` local data explorer.

To get an HTTPS URL for the examples index inside your tailnet, opt in to
Tailscale Serve:

```bash
pnpm run examples -- --tailscale-serve
```

This runs `tailscale serve --bg <port>` after the local examples host starts.
@async/db does not call `tailscale cert`, manage local certificate files, or
change tailnet settings directly. If MagicDNS or HTTPS certificates still need
admin setup, the Tailscale CLI output is shown so you can follow its prompt.
