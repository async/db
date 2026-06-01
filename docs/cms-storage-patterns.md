# CMS Storage Patterns

CMS workflows are app code on top of `@async/db` primitives. The package should not know what `draft`, `review`, `published`, or `unpublished` mean.

## App Code Boundary

```js
export function createCms(db, { tenantId }) {
  return {
    saveDraft(pageId, changes) {
      const tenant = db.fork(tenantId);
      return tenant.branch('draft').collection('pages').patch(pageId, {
        ...changes,
        status: 'draft',
      });
    },

    async publish() {
      const tenant = db.fork(tenantId);
      const draft = tenant.branch('draft');
      const published = tenant.branch('published');
      const pages = await draft.collection('pages').all();

      await published.collection('pages').replaceAll(
        pages
          .filter((page) => page.status === 'published')
          .map(({ id, slug, title, status, summary, bodyMarkdown }) => ({
            id,
            slug,
            title,
            status,
            summary,
            bodyMarkdown,
          })),
      );
    },
  };
}
```

`@async/db` owns forks, branches, snapshots, resources, operations, migrations, and routing. `@async/db/json` owns file/object storage, durability, encryption hooks, corruption checks, and layout.

## Pattern 1: One JSON File Per Resource

Use this for simple content:

```txt
forks/tenant_acme/branches/draft/resources/pages.json
forks/tenant_acme/branches/published/resources/pages.json
```

The app filters draft records and writes the public result into the `published` branch.

## Pattern 2: App-Owned Static JSON Outputs

When static hosting, S3/R2 reads, or page-level cache invalidation matter, keep that materialization in app code instead of configuring the JSON store layout:

```js
const published = await db.fork(tenantId).branch('published').collection('pages').all();

for (const page of published) {
  await writePublicJson(`pages/${page.slug}.json`, page);
}
```

The package owns resource reads/writes and branch isolation. The app owns any extra files it wants to publish for CDN or public API access.

## Pattern 3: JSON Files With SQLite Metadata Index

Use JSON files as documents and SQLite as an app-owned metadata index:

```txt
content/pages/home.json
content/pages/about.json
content-index.sqlite
```

The app writes the JSON document and updates SQLite metadata such as `slug`, `status`, `published_at`, and `file_path`. Queries use SQLite to find files, then read JSON documents.

## Pattern 4: Draft JSON To Published Postgres

Keep editorial drafts as JSON, then materialize published records into Postgres:

```js
await cms.publish({
  from: { branch: 'draft', store: 'json' },
  to: { branch: 'published', store: 'postgres' },
});
```

This is useful when the public site needs database indexes but editorial workflow still benefits from file-like JSON.

## Pattern 5: Static JSON API Materialization

Publishing can write multiple public JSON outputs:

```txt
published/pages.json
published/pages/home.json
published/navigation.json
published/search-index.json
published/sitemap.json
```

That materialization is app-owned. The package provides resource reads/writes, branches, snapshots, and JSON storage helpers.
