# Diagnostics Example

## What This Teaches

Use this when you want to see how db reports local fixture drift. It intentionally includes schema/data mismatches so the viewer can show source diagnostics while valid resources still work.

## Files To Inspect

- [db/users.schema.jsonc](./db/users.schema.jsonc): schema-backed collection.
- [db/users.json](./db/users.json): contains an extra `twitterHandle` field.
- [db/projects.schema.jsonc](./db/projects.schema.jsonc): contains a nested field mismatch.

## Run It

From the repository root, use the repo-internal CLI path:

```bash
node ./src/cli.js sync --cwd ./examples/diagnostics
node ./src/cli.js serve --cwd ./examples/diagnostics
```

Open the viewer:

```txt
http://127.0.0.1:7331/__db
```

## Expected Result

`sync` reports warnings. The viewer surfaces diagnostics for the broken source files instead of making unrelated resources unusable.

## REST Request To Try

Leave `serve` running and run this from another terminal:

```bash
curl http://127.0.0.1:7331/users
```

Expected diagnostics include an extra `twitterHandle` field in `users.json` and an undefined nested `metadata.priority` field in `projects.schema.jsonc`.

## Cleanup

Generated `.db/` output is ignored by git and can be removed whenever you want a fresh mirror.

## More Docs

- [Concepts](../../docs/concepts.md)
- [Fixtures And Schemas](../../docs/fixtures-and-schemas.md)
