# Advanced Example

## What This Teaches

Use this after the basics when you want to see several features working together: mixed-mode fixtures, `.schema.mjs`, defaults, nested objects, and committed generated types.

## Files To Inspect

- [db/users.schema.mjs](./db/users.schema.mjs): schema helper API from `@async/db/schema`.
- [db/users.json](./db/users.json): data seed for the schema-backed `users` collection.
- [db/projects.schema.jsonc](./db/projects.schema.jsonc): nested object defaults.
- [src/generated/db.types.ts](./src/generated/db.types.ts): committed generated types.

## Run It

From the repository root, use the repo-internal CLI path:

```bash
node ./src/cli.js sync --cwd ./examples/advanced
node ./src/cli.js serve --cwd ./examples/advanced
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
curl 'http://127.0.0.1:7331/projects?select=id,name,status,metadata'
```

## Cleanup

Generated `.db/` output is ignored by git and can be removed whenever you want fresh runtime state.

## More Docs

- [Fixtures And Schemas](../../docs/fixtures-and-schemas.md)
- [Package API](../../docs/package-api.md)
