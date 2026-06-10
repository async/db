# Generated Files

Sync writes runtime metadata and state under `.db/`. Commit generated contracts only when the app imports them. That directory usually stays uncommitted. Configured generated types, manifests, and operation refs can be committed when they are part of the application contract.

## Output policy

| Output | Path | Commit? |
| --- | --- | --- |
| Runtime state | `.db/state/*.json` | No, unless a task explicitly asks for runtime state. |
| Generated types | `outputs.committedTypes` | Yes, when TypeScript imports need a fresh-checkout contract. |
| Schema manifest | `outputs.schemaManifest` | Yes, when a local UI imports field metadata. |
| Viewer manifest | `outputs.viewerManifest` | Yes, when a custom data explorer imports route and capability metadata. |
| Operation refs | `outputs.operationRefs` | Yes, when client code imports approved callable refs. |
| Operation registry | `outputs.operationRegistry` | Server-side only. Do not ship full templates to browser code. |

## Generated contract config

```js
export default defineConfig({
  outputs: {
    committedTypes: './src/generated/db.types.d.ts',
    schemaManifest: './src/generated/db.schema.json',
    operationRefs: './src/generated/db.operation-refs.json',
  },
});
```

## Examples that commit contracts

`basic`, `advanced`, `production-json`, `schema-manifest`, `schema-ui`, `computed-fields`, and `content-collections` commit generated types or manifests when the example imports them.

See [Generated Files](../generated-files.md) in the main guide for the full output map.
