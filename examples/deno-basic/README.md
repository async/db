# Deno Basic Example

## What This Teaches

Use this when your local project uses Deno tasks instead of package scripts. Async DB still comes from npm, and Deno runs it through `npm:` package support.

## Files To Inspect

- [deno.json](./deno.json): Deno tasks with scoped read, write, sys, and serve network permissions.
- [db/users.json](./db/users.json): collection inferred from a JSON array.

## Run It

From this example directory:

```bash
deno task db:sync
deno task db:validate
deno task db:serve
```

Open the local data explorer:

```txt
http://127.0.0.1:7331/__db
```

## Expected Result

`sync` infers the `users` collection and writes generated runtime state under `.db/`.

## REST Request To Try

Leave `serve` running and run this from another terminal:

```bash
curl 'http://127.0.0.1:7331/db/users.json?select=id,name,email'
```

## Features To Notice

- [Deno quick start](../../docs/getting-started.md#deno-quick-start)
- [Data-first JSON files](../../docs/data-files-and-schemas.md#start-with-json-files)
- [REST query parameters](../../docs/server-and-viewer.md#rest-routes)

## Cleanup

Generated `.db/` output and Deno's `node_modules/` folder are local artifacts and can be removed whenever you want a fresh run.
