# Local Web App Example

## What This Teaches

Use this pattern for small local tools where the Node server is the source of
truth and the app state should be easy to save with the project. The example
writes directly to `db/appState.json` instead of the default `.db/state` mirror.

## Files To Inspect

- [db.config.js](./db.config.js): sets `stores.default` to `sourceFile`.
- [db/appState.json](./db/appState.json): the saved app document.
- [src/app.js](./src/app.js): browser code that saves on blur/change.
- [framework/state.js](./framework/state.js): transient reload-state helpers.
- [server/runtime.js](./server/runtime.js): app routes, version polling endpoint, and `/__db` mounting.
- [serve-example.js](./serve-example.js): examples launcher hook.

## Simple Website Structure

The example keeps the important parts in predictable folders:

```txt
db/          saved JSON documents and seed data
src/         browser HTML, CSS, and app code
server/      loopback request handlers and @async/db mounting
framework/   small reload, draft, and input-state helpers
```

Use this shape when a toy website only needs local server state and a little
browser behavior. `src/` stays focused on the page, `server/` owns the loopback
routes, and `framework/` keeps supporting reload and draft helpers out of the
main app file.

## Run It

From the repository root:

```bash
npm run db -- sync --cwd ./examples/local-web-app
npm run examples
```

Open the `local-web-app` link from the examples index. Edit either field, then
move focus out of the field. The app saves the document through the loopback
server into `db/appState.json`.

## Why Sync With `sourceFile`?

`npm run db -- sync --cwd ./examples/local-web-app` still matters even though
the app writes directly to `db/appState.json`. Sync validates the data folder,
infers the schema, and writes generated metadata/types for the local data explorer and tools.

`stores.default: 'sourceFile'` changes where runtime writes land. Instead of
copying app edits into `.db/state/appState.json`, the server writes the plain
JSON source file. That keeps the saved state next to the toy project so it is
easy to inspect, copy, or commit.

## Features To Notice

- `stores.default: 'sourceFile'` makes plain JSON resources writable in `db/`.
- `resources.<name>.store` can still override the default for individual resources.
- Typing only updates transient browser state; blur/change commits to the server.
- Browser storage is only used to restore scroll position, active field, cursor
  position, and unsaved draft text during a reload.
- The app polls `/api/version` and reloads when the served app files change.

## Cleanup

This example intentionally edits `db/appState.json` when you use the app. Revert
that file if you want the initial sample text again.

Generated `.db/` output is ignored by git and can be removed whenever you want a fresh mirror.

## More Docs

- [Configuration](../../docs/configuration.md)
- [Server And Local Data Explorer](../../docs/server-and-viewer.md)
