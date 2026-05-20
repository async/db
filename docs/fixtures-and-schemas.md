# Fixtures And Schemas

@async/db discovers fixture and schema sources recursively under the configured fixture folder, `./db` by default.

Supported built-in source formats:

```txt
.json
.jsonc
.csv
.schema.json
.schema.jsonc
.schema.mjs
```

TypeScript schema files are intentionally not loaded directly in v1 because Node.js does not execute TypeScript without an explicit loader or build step.

## Data-First JSON Or JSONC

Use `db/users.json` or `db/users.jsonc` when you already have sample records and want @async/db to infer the collection schema.

```json
[
  {
    "id": "u_1",
    "name": "Ada Lovelace",
    "active": true
  }
]
```

Collections always get an id field. If a JSON, JSONC, or CSV collection fixture omits `id`, @async/db adds counter ids in the selected runtime store:

```json
[
  { "id": "1", "name": "Ada Lovelace" },
  { "id": "2", "name": "Grace Hopper" }
]
```

By default, source files stay unchanged and generated ids are written to the selected runtime store.

## CSV Fixtures

Use CSV when fixture data starts in a spreadsheet or export.

```txt
db/users.csv
```

```csv
id,name,email,active
u_1,Ada Lovelace,ada@example.com,true
```

`sync` parses the header row, infers a collection schema, and writes `.db/state/users.json` through the default JSON store. Source hashes are tracked so changed source fixtures refresh the selected runtime store, while unchanged source fixtures preserve runtime edits.

When a CSV is paired with a schema file, array fields stay arrays in runtime state. For example, a schema field like `"tags": { "type": "array", "items": { "type": "string" } }` accepts a CSV cell such as `renewal;priority` or a JSON array string such as `["renewal","priority"]`.

## Schema Files

Use schema files when data inference is too loose or when you need future intent that is not represented in the seed records.

```json
{
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": { "type": "string", "required": true },
    "name": { "type": "string", "required": true },
    "email": {
      "type": "string",
      "required": true,
      "unique": true,
      "pattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
      "description": "Email address used for local sign-in."
    },
    "role": {
      "type": "enum",
      "values": ["admin", "user"],
      "default": "user"
    },
    "tags": {
      "type": "array",
      "maxLength": 5,
      "items": { "type": "string" }
    },
    "score": {
      "type": "number",
      "min": 0,
      "max": 100
    },
    "schemaSnapshot": {
      "type": "object",
      "additionalProperties": true,
      "fields": {
        "version": { "type": "number" }
      }
    }
  }
}
```

Field constraints are checked during `sync`, schema validation, package API writes, REST writes, and GraphQL mutations. Use `nullable: true` when `null` is intentional. `datetime` fields validate as strings and generate TypeScript `string` types.

## JavaScript Schema Sources

Executable schema files can use `@async/db/schema` helpers:

```js
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    role: field.enum(['admin', 'user'], { default: 'user' }),
    lastViewedAt: field.datetime(),
    ownerPersonId: field.nullable(field.string()),
    tags: field.array(field.string()),
    schemaSnapshot: field.object({
      version: field.number(),
    }, { additionalProperties: true }),
  },
  seed: [],
});
```

`.schema.mjs` files execute as trusted local project JavaScript.

## Inference

Inspect inferred contracts:

```bash
npm run db -- schema infer
npm run db -- schema infer users
npm run db -- schema infer users --out db/users.schema.jsonc
```

Use inference to move from fuzzy seed data toward explicit schema. If an explicit schema already exists, inference can still show what the current data implies.

## Source Readers

@async/db reads all source files through a reader pipeline. Built-in readers handle JSON, JSONC, CSV, and schema files. Add `sources.readers` when another file format should remain the source of truth.

```js
// db.config.mjs
// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  sources: {
    readers: [
      {
        name: 'pipe-data',
        match({ file }) {
          return file.endsWith('.pipe');
        },
        async read({ readText }) {
          const rows = (await readText()).trim().split('\n');
          return {
            kind: 'data',
            resourceName: 'users',
            format: 'pipe',
            data: rows.map((row) => {
              const [id, name] = row.split('|');
              return { id, name };
            }),
          };
        },
      },
    ],
  },
});
```

Custom readers run before built-in readers. The first reader that returns a result owns the file; returning `null` lets the next reader try. One file may return multiple sources, but every returned source must include `resourceName`.

## Nested Fixture Folders

Fixtures can be grouped under `db/` without changing resource names when basenames are unique:

```txt
db/
  cms/
    pages.schema.jsonc
    pages.json
  analytics/
    charts.schema.jsonc
    charts.json
```

That layout creates `pages` and `charts` resources. If nested folders contain repeated basenames, configure naming:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  resources: {
    naming: 'folder-prefixed',
  },
});
```

Naming options:

| Option | Example path | Resource name | Use when |
| --- | --- | --- | --- |
| `basename` | `db/cms/pages.json` | `pages` | Fixture basenames are unique. |
| `folder-prefixed` | `db/cms/pages.json` | `cmsPages` | Folders are domains and repeated filenames are common. |
| `path` | `db/cms/landing/pages.json` | `cmsLandingPages` | Deep folder structure should become part of the API name. |
| `customizeResource` | `db/marketing/pages.json` | `landingPages` | Public API names must be explicit and stable. |

Resource names affect state files, REST routes, GraphQL root fields, generated TypeScript, and relation targets.

## Related Examples

- [Data-first](../examples/data-first/README.md)
- [CSV](../examples/csv/README.md)
- [Schema-first](../examples/schema-first/README.md)
- [Advanced](../examples/advanced/README.md)
