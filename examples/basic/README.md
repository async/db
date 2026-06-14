# Basic Example

## What This Teaches

Start here when you want the smallest schema-backed db workflow. It demonstrates sync, committed generated types, the local data explorer, file-backed `.json` REST reads, and creating a record.

## Files To Inspect

- [db/users.schema.jsonc](./db/users.schema.jsonc): schema-backed collection with seed data.
- [db/settings.json](./db/settings.json): singleton document inferred from data.
- [db/operations/get-user.jsonc](./db/operations/get-user.jsonc): optional registered REST operation template.
- [src/generated/db.types.d.ts](./src/generated/db.types.d.ts): committed generated types.

## Run It

From the repository root, use the repo-internal CLI path:

```bash
pnpm run db -- sync --cwd ./examples/basic
pnpm run db -- operations build --cwd ./examples/basic
pnpm run db -- serve --cwd ./examples/basic
```

Open the local data explorer:

```txt
http://127.0.0.1:7331/__db
```

## Expected Result

`sync` writes generated schema, types, and runtime state under `examples/basic/.db/`, plus the committed type copy in `src/generated/`.

`operations build` writes a full server registry and client-safe refs under
`examples/basic/src/generated/`.

To review the browser-facing operation contract without volatile timestamps:

```bash
pnpm run db -- operations contract --cwd ./examples/basic
pnpm run db -- operations contract --cwd ./examples/basic --check
```

## REST Request To Try

Leave `serve` running and run this from another terminal:

```bash
curl http://127.0.0.1:7331/db/users.json
```

The `.json` route is intentional: a source data file such as `db/users.json`
maps naturally to `GET /db/users.json`, while the server still reads from the
synced runtime resource under `.db/state`.

Create a local runtime record:

```bash
curl -X POST http://127.0.0.1:7331/db/users \
  -H 'content-type: application/json' \
  -d '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
```

The equivalent CLI smoke command is:

```bash
pnpm run db -- create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}' --cwd ./examples/basic
```

## Registered Operation To Try

Build operations, then use the generated ref from
`examples/basic/src/generated/db.operation-refs.json`:

```bash
curl -X POST http://127.0.0.1:7331/__db/operations/REF \
  -H 'content-type: application/json' \
  -d '{"variables":{"id":"u_1"}}'
```

## Features To Notice

- [File-backed `.json` REST routes](../../docs/server-and-viewer.md#fixture-like-json-routes)
- [Schema-backed data files](../../docs/data-files-and-schemas.md#add-schema-when-inference-is-not-enough)
- [Generated types](../../docs/generated-files.md#generated-types)
- [Registered REST operations](../../docs/server-and-viewer.md#registered-rest-operations)

## Cleanup

Generated `.db/` output is ignored by git and can be removed whenever you want a fresh mirror.

## More Docs

- [Getting Started](../../docs/getting-started.md)
- [Generated Files](../../docs/generated-files.md)
