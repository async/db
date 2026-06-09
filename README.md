# @async/db

`@async/db` gives frontend teams a gradual path from mock JSON to production data contracts. Drop JSON files in `db/`, infer schema metadata, serve a local REST API and viewer, then graduate persistence per resource without rewriting frontend data access.

Use it to:

- Start from editable JSON, JSONC, or CSV data files in `db/`.
- Infer schema contracts and generate TypeScript types from data files and schemas.
- Serve local REST routes and a lightweight viewer while the backend contract is still forming.
- Upgrade persistence per resource without rewriting frontend data access.
- Emit schema metadata for admin, CMS, or form-building screens.

`@async/db` is not a universal key/value driver layer; storage is one boundary inside the JSON-to-contract workflow.

## 30-Second Start

```bash
npm install @async/db
npx async-db init
npx async-db serve
```

Open `http://127.0.0.1:7331/__db` and call `GET /db/users.json`.

No config file is required. `init` writes a starter JSON file, `.gitignore` entry for `.db/`, optional package scripts, and runs the first sync. Prefer a manual one-file start?

```bash
mkdir -p db
printf '%s\n' '[{"id":"u_1","name":"Ada Lovelace","email":"ada@example.com"}]' > db/users.json
npx async-db serve
```

`serve` syncs on startup and watches `db/` for changes.

## File Map

| Files | Purpose |
| --- | --- |
| `db/*.json`, `db/*.jsonc`, `db/*.csv` | Data files |
| `db/*.schema.json`, `db/*.schema.jsonc`, `db/*.schema.js` | Optional stricter schema contracts |
| `db.schema.js` | Optional root schema registry for all resources |
| `.db/state/*` | Generated writable JSON store state |
| `.db/schema.generated.json`, `.db/types/index.d.ts` | Generated metadata and types |

## Install

```bash
npm install @async/db
```

Add package scripts for the CLI commands you run often:

```json
{
  "scripts": {
    "db": "async-db",
    "db:sync": "async-db sync",
    "db:serve": "async-db serve",
    "db:types": "async-db types"
  }
}
```

The package import name is `@async/db`. Helpers are available from `@async/db/config`, `@async/db/schema`, `@async/db/client`, and `@async/db/json`.

## Five-Minute Start

Create a JSON file:

```bash
mkdir -p db
cat > db/users.json <<'JSON'
[
  {
    "id": "u_1",
    "name": "Ada Lovelace",
    "email": "ada@example.com"
  }
]
JSON
```

Sync generated metadata, types, and runtime state:

```bash
npm run db:sync
```

Start the local API and viewer:

```bash
npm run db:serve
```

Open the viewer at `http://127.0.0.1:7331/__db`.

Call the REST API:

```bash
curl http://127.0.0.1:7331/db/users.json
```

Create a local record:

```bash
curl -X POST http://127.0.0.1:7331/db/users \
  -H 'content-type: application/json' \
  -d '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
```

Default sync output:

```txt
.db/schema.generated.json
.db/types/index.d.ts
.db/state/users.json
```

Local responses include a small `30-100ms` mock delay by default so loading states are visible. Disable it when you want immediate responses:

```js
export default {
  mock: { delay: false },
};
```

See [docs/getting-started.md](./docs/getting-started.md) for the expanded walkthrough, including `async-db init --template schema-first` and `--template source-file`.

## Defaults

| Behavior | Default |
| --- | --- |
| Source data files | Read from `./db` |
| App data routes | Exposed under `/db`, such as `GET /db/users.json` |
| Runtime writes | Go to the JSON store under `.db/state` |
| Local server | `127.0.0.1:7331` |
| REST | Enabled |
| GraphQL / Falcor | Disabled until you opt in |
| Schema drift | Warn on unknown fields |

## Add Schema When It Pays For It

Data-first JSON files are enough until the shape matters:

```bash
npm run db -- schema infer users
npm run db -- schema infer users --out db/users.schema.jsonc
npm run db -- schema validate
```

Add `db/users.schema.json`, `db/users.schema.jsonc`, or `db/users.schema.js` when you need stricter behavior, defaults, relations, or Standard Schema validators.

See [docs/concepts.md](./docs/concepts.md) and [docs/data-files-and-schemas.md](./docs/data-files-and-schemas.md).

## Common Commands

```bash
npm run db -- sync
npm run db -- types
npm run db -- schema validate
npm run db -- doctor
npm run db -- create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
npm run db -- serve
npm run db -- init --template data-first
npm run db -- init --template schema-first
npm run db -- init --template source-file
```

See [docs/package-api.md](./docs/package-api.md) for CLI and package export details.

## Going To Production

The default path stays small on purpose. When a resource gets serious, follow the ladder:

