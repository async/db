# Generated Files

@async/db writes generated output during `sync`, `serve`, package API startup, and some smoke commands. Know which files are runtime state and which files are intentionally committed.

## Default Generated Output

Default sync output:

```txt
.db/schema.generated.json
.db/types/index.ts
.db/state/*.json
```

`.db/` is normally uncommitted. It contains generated schema metadata, generated TypeScript types, source metadata, and writable runtime store state.

## Runtime State

With the default JSON store:

```txt
db/users.json              source fixture
.db/state/users.json   writable runtime JSON store
```

REST writes, GraphQL mutations, package API writes, and viewer operations write to runtime state. Changed source fixtures refresh state based on source hashes; unchanged source fixtures preserve runtime edits.

## Generated Ids

Collections need ids. If a JSON, JSONC, or CSV collection fixture omits `id`, @async/db adds counter ids in the selected runtime store.

Source fixtures stay unchanged by default. For resources bound to the `sourceFile` store, @async/db may write generated ids back to plain `.json` collection fixtures when configured intentionally.

## Generated Types

Default generated TypeScript output:

```txt
.db/types/index.ts
```

Use `types.commitOutFile` when TypeScript imports should work before anyone runs sync:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  types: {
    commitOutFile: './src/generated/db.types.ts',
  },
});
```

Field descriptions become TypeScript JSDoc:

```ts
export type User = {
  /** Stable user id. */
  id: string;

  /** Email address used for local sign-in. */
  email: string;
};
```

Selected examples intentionally commit generated type output:

```txt
examples/advanced/src/generated/db.types.ts
examples/basic/src/generated/db.types.ts
examples/schema-first/src/generated/db.types.ts
examples/schema-manifest/src/generated/db.types.ts
examples/schema-ui/src/generated/db.types.ts
```

## Schema Manifest Output

Use `schemaOutFile` when a local admin, CMS, or form-building UI needs runtime schema metadata:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  schemaOutFile: './src/generated/db.schema.json',
});
```

`async-db sync` writes the manifest when `schemaOutFile` is set. You can also generate it directly:

```bash
npm run db -- schema manifest --out ./src/generated/db.schema.json
```

The manifest includes normalized resource and field metadata such as `type`, `required`, `nullable`, `default`, `values`, nested `fields`, array `items`, relations, and generated UI defaults. The manifest file is metadata output only. Schema field defaults still drive configured runtime behavior such as create-time defaults and safe additive store hydration.

The manifests at [examples/schema-manifest/src/generated/db.schema.json](../examples/schema-manifest/src/generated/db.schema.json) and [examples/schema-ui/src/generated/db.schema.json](../examples/schema-ui/src/generated/db.schema.json) are intentionally committed.

## Viewer Manifest Output

Use `viewerManifestOutFile` when a custom data viewer needs the same JSON metadata used by the built-in viewer:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  viewerManifestOutFile: './src/generated/db.viewer.json',
});
```

`async-db sync` writes the viewer manifest when `viewerManifestOutFile` is set. You can also generate it directly:

```bash
npm run db -- viewer manifest --out ./src/generated/db.viewer.json
```

The viewer manifest includes field metadata, UI hints, relation hints, diagnostics, capabilities, configured viewer links, and API links such as `/__db/manifest`, `/__db/manifest.json`, `/__db/manifest.html`, `/__db/manifest.md`, `/__db/batch`, `/graphql`, and scoped REST resource routes under `/__db/rest`. It does not include seed records, source paths, source hashes, runtime state paths, or GraphQL SDL. Fetch actual records from REST or GraphQL.

## Cleanup Rules

- Do not commit `.db/` unless a task explicitly asks for generated runtime state.
- Do commit configured `types.commitOutFile` output when an app needs stable imports in a fresh checkout.
- Do commit configured `schemaOutFile` output when an app needs stable schema metadata at runtime.
- Do commit configured `viewerManifestOutFile` output when a custom viewer needs stable metadata and route links at runtime.
- Smoke commands against examples may create `examples/*/.db/`; remove that generated runtime output before finalizing.

## Related Examples

- [Basic](../examples/basic/README.md)
- [Schema Manifest](../examples/schema-manifest/README.md)
