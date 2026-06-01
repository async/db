# Concepts

@async/db turns local fixture sources into generated contracts, runtime state, local APIs, and type metadata. The default path is intentionally small: write fixture files first, then add schema only when the app contract needs it.

## Product Boundary

@async/db is:

- local development and test infrastructure
- a simple JSON file database for scoped low-write production resources
- data-first by default
- REST-first by default
- dependency-light in the core package
- useful before the real database or backend contract is settled
- a stable API/data layer while selected resources graduate to SQLite, Postgres, or custom stores

@async/db is not:

- a hosted production database service
- a multi-writer transactional database
- an auth or permission system
- an ORM
- broad JSON Schema compatibility
- a replacement for application-owned validation in production services

The JSON store is appropriate in production only for small, low-write, file-suitable resources such as settings, feature flags, content, templates, policy rules, and seed data. Use SQLite, Postgres, or another app-owned store for high-write records, transactional data, analytics/events, chat/messages, ledgers, inventory counters, multi-instance writes, and compliance-heavy data.

## Data-First

Start with `db/*.json`, `db/*.jsonc`, or `db/*.csv` when you already have sample records.

```json
[
  {
    "id": "u_1",
    "name": "Ada Lovelace",
    "active": true
  }
]
```

@async/db infers useful local contracts from the fixture shape. It uses those contracts for generated types, REST metadata, GraphQL metadata, viewer metadata, and write validation.

When inference is ambiguous, @async/db should emit diagnostics and `doctor` suggestions instead of guessing too hard.

## Schema-First

Use schema-first fixtures when you know the contract before you have useful records.

```json
{
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": { "type": "string", "required": true },
    "role": {
      "type": "enum",
      "values": ["admin", "user"],
      "default": "user"
    }
  },
  "seed": []
}
```

Schema-first resources can start empty and still generate types, REST metadata, GraphQL metadata, and viewer metadata.

## Mixed Mode

Mixed mode means a resource has both schema and data sources:

```txt
db/users.schema.json
db/users.json
```

The schema file is authoritative. The data file provides seed records. If a schema file still contains embedded `seed` while a data fixture exists, @async/db ignores the embedded seed and warns.

Useful commands:

```bash
npm run db -- schema unbundle users
npm run db -- schema bundle users --out artifacts/users.bundle.schema.json
```

Keep bundled schema-plus-seed artifacts outside `db/` unless you intentionally use `--force`.

## Runtime Stores

The default `json` store keeps source fixtures clean and writes app changes to generated runtime state:

```txt
db/users.json              source fixture
.db/state/users.json   writable runtime JSON store
```

This is the safest default for local development because tests, demos, and UI prototyping do not rewrite committed fixtures.

It is also the first-party JSON file database for production resources that should remain small, reviewable, and low-write. Keep production app traffic behind @async/db resources or registered operations so a resource can later move from JSON to SQLite, Postgres, or a custom store without rewriting frontend data access.

Bind a resource to a different store when runtime state belongs somewhere else:

```js
export default {
  stores: {
    default: 'json',
  },
  resources: {
    settings: { store: 'json' },
    activityEvents: { store: 'sqlite' },
  },
};
```

## Source File Store

Use the `sourceFile` store only when you intentionally want @async/db to write supported changes back to source files.

The main source writeback case is generated ids for plain `.json` collection fixtures that omit `id`. JSONC and CSV sources remain parsed source inputs; generated runtime state still lives under `.db/`.

## Diagnostics

Diagnostics are part of the workflow:

- schema errors should block invalid resources
- warnings should surface schema/data drift without breaking unrelated resources
- `doctor` should suggest helpful schema or fixture improvements
- `check --strict` should make warnings fail in CI

Commands:

```bash
npm run db -- doctor
npm run db -- doctor --json
npm run db -- check --strict
```

See [Fixtures And Schemas](./fixtures-and-schemas.md) for authoring details and [Server And Viewer](./server-and-viewer.md) for how diagnostics appear while serving.
