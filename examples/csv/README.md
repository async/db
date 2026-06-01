# CSV Example

## What This Teaches

Use this when product, customer, or spreadsheet-like data starts as CSV. db scans the header row, infers field shapes, generates types, and mirrors the rows into JSON runtime state.

## Files To Inspect

- [db/customers.csv](./db/customers.csv): source CSV fixture.
- [db.config.mjs](./db.config.mjs): default mirror setup using `defineConfig`.

## Run It

From the repository root, use the repo-internal CLI path:

```bash
npm run db -- sync --cwd ./examples/csv
npm run db -- serve --cwd ./examples/csv
```

Open the viewer:

```txt
http://127.0.0.1:7331/__db
```

## Expected Result

`sync` writes `.db/state/customers.json`. When `db/customers.csv` changes, the source hash changes and the JSON store refreshes from CSV.

## REST Request To Try

Leave `serve` running and run this from another terminal:

```bash
curl 'http://127.0.0.1:7331/db/customers.json?select=id,name,email'
```

## Features To Notice

- [CSV fixtures](../../docs/fixtures-and-schemas.md#csv-fixtures)
- [Runtime state refreshes](../../docs/generated-files.md#runtime-state)
- [Fixture-like `.json` REST routes](../../docs/server-and-viewer.md#fixture-like-json-routes)

## Cleanup

Generated `.db/` output is ignored by git and can be removed whenever you want fresh runtime state.

## More Docs

- [Fixtures And Schemas](../../docs/fixtures-and-schemas.md)
- [Generated Files](../../docs/generated-files.md)
