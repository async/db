# CMS JSON Publish Example

This example shows how an app can build CMS behavior on top of generic `@async/db` primitives. The CMS helper is app code, not package API.

Run it from the repository root:

```bash
npm run db -- sync --cwd ./examples/cms-json-publish
node ./examples/cms-json-publish/src/cms.mjs
```

The script:

- creates a tenant fork
- creates `draft` and `published` branches
- saves draft content in `draft`
- filters public records in app code
- writes only published records into `published`
- serves public JSON from the `published` branch

`@async/db/json` stores the branch files; the app decides what `published` means.
