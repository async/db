# CSV Example

## What This Teaches

Use this when product, customer, or spreadsheet-like data starts as CSV. jsondb scans the header row, infers field shapes, generates types, and mirrors the rows into JSON runtime state.

## Files To Inspect

- [db/customers.csv](./db/customers.csv): source CSV fixture.
- [jsondb.config.mjs](./jsondb.config.mjs): default mirror setup using `defineConfig`.

## Run It

From the repository root, use the repo-internal CLI path:

```bash
node ./src/cli.js sync --cwd ./examples/csv
node ./src/cli.js serve --cwd ./examples/csv
```

Open the viewer:

```txt
http://127.0.0.1:7331/__jsondb
```

## Expected Result

`sync` writes `.jsondb/state/customers.json`. When `db/customers.csv` changes, the source hash changes and the JSON store refreshes from CSV.

## REST Request To Try

Leave `serve` running and run this from another terminal:

```bash
curl 'http://127.0.0.1:7331/customers?select=id,name,email'
```

## Cleanup

Generated `.jsondb/` output is ignored by git and can be removed whenever you want fresh runtime state.

## More Docs

- [Fixtures And Schemas](../../docs/fixtures-and-schemas.md)
- [Generated Files](../../docs/generated-files.md)
