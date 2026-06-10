# Hono Auth Example

## What This Teaches

Use this when your app already has a Hono server and you want db to own the CRUD routes while your app owns auth, permissions, and write normalization.

## Files To Inspect

- [src/app.js](./src/app.js): registers db REST routes with `beforeRequest`, `beforeWrite`, and a pages-specific create hook.
- [src/server.js](./src/server.js): starts the Hono app locally.
- [db/pages.schema.jsonc](./db/pages.schema.jsonc): schema-backed page collection with timestamps set by hooks.
- [db/users.schema.jsonc](./db/users.schema.jsonc): demo users used by the bearer-token sessions.

## Run It

From this example directory:

```bash
npm install
npm run sync
npm run dev
```

## Requests To Try

Leave `npm run dev` running and run these from another terminal.

Missing tokens are rejected:

```bash
curl -i 'http://127.0.0.1:8787/api/pages'
```

Reader tokens can read:

```bash
curl -H 'Authorization: Bearer user-token' 'http://127.0.0.1:8787/api/pages'
```

Reader tokens cannot write:

```bash
curl -i -X PATCH 'http://127.0.0.1:8787/api/pages/home' \
  -H 'Authorization: Bearer user-token' \
  -H 'content-type: application/json' \
  -d '{"title":"Draft"}'
```

Admin tokens can write. The shared write hook trims strings and sets `updatedAt`:

```bash
curl -X PATCH 'http://127.0.0.1:8787/api/pages/home' \
  -H 'Authorization: Bearer admin-token' \
  -H 'content-type: application/json' \
  -d '{"title":"  Homepage  "}'
```

## Token Map

- `Bearer admin-token`: read and write.
- `Bearer user-token`: read only.

This is intentionally tiny demo auth. In a real app, `beforeRequest` would read your session or token source, and `beforeWrite` would call your permission policy.

## Features To Notice

- [Hono route registration](../../docs/integrations.md#hono-route-registration)
- [Lifecycle hooks](../../docs/integrations.md#hono-route-registration)
- [Schema-backed data files](../../docs/data-files-and-schemas.md#add-schema-when-inference-is-not-enough)

## More Docs

- [Integrations](../../docs/integrations.md)
- [Server And Local Data Explorer](../../docs/server-and-viewer.md)
