# Getting Started

This guide takes a project from one JSON file to a local API, local data explorer, generated schema metadata, and generated TypeScript types.

## Scaffold A Project

The fastest path is `async-db init`:

```bash
pnpm add @async/db
pnpm exec async-db init
pnpm exec async-db serve
```

`init` writes a starter JSON file, a `.gitignore` entry for `.db/`, optional package scripts when `package.json` exists, and runs the first sync. Templates:

```bash
pnpm exec async-db init --template data-first
pnpm exec async-db init --template schema-first
pnpm exec async-db init --template source-file
```

Use `--dry-run --json` to inspect the scaffold plan without writing files.

## Deno Quick Start

Local Deno projects consume the same npm package through Deno's `npm:` support. To start without creating a `package.json`, run init with the Deno workflow:

```bash
deno run --allow-read=. --allow-write=. --allow-sys=hostname npm:@async/db init --workflow deno --template data-first
deno task db:serve
```

`--workflow deno` creates or patches `deno.json` tasks, does not create a root `package.json`, and runs the first sync. The generated tasks use scoped permissions:

```json
{
  "nodeModulesDir": "auto",
  "tasks": {
    "db": "deno run --allow-read=. --allow-write=. --allow-sys=hostname npm:@async/db@0.15.0",
    "db:sync": "deno task db sync",
    "db:types": "deno task db types",
    "db:validate": "deno task db schema validate",
    "db:serve": "deno run --allow-read=. --allow-write=. --allow-sys=hostname --allow-net=127.0.0.1 npm:@async/db@0.15.0 serve"
  }
}
```

After that, pass CLI arguments directly through the Deno task:

```bash
deno task db init --workflow deno --template data-first
deno task db:sync
deno task db:validate
deno task db:serve
```

Minimum permissions are `--allow-read=. --allow-write=. --allow-sys=hostname` for sync, type generation, and schema validation. Local `serve` also needs `--allow-net=127.0.0.1`. If Deno resolves npm packages through a private or local registry by default, use the public registry for this package:

```bash
NPM_CONFIG_REGISTRY=https://registry.npmjs.org deno task db:sync
```

Supported Deno scope in this release is local Deno CLI usage: sync, schema validation, generated types, local serve, JSON mirrors, schema helpers, client helpers, and Git source helpers. JSR publishing, Deno Deploy, and Node-free edge runtime support are intentionally out of scope for this pass.

## Install

Install @async/db from npm:

```bash
pnpm add @async/db
```

Add package scripts for the CLI commands you want to run often:

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

If you need an unreleased fix, pin a reviewed GitHub commit or release tag instead of the moving default branch:

```json
{
  "devDependencies": {
    "@async/db": "github:async/db#<reviewed-commit-sha-or-tag>"
  }
}
```

The scripts use the local `node_modules/.bin/async-db` binary, so each project controls its own @async/db version.

## Create A JSON File

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
pnpm run db:sync
```

Sync reads data files and writes generated runtime output:

```txt
.db/schema.generated.json
.db/types/index.d.ts
.db/state/users.json
```

By default, app writes update the generated JSON store under `.db/state`. Source JSON files stay unchanged.

## Serve

In terminal 1:

```bash
pnpm run db:serve
```

Open the local data explorer:

```txt
http://127.0.0.1:7331/__db
```

In terminal 2, call the REST API:

```bash
curl http://127.0.0.1:7331/db/users.json
```

You can also read one record through the JSON-shaped URL:

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
pnpm run db -- schema validate
```

When `db/users.schema.json` and `db/users.json` both exist, the schema defines the contract and the data file provides seed records.

## Run A Repo Example

From this repository root:

```bash
pnpm run db -- sync --cwd ./examples/basic
pnpm run db -- serve --cwd ./examples/basic
```

Open:

```txt
http://127.0.0.1:7331/__db
```

The example README has the exact files and requests for that workflow: [examples/basic](../examples/basic/README.md).

## Next Steps

- Use [Concepts](./concepts.md) to understand data-first, schema-first, mixed resources, runtime stores, and source writebacks.
- Use [Data Files And Schemas](./data-files-and-schemas.md) to author richer JSON files and schemas.
- Use [Server And Local Data Explorer](./server-and-viewer.md) for REST, GraphQL, explorer, and watch behavior.
- Use [Generated Files](./generated-files.md) before committing generated output.
