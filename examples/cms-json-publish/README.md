# CMS JSON Publish Example

## What This Teaches

Use this when an app needs CMS draft/publish behavior on top of generic `@async/db` primitives. The CMS helper is app code, not package API: branches store draft and published content, and the app decides what "published" means.

## Run It

Run it from the repository root:

```bash
npm run db -- sync --cwd ./examples/cms-json-publish
node ./examples/cms-json-publish/src/cms.js
```

The script:

- creates a tenant fork
- creates `draft` and `published` branches
- saves draft content in `draft`
- filters public records in app code
- writes only published records into `published`
- serves public JSON from the `published` branch

`@async/db/json` stores the branch files; the app decides what `published` means.
