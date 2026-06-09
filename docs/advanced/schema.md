# Schema Contracts

JSON data files can prove field names, primitive types, arrays, nested objects, and enum-like values. Explicit schema is the upgrade path for descriptions, defaults, constraints, relations, UI hints, and stricter validation.

## Three modes

| Mode | When to use |
| --- | --- |
| **data-first** | Start with JSON data files while the resource shape is still forming. |
| **explicit** | Add `.schema.json` or `.schema.js` when inference cannot prove intent. |
| **strictness** | Keep `unknownFields: "warn"` during discovery. Switch to `"error"` when drift should block. |

## Explicit schema adds intent

```json
{
  "name": "users",
  "type": "collection",
  "fields": {
    "id": { "type": "string", "required": true },
    "email": {
      "type": "string",
      "description": "Email address used for local sign-in."
    },
    "role": {
      "type": "string",
      "values": ["admin", "member"],
      "default": "member"
    }
  }
}
```

## The same contract feeds tools

- Generated TypeScript uses field descriptions as JSDoc.
- GraphQL SDL can expose the same resource metadata when GraphQL is enabled in config.
- Viewer manifests can drive forms, table columns, and relation hints.
- Defaults apply on create and safe additive store hydration unless disabled.

> [!NOTE]
> GraphQL and Falcor HTTP endpoints are opt-in. Enable them in `db.config.js` when the local workflow needs those routes.

See [Data Files And Schemas](../data-files-and-schemas.md) for the full authoring guide.
