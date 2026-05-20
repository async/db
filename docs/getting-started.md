# Getting Started

This guide takes a project from one fixture file to a local API, viewer, generated schema metadata, and generated TypeScript types.

## Install

Until @async/db is published, install it from GitHub with a pinned, reviewed commit SHA or release tag:

```json
{
  "devDependencies": {
    "@async/db": "github:PatrickJS/async-db#<reviewed-commit-sha-or-tag>"
  },
  "scripts": {
    "db": "async-db",
    "db:sync": "async-db sync",
    "db:serve": "async-db serve",
    "db:types": "async-db types"
  }
}
```

Replace the placeholder with the commit SHA or tag you reviewed. After package publication, prefer the published semver version. Then run:

```bash
npm install
```

The scripts use the local `node_modules/.bin/async-db` binary, so each project controls its own @async/db version.

## Create A Fixture

@async/db uses `./db` by default:

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

## Sync

```bash
npm run db:sync
```

Sync reads fixtures and writes generated runtime output:

```txt
.db/schema.generated.json
.db/types/index.ts
.db/state/users.json
```

By default, app writes update the generated JSON store under `.db/state`. Source fixtures stay unchanged.

## Serve

In terminal 1:

```bash
npm run db:serve
```

Open the viewer:

```txt
http://127.0.0.1:7331/__db
```

In terminal 2, call the REST API:

```bash
curl http://127.0.0.1:7331/db/users.json
```

You can also read one record through the fixture-shaped URL:

```bash
curl 'http://127.0.0.1:7331/db/users.json?id=u_1'
```

Create another record:

```bash
curl -X POST http://127.0.0.1:7331/db/users \
  -H 'content-type: application/json' \
  -d '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
```

The new record is written to `.db/state/users.json`, not `db/users.json`.

## Add A Schema

Add schema when the contract matters: required fields, defaults, descriptions, enums, uniqueness, relations, or stricter validation.

Create `db/users.schema.json`:

```json
{
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": { "type": "string", "required": true },
    "name": { "type": "string", "required": true },
    "email": {
      "type": "string",
      "required": true,
      "unique": true,
      "description": "Email address used for local sign-in."
    },
    "role": {
      "type": "enum",
      "values": ["admin", "user"],
      "default": "user"
    }
  }
}
```

Validate:

```bash
npm run db -- schema validate
```

When `db/users.schema.json` and `db/users.json` both exist, the schema defines the contract and the data file provides seed records.

## Run A Repo Example

From this repository root:

```bash
node ./src/cli.js sync --cwd ./examples/basic
node ./src/cli.js serve --cwd ./examples/basic
```

Open:

```txt
http://127.0.0.1:7331/__db
```

The example README has the exact files and requests for that workflow: [examples/basic](../examples/basic/README.md).

## Next Steps

- Use [Concepts](./concepts.md) to understand data-first, schema-first, mixed resources, runtime stores, and source writebacks.
- Use [Fixtures And Schemas](./fixtures-and-schemas.md) to author richer fixtures and schemas.
- Use [Server And Viewer](./server-and-viewer.md) for REST, GraphQL, viewer, and watch behavior.
- Use [Generated Files](./generated-files.md) before committing generated output.
