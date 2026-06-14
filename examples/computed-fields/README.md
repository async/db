# Computed Fields Example

## What This Teaches

Use this when you want to see several ways to model computed fields with `.schema.js`. Computed fields are read-only projections: stored data records stay small, and REST or GraphQL resolves the computed value only when a client selects it.

## Files To Inspect

- [db/users.schema.js](./db/users.schema.js): `field.computed(type, function)` shorthand using `this.value`.
- [db/posts.schema.js](./db/posts.schema.js): object form with `resolveMany` for reading time.
- [db/products.schema.js](./db/products.schema.js): arrow resolver for simple price formatting.
- [db/orders.schema.js](./db/orders.schema.js): normal function resolver that uses `this.get('db')` to read product prices.
- [src/generated/db.types.d.ts](./src/generated/db.types.d.ts): committed generated types where computed fields are optional read-only projections.

## Run It

From the repository root:

```bash
pnpm run db -- sync --cwd ./examples/computed-fields
pnpm run db -- serve --cwd ./examples/computed-fields
```

Open the local data explorer:

```txt
http://127.0.0.1:7331/__db
```

## REST Requests To Try

Default reads return stored fields only:

```bash
curl http://127.0.0.1:7331/db/orders.json
```

Select computed fields when you need them:

```bash
curl 'http://127.0.0.1:7331/db/users.json?select=id,fullName'
curl 'http://127.0.0.1:7331/db/posts.json?select=id,title,readingTimeMinutes'
curl 'http://127.0.0.1:7331/db/products.json?select=id,name,priceLabel'
curl 'http://127.0.0.1:7331/db/orders.json?select=id,itemCount,totalCents,receiptLine'
```

## GraphQL Query To Try

```graphql
{
  users {
    id
    fullName
  }
  products {
    id
    priceLabel
  }
  orders {
    id
    itemCount
    totalCents
    receiptLine
  }
}
```

## Why This Shape?

Each model shows a different computed-field use case:

- `users.fullName` combines stored fields from `this.value` for display.
- `posts.readingTimeMinutes` uses `resolveMany` so a collection page can be computed in one batch.
- `products.priceLabel` formats raw `priceCents` without changing the stored number.
- `orders.totalCents` and `orders.receiptLine` use normal resolver functions so the delegated resolver context can read related product prices with `this.get('db')`.

Normal function resolvers can read internal runtime values such as `db`, `value`,
`record`, `fieldName`, and `services` with `this.get(name)`. App code can pass a
context object to `schema.resolver(...)` to override or add values; `this._internal`
keeps the original internal view available when a resolver needs it.

Computed fields are useful for values that are cheap to derive, read-only, and easier to keep out of source data files. They should not replace stored data that users need to edit directly.

## Features To Notice

- [Computed fields](../../docs/data-files-and-schemas.md#computed-fields)
- [JavaScript schema sources](../../docs/data-files-and-schemas.md#javascript-schema-sources)
- [File-backed `.json` REST routes](../../docs/server-and-viewer.md#fixture-like-json-routes)
- [Generated types](../../docs/generated-files.md#generated-types)

## Cleanup

Generated `.db/` output is ignored by git and can be removed whenever you want fresh runtime state.
