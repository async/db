# Data-First Example

## What This Teaches

Use this when you have fixture data before you have a contract. db infers collections, singleton documents, REST routes, GraphQL fields, and TypeScript types from plain JSON.

## Files To Inspect

- [db/users.json](./db/users.json): collection inferred from an array.
- [db/posts.json](./db/posts.json): second inferred collection.
- [db/settings.json](./db/settings.json): singleton document inferred from an object.

## Run It

From the repository root, use the repo-internal CLI path:

```bash
node ./src/cli.js sync --cwd ./examples/data-first
node ./src/cli.js serve --cwd ./examples/data-first
```

Open the viewer:

```txt
http://127.0.0.1:7331/__db
```

## Expected Result

`sync` infers schema and writes generated runtime state under `examples/data-first/.db/`.

## REST Request To Try

Leave `serve` running and run this from another terminal:

```bash
curl 'http://127.0.0.1:7331/users?select=id,name,email'
```

## Cleanup

Generated `.db/` output is ignored by git and can be removed whenever you want a fresh mirror.

## More Docs

- [Concepts](../../docs/concepts.md)
- [Fixtures And Schemas](../../docs/fixtures-and-schemas.md)
