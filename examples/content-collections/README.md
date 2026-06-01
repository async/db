# Content Collections Example

## What This Teaches

Use this when you want a dependency-free version of the content collection pattern: docs and blog posts live as MDX files, `index.schema.mjs` files describe the record shape, and async-db exposes the content through generated types, REST, GraphQL, and the local viewer.

This example does not install `content-collections`, a frontmatter package, or an MDX compiler. Core reads simple scalar frontmatter plus the raw MDX body. The app-owned preview script shows where rendering or richer parsing belongs.

## Files To Inspect

- [db/docs/index.schema.mjs](./db/docs/index.schema.mjs): docs collection marker using `source: files(..., { read })`.
- [db/blog/index.schema.mjs](./db/blog/index.schema.mjs): blog collection with file sources, relations, and computed fields.
- [db.config.mjs](./db.config.mjs): config-owned `static` store selection for docs and blog.
- [db/blog/launch-notes.mdx](./db/blog/launch-notes.mdx): frontmatter plus raw MDX body.
- [db/authors.json](./db/authors.json): normal writable fixture records used by blog relations.
- [db/site.schema.jsonc](./db/site.schema.jsonc): embedded document seed for aggregate bundle seed splitting.
- [src/content-preview.mjs](./src/content-preview.mjs): dependency-free app-owned preview renderer.

## Run It

From the repository root, use the repo-internal CLI path:

```bash
npm run db -- sync --cwd ./examples/content-collections
npm run db -- serve --cwd ./examples/content-collections
```

Open the viewer:

```txt
http://127.0.0.1:7331/__db
```

Render the local preview:

```bash
node ./examples/content-collections/src/content-preview.mjs
```

## Expected Result

`sync` loads `authors`, `blog`, `docs`, and `site`. The docs and blog collections are static because `db.config.mjs` assigns those resources to the static store. The authors fixture stays writable in the runtime store.

## REST And GraphQL Requests To Try

Leave `serve` running and run these from another terminal:

```bash
curl http://127.0.0.1:7331/db/docs.json
curl 'http://127.0.0.1:7331/db/blog.json?select=id,title,permalink,readingTimeMinutes'
```

GraphQL selections use the same computed fields:

```graphql
{
  blog {
    id
    title
    permalink
    readingTimeMinutes
  }
}
```

## Bundle The Schemas

Aggregate bundle writes a root schema registry and keeps seed data out of that root file:

```bash
npm run db -- schema bundle --all --cwd ./examples/content-collections --out db.schema.mjs
```

Because `db/site.schema.jsonc` has embedded seed and no `db/site.json`, the command first writes `db/site.json`, then writes `db.schema.mjs`. Folder collection source globs are rebased so the root file points back to `files('./db/docs/**/*.mdx', { read: 'frontmatter' })` and `files('./db/blog/**/*.mdx', { read: 'frontmatter' })`.

## Why This Shape?

Docs and blog posts are static content, so their source of truth is the MDX file. Authors are normal fixture data because an app may create or edit them during local development. The relation from `blog.authorId` to `authors.id` keeps the content file small while still letting REST and GraphQL expand author data.

`tags` is a comma-separated scalar string on purpose. The built-in frontmatter parser is lightweight and dependency-free; if your app needs arrays, nested frontmatter, or full MDX compilation, keep that parser or compiler in app code like [src/content-preview.mjs](./src/content-preview.mjs).

## Features To Notice

- [Folder content collections](../../docs/fixtures-and-schemas.md#folder-content-collections)
- [Computed fields](../../docs/fixtures-and-schemas.md#computed-fields)
- [Bundle and unbundle](../../docs/fixtures-and-schemas.md#bundle-and-unbundle)
- [Fixture-like `.json` REST routes](../../docs/server-and-viewer.md#fixture-like-json-routes)

## Cleanup

Generated `.db/` output is ignored by git and can be removed whenever you want fresh runtime state. If you run the aggregate bundle command in this example folder, it intentionally creates `db.schema.mjs` and `db/site.json`; remove those files when you want to return to the per-resource authoring shape.
