# REST Client Example

## What This Teaches

Use this when you want to call db from app or test code instead of typing `curl` commands. It demonstrates `createDbClient()`, direct REST calls, and a REST batch request.

## Files To Inspect

- [db/users.schema.jsonc](./db/users.schema.jsonc): schema-backed collection with defaults and unique email validation.
- [db/settings.json](./db/settings.json): singleton document inferred from data.
- [src/client-demo.mjs](./src/client-demo.mjs): tiny consumer script using `@async/db/client`.

## Run It

From the repository root, use the repo-internal CLI path:

```bash
node ./src/cli.js sync --cwd ./examples/rest-client
node ./src/cli.js serve --cwd ./examples/rest-client
```

In another terminal:

```bash
ASYNC_DB_URL=http://127.0.0.1:7331 node ./examples/rest-client/src/client-demo.mjs
```

## Expected Result

`sync` writes generated schema, types, and runtime state under `examples/rest-client/.db/`. The demo script prints users, settings, and a two-item batch result.

## REST Request To Try

Leave `serve` running and run this from another terminal:

```bash
curl 'http://127.0.0.1:7331/users?select=id,name,email'
```

## Cleanup

Generated `.db/` output is ignored by git and can be removed whenever you want a fresh mirror.

## More Docs

- [Package API](../../docs/package-api.md)
- [Server And Viewer](../../docs/server-and-viewer.md)