| Tier | When | Next step |
| --- | --- | --- |
| **0 — JSON files** | Prototype with JSON in `db/` | You are here after `init` or `serve` |
| **1 — Contracts** | Shape, defaults, and types matter | Add schema files and committed generated types |
| **2 — Hardened API** | Browser or external clients consume data | Registered operations, `server.expose`, contracts, `doctor --production` |
| **3 — Mixed stores** | JSON is no longer the right persistence | Per-resource store graduation to SQLite, Postgres, or custom stores |

Production topics:

- [Production JSON Database](./docs/json-production.md): scoped JSON for flags, settings, and control-plane data
- [Prototype To Production REST Guide](./docs/prototype-to-production.md): move `/db/*` to `/api/*`, registered operation refs, route lockdown
- [Resource Graduation And Mixed Stores](./docs/store-graduation.md): graduate one resource at a time
- [Configuration](./docs/configuration.md): `server.expose`, operations, contracts, stores, and mock behavior
- Contracts CLI: `async-db contracts infer`, `async-db contracts check`, `async-db contracts refs`

The built-in JSON store is production-appropriate only for file-suitable resources: app settings, feature flags, content, templates, and other small low-write data with a single writer. Keep high-write user data, chat, analytics, ledgers, and compliance-heavy records in SQLite, Postgres, or another app-owned store.

`@async/db` is not an auth layer, an ORM, or a hosted database service. Put production traffic behind registered operations, app-owned auth, rate limits, and observability.

## Examples

Run `npm run examples` to open the grouped examples index, or sync and serve one example directly:

```bash
npm run db -- sync --cwd ./examples/basic
npm run db -- serve --cwd ./examples/basic
```

### Start here

| Example | What it shows |
| --- | --- |
| [`examples/data-first`](./examples/data-first) | Plain JSON files before schemas exist |
| [`examples/basic`](./examples/basic) | Shortest schema-backed workflow |
| [`examples/schema-first`](./examples/schema-first) | Schema-only resources and empty seed records |
| [`examples/csv`](./examples/csv) | CSV inference and mirror refreshes |

### Core workflows

| Example | What it shows |
| --- | --- |
| [`examples/relations`](./examples/relations) | Relation metadata, `expand`, nested `select` |
| [`examples/rest-client`](./examples/rest-client) | `createDbClient`, REST batching |
| [`examples/diagnostics`](./examples/diagnostics) | File-specific warnings without breaking valid resources |
| [`examples/computed-fields`](./examples/computed-fields) | Computed field patterns across several models |
| [`examples/content-collections`](./examples/content-collections) | Docs/blog folders as static content collections |
| [`examples/standard-schema`](./examples/standard-schema) | Standard Schema validators with Async DB overlays |
| [`examples/schema-manifest`](./examples/schema-manifest) | Committed schema metadata for admin/CMS UI |
| [`examples/schema-ui`](./examples/schema-ui) | Manifest-driven SSR admin templates |
| [`examples/advanced`](./examples/advanced) | Mixed mode, defaults, nested objects |

### Production and app patterns

| Example | What it shows |
| --- | --- |
| [`examples/production-json`](./examples/production-json) | Feature flags and settings behind registered operations |
| [`examples/hono-auth`](./examples/hono-auth) | Optional Hono auth and write hooks |
| [`examples/cms-json-publish`](./examples/cms-json-publish) | App-owned CMS publish flow over branches |
| [`examples/free-plan-upgrade`](./examples/free-plan-upgrade) | Tenant resource graduation from JSON to another store |
| [`examples/local-web-app`](./examples/local-web-app) | Loopback app state saved directly to `db/*.json` |

Each example README is the runnable authority for that example.

## Docs Map

| Task | Read |
| --- | --- |
| Start a project | [docs/getting-started.md](./docs/getting-started.md) |
| Understand the model | [docs/concepts.md](./docs/concepts.md) |
| Author data files and schemas | [docs/data-files-and-schemas.md](./docs/data-files-and-schemas.md) |
| Manage generated output | [docs/generated-files.md](./docs/generated-files.md) |
| Configure @async/db | [docs/configuration.md](./docs/configuration.md) |
| Use JSON in production safely | [docs/json-production.md](./docs/json-production.md) |
| Serve local data and REST/viewer | [docs/server-and-viewer.md](./docs/server-and-viewer.md) |
| Graduate REST prototypes | [docs/prototype-to-production.md](./docs/prototype-to-production.md) |
| Use the package API or CLI | [docs/package-api.md](./docs/package-api.md) |
| Review public API surface | [API_SURFACE.md](./API_SURFACE.md) |
| Integrate with Vite, Hono, or SQLite | [docs/integrations.md](./docs/integrations.md) |

For the full product behavior and acceptance model, see [SPEC.md](./SPEC.md).
