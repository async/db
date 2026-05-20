# Schema UI Example

## What This Teaches

Use this when you want to see how committed schema JSON can drive a tiny admin or CMS UI. It reads `src/generated/jsondb.schema.json` and maps each field's `ui.component` to simple view and editor HTML.

The demo composes **SSR CMS routes ahead of the stock jsondb handler**, so the same port serves **`/` SSR**, **`/__jsondb`**, REST, and GraphQL.

## Files To Inspect

- [db/pages.schema.jsonc](./db/pages.schema.jsonc): CMS page schema with enum, relation, summary, and markdown body fields.
- [db/users.schema.jsonc](./db/users.schema.jsonc): author records used by the relation picker metadata.
- [jsondb.config.mjs](./jsondb.config.mjs): writes the schema manifest and customizes CMS UI hints.
- [src/render-admin.mjs](./src/render-admin.mjs): static string-template preview (`/templates`) and CLI output for scaffolding comparisons.
- [src/cms-ssr.mjs](./src/cms-ssr.mjs): SSR view/editor snippets filled with real record values and resolved relations.
- [src/schema-ui-ssr-handler.mjs](./src/schema-ui-ssr-handler.mjs): SSR routing layer (middleware-style); hands off other paths to jsondb.
- [src/start-schema-ui-server.mjs](./src/start-schema-ui-server.mjs): wires SSR handler + `createJsonDbRequestHandler` + file watching.
- [serve.mjs](./serve.mjs): CLI entry; same stack as the examples launcher hook.
- [serve-example.mjs](./serve-example.mjs): **`npm run examples`** hook — exports `startExampleServer` so `scripts/example-launcher.js` can mount this example without hard-coding it.
- [src/generated/jsondb.schema.json](./src/generated/jsondb.schema.json): committed manifest input after sync.

## Run It

From the repository root:

```bash
node ./examples/schema-ui/serve.mjs
```

Open **http://127.0.0.1:7342/** — CMS home with links into each collection. The built-in viewer is **http://127.0.0.1:7342/__jsondb**.

### From the repo examples index

```bash
npm run examples
```

Pick **Schema UI** on the index page; it uses **`serve-example.mjs`** automatically (see `scripts/example-launcher.js`).

Routes:

| Path | Purpose |
| --- | --- |
| `/` | Home: collections and record counts |
| `/cms/pages` | List pages from the mirror |
| `/cms/pages/page_home` | SSR detail: resolved author link, markdown body text, filled editor controls |
| `/templates` | Static component templates only (no database rows), matching the CLI renderer |
| `/__jsondb`, `/graphql`, `/pages`, … | Stock jsondb viewer, GraphQL, and REST on the same origin |

URLs are printed when the server starts.

Options:

```bash
node ./examples/schema-ui/serve.mjs --port 8080 --host 127.0.0.1
node ./examples/schema-ui/serve.mjs --no-sync
```

`--no-sync` skips fixture sync on startup (faster restart). Use it only after you have already synced once so `.jsondb/state` exists.

### Print Static Templates To A File

```bash
node ./src/cli.js sync --cwd ./examples/schema-ui
node ./examples/schema-ui/src/render-admin.mjs > /tmp/jsondb-schema-ui.html
```

## Expected Result

SSR pages show **live field values**: titles, markdown bodies escaped into `<article>`, relation links to `/cms/users/:id`, radios reflecting enum status, and selects populated from related rows.

The standalone **`render-admin.mjs`** output still demonstrates placeholder-driven templates for comparison.

## REST Request To Try

With **`serve.mjs`** or **`npm run examples`** (same stack), REST is already on the demo port:

```bash
curl 'http://127.0.0.1:7342/pages?expand=author&select=id,title,status,author.name'
```

Or run the CLI server alone:

```bash
node ./src/cli.js serve --cwd ./examples/schema-ui
curl 'http://127.0.0.1:7331/pages?expand=author&select=id,title,status,author.name'
```

## Cleanup

Generated `.jsondb/` output is ignored by git. The files under `src/generated/` are intentionally committed for this example.

## More Docs

- [Generated Files](../../docs/generated-files.md)
- [Configuration](../../docs/configuration.md)
