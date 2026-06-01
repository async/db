# Production JSON Example

## What This Teaches

Use this when an app has small production control-plane data that should stay in reviewed JSON while browser traffic goes through registered operations. It models feature flags and public app settings as file-backed JSON resources, then exposes only operation refs to client code.

## Files To Inspect

- [db/featureFlags.schema.jsonc](./db/featureFlags.schema.jsonc): low-write feature flag records with explicit schema.
- [db/appSettings.schema.jsonc](./db/appSettings.schema.jsonc): singleton production settings document.
- [db/operations](./db/operations): registered operation templates for browser-facing reads.
- [db.config.mjs](./db.config.mjs): enables operation-only REST exposure and ref-only operation calls.
- [src/client-demo.mjs](./src/client-demo.mjs): tiny client script that calls generated operation refs.
- [src/generated/db.types.d.ts](./src/generated/db.types.d.ts): committed generated types.

## Run It

From the repository root, use the repo-internal CLI path:

```bash
npm run db -- sync --cwd ./examples/production-json
npm run db -- operations build --cwd ./examples/production-json
npm run db -- serve --cwd ./examples/production-json
```

In another terminal:

```bash
ASYNC_DB_URL=http://127.0.0.1:7331 node ./examples/production-json/src/client-demo.mjs
```

## Expected Result

`sync` writes generated schema, types, and runtime state under `examples/production-json/.db/`, plus the committed type copy in `src/generated/`.

`operations build` writes client-safe operation refs under `examples/production-json/src/generated/`. The server reads templates from `db/operations`, while the demo script reads generated refs and calls `GetControlPlane` and `GetFeatureFlag` through `client.query()`.

To review the browser-facing operation contract without volatile timestamps:

```bash
npm run db -- operations contract --cwd ./examples/production-json
npm run db -- operations contract --cwd ./examples/production-json --check
```

## Operation Requests To Try

Build operations, then use the generated ref from `examples/production-json/src/generated/db.operation-refs.json`:

```bash
curl -X POST http://127.0.0.1:7331/__db/operations/REF \
  -H 'content-type: application/json' \
  -d '{"variables":{"id":"flag_billing_v2"}}'
```

Raw REST routes are intentionally not the production-facing API in this example. `server.expose.rest: 'registered-only'` keeps app traffic on the registered operation boundary while the JSON files remain the first-party store.

## Why This Shape?

Feature flags and app settings are control-plane resources: small, low-write, easy to review, and useful to snapshot. That makes them a realistic production fit for `@async/db/json`.

The app should still evaluate sensitive targeting, auth, rate limits, and policy in app-owned code. The JSON store keeps the reviewed flag definitions; registered operations keep browser calls stable if a resource later graduates to SQLite, Postgres, Redis, or a custom store.

## Graduating One Resource

Keep `appSettings` and `featureFlags` on JSON when they remain small and low-write. If a new `orders` resource outgrows JSON, add a database store and move only that resource:

```js
import { defineConfig } from '@async/db/config';
import { postgresStore } from '@async/db/postgres';
import { pool } from './src/server/postgres-client.js';

export default defineConfig({
  stores: {
    default: 'json',
    appDb: postgresStore({ client: pool }),
  },
  resources: {
    appSettings: { store: 'json' },
    featureFlags: { store: 'json' },
    orders: { store: 'appDb' },
  },
  operations: {
    enabled: true,
    acceptRefs: 'ref',
    sourceDir: './db/operations',
  },
});
```

Operation templates that read `appSettings`, `featureFlags`, or `orders` stay behind the same `client.query(ref, variables)` call shape. The resource store changes; the browser contract does not.

## Features To Notice

- [Production JSON Database](../../docs/json-production.md)
- [Resource Graduation And Mixed Stores](../../docs/store-graduation.md)
- [Registered REST operations](../../docs/server-and-viewer.md#registered-rest-operations)
- [Operation-only exposure](../../docs/configuration.md#server-exposure)
- [Generated operation refs](../../docs/generated-files.md#operation-registry-output)

## Cleanup

Generated `.db/` output is ignored by git and can be removed whenever you want a fresh mirror. Generated operation ref files under `src/generated/` are safe to regenerate after operation template changes.
