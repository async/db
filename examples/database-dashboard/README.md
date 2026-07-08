# Database Dashboard Example

## What This Teaches

This example shows the dashboard shape people expect from a local database tool:
an explorer sidebar, connection status, schema-backed table list, SQL-style
presets, a data grid, example dataset summaries, notes, and a selected-record
inspector. It uses the local `@async/db` runtime as the source of truth and
keeps optional extension surfaces out of the example.

The seeded records are example data for this project only. They are not copied
into the built-in viewer rendered by `renderDbViewer()`.

## Files To Inspect

- [db/orders.schema.jsonc](./db/orders.schema.jsonc): order collection with
  customer and product relations.
- [db/users.schema.jsonc](./db/users.schema.jsonc): customer collection.
- [db/products.schema.jsonc](./db/products.schema.jsonc): product collection.
- [src/index.html](./src/index.html): dark database-client app shell.
- [src/app.js](./src/app.js): table switching, filters, query presets, example
  notes, and inspector state.
- [server/runtime.js](./server/runtime.js): custom example runtime mounted ahead
  of the built-in `@async/db` REST and viewer routes.

## Run It

From the repository root:

```bash
pnpm run examples
```

Open the examples directory and choose **Database Dashboard**. The demo route
opens the dashboard, while the built-in viewer link opens the normal `@async/db`
viewer for the same resources.

## Expected Result

The dashboard opens on the `orders` collection with seeded example rows,
example dataset summaries, SQL presets, and a right-side inspector. Switching
tables reads from the same synced runtime mirror used by the REST routes and
built-in viewer.

## Try It

- Filter rows from the explorer search field.
- Switch between `orders`, `users`, and `products`.
- Click a row to update the inspector.
- Use a SQL preset and click **Run** to show the matching result view.
- Open the built-in viewer to compare the same local resources.

## Cleanup

Generated `.db/` output is ignored by git and can be removed whenever you want a
fresh runtime mirror.
