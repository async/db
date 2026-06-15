# Production JSON Database

`@async/json` is the standalone file/folder JSON database engine. `@async/db/json`
keeps the existing compatibility subpath for @async/db users. This surface is
for resources that should stay simple, reviewable, and file-backed while the app
talks to the same @async/db API layer it would use for RedisJSON, SQLite,
Postgres, or a custom store.

The product split is:

- `@async/json` owns the JSON engine: file/folder opening, sidecar state,
  state-file helpers, declared local indexes, recovery, versioning, and
  RedisJSON runtime adapters.
- `@async/db` owns the app-facing data layer: readers, schemas, generated types,
  clients, REST/GraphQL metadata, registered operations, lifecycle, and store
  switching.

JSON controls the app. Databases record the app.

## Good Production Fits

Use the JSON store for small low-write resources that are naturally files:

- app settings
- feature flags and rollout rules
- navigation, labels, and UI configuration
- CMS/content records, docs metadata, and templates
- prompt templates and model/provider defaults
- plan, pricing, and entitlement definitions
- policy rules and permission maps
- seed data, demo data, sample JSON files, mocks, and test baselines

These are control-plane resources. They are valuable in production when they stay easy to review, snapshot, diff, and promote between environments.

See [examples/production-json](../examples/production-json/README.md) for a runnable feature flags and app settings example that keeps JSON as the store while browser traffic uses registered operation refs.

## Hard Limits

Do not use the JSON store as the primary production store for:

- chat messages, activity feeds, analytics events, or logs
- payments, ledgers, balances, inventory counters, or booking availability
- high-write user data or large searchable datasets
- data written by multiple app instances at the same time
- multi-region writes or cross-process transactional workflows
- compliance-heavy records that require database-level audit, retention, or access controls

The default JSON store writes complete resource files under `.db/state`. Each write goes to a temp file that is flushed (`fsync`) before an atomic rename, so a crash or power loss cannot publish a torn state file. Writes are queued in-process and additionally guarded by a per-resource advisory lock file (`<resource>.json.lock`), so a `sync` run beside a live server, or a second writer process on the same machine, waits instead of interleaving read-modify-write cycles. A lock held past its timeout fails with `JSON_STATE_LOCKED` rather than overwriting. That is still not a database transaction, query planner, or replicated storage system.

Single-record REST reads return an `ETag` header, and item-level writes accept `If-Match`, failing with 412 `DB_PRECONDITION_FAILED` when the record changed since it was read. Use this for human-edited control-plane data (flags, settings, templates) where two editors may hold the same form open. GETs also honor `If-None-Match`, answering `304 Not Modified` so feature-flag pollers and settings refreshers stop re-downloading unchanged data.

## Durability, History, And Recovery

Turn on versioned durability so every state write keeps the previous contents:

```js
export default {
  stores: {
    json: {
      driver: 'json',
      durability: 'versioned',
      maxVersions: 10,
    },
  },
};
```

Snapshots live under `.db/state/.versions/<resource>/` and are pruned per resource. Roll back with the CLI:

```bash
async-db restore featureFlags --list
async-db restore featureFlags                    # latest snapshot
async-db restore featureFlags --version <id>
```

Restores snapshot the current contents first, so a restore is itself undoable.

Back up the whole project state into one JSON bundle and restore from it later:

```bash
async-db backup --out ./backups/db-backup.json
async-db restore --from ./backups/db-backup.json --dry-run
async-db restore --from ./backups/db-backup.json
```

`doctor --production` reports when no backup has been recorded in the last seven days. Store bundles off-machine.

On boot the JSON store sweeps crash leftovers automatically: orphaned atomic-write temp files and locks whose owner process is gone are removed. A state file that no longer parses is quarantined to `<file>.corrupt-<ts>` (never deleted) and the newest version snapshot is restored when one exists; the process emits an `ASYNC_DB_STATE_RECOVERY` warning instead of refusing to start.

## Health, Authorization, And Audit

`GET /__db/health` is a load-balancer-friendly readiness probe: 200 with status, uptime, schema version, and resource counts, or 503 `degraded` when the state directory is not writable. It has its own exposure setting (`server.expose.health`, default open) so it stays reachable when the viewer is locked down, and mock delays never apply to it.

`server.authorize` is the app-owned gate for hardened deployments without a wrapper framework:

```js
export default {
  server: {
    expose: { viewer: 'dev', schema: 'dev' },
    authorize({ request, route, method }) {
      if (route === 'health' || method === 'GET') return true;
      return request.headers.authorization === `Bearer ${process.env.DB_WRITE_TOKEN}`
        ? true
        : { status: 401, body: { error: { code: 'TOKEN_REQUIRED' } } };
    },
  },
};
```

For compliance-adjacent control-plane data, record an audit trail per resource:

```js
export default {
  resources: {
    featureFlags: { audit: true },                 // op, id, changed fields
    billingSettings: { audit: { values: true } },  // plus before/after snapshots
  },
};
```

Entries append to `.db/state/.audit/<resource>.jsonl`. Audit failures warn and never fail the data write.

Sensitive-at-rest resources can seal their files with AES-256-GCM through a custom JSON store:

