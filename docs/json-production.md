# Production JSON Database

`@async/db/json` is the first-party file database surface for @async/db. It is for resources that should stay simple, reviewable, and file-backed while the app talks to the same @async/db API layer it would use for SQLite, Postgres, or a custom store.

The product split is:

- `@async/db` owns the app-facing data layer: schemas, generated types, clients, REST/GraphQL metadata, registered operations, and store switching.
- `@async/db/json` owns the simple JSON file database surface: JSON store capability metadata and safe JSON state-file helpers.

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
- seed data, demo data, fixtures, mocks, and test baselines

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

The default JSON store writes complete resource files under `.db/state`. Writes are atomic at the file/resource level and queued in-process, but that is not the same as a database transaction, cross-process lock, query planner, or replicated storage system.

Treat 1,000 collection records as a review point. `async-db doctor` already warns when a JSON-backed collection has more than 1,000 seed records without index metadata. For fast-changing or query-heavy collections, graduate the resource before users depend on it.

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

## Readiness Checklist

- Run `async-db doctor --production` before treating JSON-backed resources as production data. Use `async-db check --strict --production` when warnings should fail CI.
- Use explicit schemas for production JSON resources.
- Prefer `schema.unknownFields: 'error'` when drift should fail.
- Keep JSON-backed writes low-volume and single-writer.
- Snapshot or back up `.db/state` before deployments and migrations.
- Keep browser traffic behind registered operations when exposing production APIs.
- Return evaluated feature flags or policy decisions to the browser, not sensitive rule internals.
- Move a resource to SQLite, Postgres, or a custom store when write rate, size, query needs, or concurrency exceed file-backed JSON limits.
