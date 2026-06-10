# Server Routes

Use REST as the local app contract and keep dev tools on their own route base. The server starts from data-backed resources, exposes readable REST routes, supports local writes, and keeps the local data explorer, schema, manifest, import, batch, log, and operation routes explicit. Optional GraphQL is available when enabled in config. File-like suffixes such as `.json` and `.md` choose response formats for the same shaped data.

| Route base | Purpose |
| --- | --- |
| `/db/*` | App-facing REST alias for file-like reads and writes. |
| `/__db/*` | Local data explorer, schema, manifest, import, batch, logs, events, and scoped REST. |
| `/graphql` | Optional GraphQL route for local queries and mutations when enabled. |

## Route families

Defaults shown for `127.0.0.1:7331`.

| Route | Method | Use |
| --- | --- | --- |
| `/__db` | GET | Built-in local data explorer shell. |
| `/__db/schema` | GET | Normalized schema metadata. |
| `/__db/manifest[.json\|.html\|.md]` | GET | Viewer/API manifest in negotiated or explicit format. |
| `/__db/events` | GET | Live event stream for explorer refreshes. |
| `/__db/log` | GET | Runtime log and request trace output. |
| `/__db/import` | POST | CSV import endpoint used by the explorer. |
| `/__db/batch` | POST | Sequential REST batch execution. |
| `/__db/rest/*` | GET, POST, PATCH, PUT, DELETE | Scoped REST when the app data alias is disabled or not desired. |
| `/db/*` | GET, POST, PATCH, PUT, DELETE | App-facing REST alias controlled by `server.dataPath`. |
| `/graphql` | POST | GraphQL subset endpoint when GraphQL is enabled. |
| `/__db/operations/:ref` | POST | Allowlisted registered operation execution. |

## Resource CRUD endpoints

| Method | Path | Use |
| --- | --- | --- |
| GET | `/db/users.json` | List the collection. |
| GET | `/db/users/u_1.json` | Read one record by id. |
| POST | `/db/users` | Create a record with a JSON body. |
| PATCH | `/db/users/u_1` | Merge fields into an existing record. |
| DELETE | `/db/users/u_1` | Delete one record. |

## Singleton endpoints

| Method | Path | Use |
| --- | --- | --- |
| GET | `/db/settings.json` | Read the document. |
| GET | `/db/settings.md` | Render the same data as Markdown. |
| GET | `/db/settings.html` | Render a browser-readable view. |
| PUT | `/db/settings` | Replace the document. |
| PATCH | `/db/settings` | Merge fields into the document. |

## What a suffix means on a REST route

- **It selects an output format** — Adding `.json`, `.md`, `.html`, or a registered custom extension to a `GET` route renders the same resource after REST shaping. It does not fetch a different source file.
- **Query shaping happens first** — `select`, `expand`, `offset`, and `limit` run before the renderer. `/db/users.md?select=id,name` is Markdown for the selected fields.
- **Extensionless reads negotiate** — `GET /db/users` uses the configured default or a registered `Accept` media type.
- **Writes stay extensionless** — Use `POST /db/users`, `PATCH /db/users/u_1`, `PUT /db/settings`, and `PATCH /db/settings` for JSON request bodies.

> [!NOTE]
> Source file extensions and REST response extensions are separate. Built-in source readers load `db/*.json`. Built-in response formats are `.json`, `.html`, and `.md`. Add source formats through `sources.readers`; add REST response formats through `rest.formats`. See [Data Files And Schemas](../data-files-and-schemas.md) for additional built-in data formats.

## REST examples

```bash
curl http://127.0.0.1:7331/db/users.json
curl 'http://127.0.0.1:7331/db/users.json?select=id,name&offset=0&limit=20'
curl http://127.0.0.1:7331/db/users/u_1.json
curl http://127.0.0.1:7331/db/users/u_1.md
curl http://127.0.0.1:7331/db/settings.html

curl -X POST http://127.0.0.1:7331/db/users \
  -H 'content-type: application/json' \
  -d '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
```

## Batch and scoped REST

```bash
curl http://127.0.0.1:7331/__db/rest/users.json

curl -X POST http://127.0.0.1:7331/__db/batch \
  -H 'content-type: application/json' \
  -d '[
    { "method": "GET", "path": "/db/users.json" },
    { "method": "PATCH", "path": "/db/settings", "body": { "theme": "dark" } }
  ]'
```

## Move and lock down routes deliberately

```js
export default defineConfig({
  server: {
    apiBase: '/__db',
    dataPath: '/db',
    host: '127.0.0.1',
    port: 7331,
  },
});
```

```js
export default defineConfig({
  server: {
    expose: {
      rest: 'registered-only',
      graphql: false,
      viewer: 'dev',
      schema: 'dev',
      manifest: 'dev',
    },
  },
});
```

Set `server.dataPath: false` when an app should not receive the `/db` alias. The same REST resources remain available under `/__db/rest` for local tools.

See [Server And Local Data Explorer](../server-and-viewer.md) for the full route reference.