```js
import { jsonStore } from '@async/db/json';

export default {
  stores: {
    sealed: jsonStore({
      durability: 'versioned',
      encryption: { key: () => process.env.DB_STATE_KEY },
    }),
  },
  resources: {
    apiCredentials: { store: 'sealed' },
  },
};
```

Existing plaintext files read transparently and seal on their next write. Keep the key outside the repo; a wrong key fails reads with `JSON_ENCRYPTION_FAILED` instead of returning garbage.

## Replication Recipe (App-Owned)

Async DB does not replicate. For warm standbys, combine the pieces it does provide, litestream-style: enable `durability: 'versioned'`, subscribe to runtime change events (`db.runtime` events or the `/__db/events` stream), and copy the changed resource file plus its newest version snapshot to object storage on each event. Recovery is `async-db restore --from` a rebuilt bundle, or copying the state directory back. Promote reads-only replicas by serving the copied state dir with `server.expose` locked down. If you need synchronous multi-node writes, that is the signal to graduate the resource to Postgres.

Treat 1,000 collection records as a review point. `async-db doctor` already warns when a JSON-backed collection has more than 1,000 seed records without index metadata. For fast-changing or query-heavy collections, graduate the resource before users depend on it.

If a JSON state file is corrupt or only partially recoverable, `@async/db/json` reports `JSON_STATE_INVALID` with the file path and parser message. Restore that file from a known-good snapshot, delete it only when rehydrating from seed data is safe, or fix the JSON syntax before restarting the app.

## Production API Boundary

Do not expose local `async-db serve` as an unauthenticated public database API.

For production-facing traffic:

1. Move app routes to `/api/db/*` or `/api/*`.
2. Register stable operations for browser-facing reads and writes.
3. Generate client-safe operation refs.
4. Use `server.expose.rest: 'registered-only'` when raw REST should be blocked.
5. Add app-owned auth, authorization, rate limits, and monitoring around the mounted API.

The browser should call the data contract, not the JSON files. With the built-in operation system, that means calling generated operation refs:

```ts
const flags = await db.query(operationRefs.operations.ListFeatureFlags.ref);
```

The operation template can read JSON today and later point at a SQLite, Postgres, Redis, or custom-backed resource while the client call stays the same. App-owned servers can also wrap the operation route with auth, rate limits, policy checks, and flag evaluation before returning a client-safe result.

## Public JSON Helpers

Use `@async/db/json` when app or tooling code needs to inspect the built-in JSON database surface directly:

```ts
import {
  jsonStoreCapabilities,
  jsonStatePathForResource,
  readJsonState,
  writeJsonState,
} from '@async/db/json';

if (jsonStoreCapabilities.production === 'small-local') {
  const file = jsonStatePathForResource({ stateDir: './.db' }, 'settings');
  const settings = await readJsonState(file, {});
  await writeJsonState(file, settings);
}
```

Most app code should still use `openDb()`, `createDbClient()`, and registered operations. The JSON helpers are for tooling, diagnostics, migrations, exports, and advanced local workflows.

## Mixed Stores

Keep JSON for control-plane resources and graduate data-plane resources independently:

```js
export default {
  stores: {
    default: 'json',
    appDb: postgresStore({ client }),
  },
  resources: {
    featureFlags: { store: 'json' },
    settings: { store: 'json' },
    activityEvents: { store: 'appDb' },
    orders: { store: 'appDb' },
  },
};
```

The app-facing contract stays in @async/db. Frontend code calls the same generated types, REST resources, or registered operation refs while each resource chooses the storage boundary that fits its write rate and operational risk.

For the full resource-by-resource migration path, see [Resource Graduation And Mixed Stores](./store-graduation.md).

## Readiness Checklist

- Run `async-db doctor --production` before treating JSON-backed resources as production data. Use `async-db check --strict --production` when warnings should fail CI.
- Use explicit schemas for production JSON resources.
- Prefer `schema.unknownFields: 'error'` when drift should fail.
- Enable `stores.json.durability: 'versioned'` so every write keeps undoable history, and schedule `async-db backup` (doctor reminds you after seven days).
- Point load balancer checks at `GET /__db/health` and gate writes with `server.authorize`.
- Turn on `audit` for resources where "who changed what" questions will be asked later.
- Keep JSON-backed writes low-volume and single-writer. The advisory lock file protects same-machine processes; it does not coordinate writers on different hosts or shared network filesystems.
- Use `If-Match` preconditions (or `{ ifMatch }` runtime options) for editor-style write flows so concurrent edits fail with 412 instead of silently overwriting.
- Set `mock.delay: false` (or rely on the automatic `NODE_ENV=production` skip) so production responses do not carry the development mock delay.
- Snapshot or back up `.db/state` before deployments and migrations.
- Practice recovery for `JSON_STATE_INVALID` by restoring a known-good state snapshot.
- Keep browser traffic behind registered operations when exposing production APIs.
- Return evaluated feature flags or policy decisions to the browser, not sensitive rule internals.
- Move a resource to SQLite, Postgres, or a custom store when write rate, size, query needs, or concurrency exceed file-backed JSON limits.
