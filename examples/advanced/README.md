# Advanced Example

## What This Teaches

Use this after the basics when you want to see several features working together: mixed-mode data files, `.schema.js`, defaults, nested objects, and committed generated types.

## Files To Inspect

- [db/users.schema.js](./db/users.schema.js): schema helper API from `@async/db/schema`.
- [db/users.json](./db/users.json): data seed for the schema-backed `users` collection.
- [db/projects.schema.jsonc](./db/projects.schema.jsonc): nested object defaults.
- [src/generated/db.types.d.ts](./src/generated/db.types.d.ts): committed generated types.

## Run It

From the repository root, use the repo-internal CLI path:

```bash
npm run db -- sync --cwd ./examples/advanced
npm run db -- serve --cwd ./examples/advanced
```

Open the viewer:

```txt
http://127.0.0.1:7331/__db
```

## Expected Result

`sync` loads mixed data and schema sources, applies defaults in the selected runtime store, and writes committed generated types.

## REST Request To Try

Leave `serve` running and run this from another terminal:

```bash
curl 'http://127.0.0.1:7331/db/projects.json?select=id,name,status,metadata'
```

## Features To Notice

- [JavaScript schema sources](../../docs/data-files-and-schemas.md#javascript-schema-sources)
- [Schema defaults](../../docs/configuration.md#schema-defaults)
- [File-backed `.json` REST routes](../../docs/server-and-viewer.md#fixture-like-json-routes)
- [Generated types](../../docs/generated-files.md#generated-types)

## Cleanup

Generated `.db/` output is ignored by git and can be removed whenever you want fresh runtime state.

## More Docs

- [Data Files And Schemas](../../docs/data-files-and-schemas.md)
- [Package API](../../docs/package-api.md)
