# Fixtures And Schemas

@async/db discovers fixture and schema sources recursively under the configured fixture folder, `./db` by default.

Supported built-in source formats:

```txt
.json
.jsonc
.csv
.schema.json
.schema.jsonc
.schema.js
db.schema.js
index.schema.js
```

`.schema.js` and `db.schema.js` use normal Node.js ESM rules. If the project root `package.json` is already `"type": "module"`, no extra marker is needed. If the root is not ESM, @async/db creates `db/package.json` with `"type": "module"` before loading `.schema.js` files inside the configured fixture folder. Set `schema.autoModulePackageJson: false` to manage that file yourself.

TypeScript schema files are intentionally not loaded directly in v1 because Node.js does not execute TypeScript without an explicit loader or build step. See [TypeScript Schema Sources](./typescript-schema-sources.md) for the supported compile-to-JavaScript workflow.

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

`.schema.js` files execute as trusted local project JavaScript. If the root package is not ESM, @async/db creates the fixture-folder package marker described at the top of this guide.

## Standard Schema Validators

Executable schema modules can also use any object that implements the Standard Schema
v1 contract. @async/db imports your trusted schema module, recognizes
`value['~standard'].version === 1`, and calls
`value['~standard'].validate(...)` during schema helpers and runtime writes.
The core package does not bundle a validator-library dependency. That means
Zod, Valibot, ArkType, or a local validator can own parsing and validation
while Async DB still applies its own lightweight metadata checks for defaults,
read-only/computed fields, uniqueness, relations, generated metadata, REST, and
GraphQL.

```js
import { collection, field } from '@async/db/schema';

const UserSchema = {
  '~standard': {
    version: 1,
    vendor: 'my-validator',
    async validate(value) {
      if (!value || typeof value !== 'object' || typeof value.email !== 'string') {
        return { issues: [{ message: 'Email is required', path: ['email'] }] };
      }
      return {
        value: {
          ...value,
          email: value.email.trim().toLowerCase(),
        },
      };
    },
    jsonSchema: {
      output() {
        return {
          type: 'object',
          required: ['email'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
          },
        };
      },
    },
  },
};

export default collection({
  idField: 'id',
  validator: UserSchema,
  fields: {
    email: field.string({
      required: true,
      unique: true,
      description: 'Normalized login email.',
    }),
    displayName: field.computed(field.string(), ({ record }) => record.email),
  },
  seed: [],
});
```

That object-first form keeps Async DB's simplified schema as the main shape and
mixes Standard Schema in as the parser/validator through `validator`. The equivalent
validator-first shorthand is useful when the external validator owns the field
shape:

```js
export default collection(UserSchema, {
  fields: {
    email: field.meta({ unique: true }),
    displayName: field.computed(field.string(), ({ record }) => record.email),
  },
});
```

Set `schema.standardSchema: true` in `db.config.js` when generated
executable schema files should prefer that validator-first form for resources that
have a Standard Schema validator. Detection still works without the config flag;
the flag only changes generated authoring output.

If the validator exposes a Standard JSON Schema converter, @async/db uses that
for generated field metadata and TypeScript output. `field.meta(...)` overlays
Async DB metadata such as descriptions, defaults, uniqueness, relations,
constraints, and manifest hints. `field.computed(...)` remains the resolver
entrypoint.

Package API, REST, and GraphQL writes await async Standard Schema validators and
store the returned `value`. Synchronous helpers such as
`schema.validator('users').assert(...)` work for sync validators; if a validator
returns a Promise, use `validateAsync(...)` or `assertAsync(...)`. The sync path
throws `DB_SCHEMA_ASYNC_VALIDATOR_REQUIRED` with that hint.

Standard Schema issues become `STANDARD_SCHEMA_VALIDATION_FAILED` diagnostics
with a normalized field path, vendor, issue path, message, and recovery hint.
Validator and resolver functions stay in trusted local code and are never
serialized into generated schema, manifests, viewer metadata, or TypeScript
output.

When a Standard Schema validator has no JSON Schema converter and no
`field.meta(...)` overlays, generated TypeScript uses a conservative
`[key: string]: unknown` fallback and the project diagnostics include
`STANDARD_SCHEMA_FIELDS_UNKNOWN`. Add overlays or a converter when generated
metadata needs to be richer.

See [examples/standard-schema](../examples/standard-schema) for a runnable
dependency-free example.

## Database-Derived Fields

Use `derived` metadata when a field is owned by a database, trigger, view,
materialized view, generated column, identity column, or another external
system. Async DB records the field in generated schemas, manifests, viewer
metadata, and TypeScript output, and rejects writes to it. It does not compute
the value.

```json
{
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": { "type": "string", "required": true },
    "updatedAt": {
      "type": "datetime",
      "readOnly": true,
      "derived": {
        "source": "database",
        "kind": "trigger"
      }
    }
  }
}
```

Identity columns and generated database defaults should also be marked derived
so creates do not require app code to supply those values:

```json
{
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": {
      "type": "number",
      "readOnly": true,
      "derived": {
        "source": "database",
        "kind": "identity"
      }
    },
    "email": { "type": "string", "required": true }
  }
}
```

For read models backed by database views, use derived metadata for columns that
come from SQL expressions or aggregates:

```json
{
  "kind": "collection",
  "idField": "packageName",
  "fields": {
    "packageName": { "type": "string", "required": true },
    "downloadCount": {
      "type": "number",
      "readOnly": true,
      "derived": {
        "source": "database",
        "kind": "view-column",
        "owner": "package_download_summary"
      }
    }
  }
}
```

Executable schema files can use `field.derived(...)`:

```js
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    updatedAt: field.derived(field.datetime(), {
      source: 'database',
      kind: 'trigger',
      owner: 'postgres',
    }),
  },
});
```

Keep `computed` for Async DB resolver-backed fields. Use `derived` when the
old database or external schema should keep owning the value during migration.

## Root Schema Registry

Use `db.schema.js` at the project root when you want one canonical schema registry:

```js
import { collection, field } from '@async/db/schema';

export default {
  users: collection({
    idField: 'id',
    fields: {
      id: field.string({ required: true }),
      firstName: field.string(),
      lastName: field.string(),
      fullName: field.computed(field.string(), function users_fullName_resolver({ record }) {
        return `${record.firstName} ${record.lastName}`;
      }),
    },
  }),
};
```

When `db.schema.js` exists it is authoritative for explicit schemas. It follows the root package `type` setting, so use root `"type": "module"` for that file. Per-resource `db/**/*.schema.*` files are not auto-discovered as live schemas, though the root schema may import them like normal JavaScript.

## Computed Fields

Use computed fields when an explicit schema needs trusted project code to derive
read-only values for REST and GraphQL projections:

```js
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    firstName: field.string({ required: true }),
    lastName: field.string({ required: true }),
    fullName: field.computed(field.string(), function users_fullName_resolver({ record }) {
      return `${record.firstName} ${record.lastName}`;
    }),
    displayName: field.computed(field.string(), {
      resolve({ record }) {
        return `${record.firstName} ${record.lastName}`;
      },
      resolveMany({ records }) {
        return records.map((record) => `${record.firstName} ${record.lastName}`);
      },
    }),
  },
});
```

`field.computed(type, fn)` is shorthand for `{ resolve: fn }`. Normal function
resolvers receive a runtime `this` context with delegated lookup through
`this.get(name)` and `this.has(name)`. Internal values include `db`, `resource`,
`field`, `fieldName`, `config`, `services`, `cache`, `value`, `record`,
`records`, and `args`. App-provided context can override those names, and
`this._internal` exposes the original internal values when a resolver needs them.
Arrow functions preserve JavaScript arrow semantics and cannot use runtime
`this`.

Computed fields are read-only and are rejected on package API, REST, GraphQL,
and registered operation writes. Generated schema, viewer manifest, and
TypeScript output include serializable metadata such as `computed` and
`readOnly`, but resolver functions stay in memory only.

REST resolves computed fields only when selected:

```txt
GET /db/users/u_1.json?select=id,fullName
```

GraphQL selections use the same projection/fanout layer. Collection reads prefer
`resolveMany` so one resolver can handle the selected page of records; single
reads and fields without `resolveMany` fall back to `resolve`.

Server code can call the same field resolvers without opening writable stores:

```ts
import { loadDbSchema } from '@async/db';

const schema = await loadDbSchema({ from: './db.schema.js' });
const userResolvers = schema.resolver('users', {
  value: input,
  context: {
    locale: 'en-US',
    nameFormatter,
  },
});

const fullName = await userResolvers.fullName();
```

Use `schema.resolver('users.fullName')` when one field resolver is enough. The
call argument is plain JavaScript; schema authors can type and interpret it for
their own use case.

## Folder Content Collections

Use `index.schema.js` as an explicit folder-as-collection marker. The collection
name comes from the folder:

```txt
db/docs/index.schema.js
db/docs/intro.mdx
db/docs/getting-started.mdx
```

Folder collections require an explicit `source` glob:

```js
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'frontmatter' }),
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string(),
  },
});
```

Runtime store behavior stays in `db.config.js`, not in the schema file:

```js
export default {
  resources: {
    docs: {
      store: 'static',
    },
  },
};
```

Core parses frontmatter and raw `.md` / `.mdx` body text. MDX compilation stays
app-owned JavaScript and is not a core dependency.

The built-in frontmatter parser is deliberately small and dependency-free. It
supports scalar `key: value` pairs plus the raw body string; keep arrays, nested
frontmatter, rich validation, and MDX compilation in app code when you need
them. The [content collections example](../examples/content-collections) shows
that pattern with docs and blog folders, static stores, relations to normal
fixture records, computed fields, and an example-owned preview renderer.

## Bundle And Unbundle

Single-resource bundle and unbundle commands keep their existing behavior:

```bash
npm run db -- schema bundle users --out artifacts/users.bundle.schema.json
npm run db -- schema unbundle users
```

These single-resource JSON artifacts serialize Async DB metadata and seed data;
they do not serialize executable validator or resolver functions.

If you omit the resource in an interactive terminal, the CLI prompts for either
`All schemas` or a specific resource. Use `--all` in scripts to skip the prompt.

Aggregate root schema output is schema-only and never embeds seed/data fixtures:

```bash
npm run db -- schema bundle --all
npm run db -- schema unbundle --all --schema-dir db
```

If aggregate bundling finds non-empty `seed` embedded in a schema source and no
separate data fixture is loaded, it first writes that seed to
`db/<resource>.json`, then writes the root schema without seed. The default root
schema output is `db.schema.js` when the project root or nearest package
boundary is ESM.

Folder collection source globs are rebased for the generated root file. For
example, `source: files('./**/*.mdx', { read: 'frontmatter' })` inside
`db/blog/index.schema.js` becomes
`source: files('./db/blog/**/*.mdx', { read: 'frontmatter' })` in
the root schema, so the registry can load the same content files.

When aggregate bundling sees computed resolvers or Standard Schema validators
from existing executable schema modules, the generated root schema imports the
original module, references its validator, and emits inline named resolver
wrappers to preserve behavior. Aggregate unbundle writes `.schema.js` files for
resources with executable validators or resolvers when the output folder can be
ESM. For the default `db/` folder, @async/db creates `db/package.json` with
`"type": "module"` when the root package is not already ESM and
`schema.autoModulePackageJson` is enabled. When a custom output folder cannot be
loaded as ESM, choose an ESM package boundary or write JSONC schema drafts
instead. Schema, manifest, type, doctor, bundle, unbundle, and generated starter
commands import trusted schema modules for metadata but do not call computed
resolvers.

## Inference

Inspect inferred contracts:

```bash
npm run db -- schema infer
npm run db -- schema infer users
npm run db -- schema infer users --out db/users.schema.jsonc
```

Use inference to move from fuzzy seed data toward explicit schema. If an explicit schema already exists, inference can still show what the current data implies.

## Migrating Existing Schema Declarations

Use `schema migrate` when an app already declares schemas through Prisma,
Drizzle, SQL migrations, JSON Schema/OpenAPI, TypeBox, Zod, Valibot, ArkType,
or ORM model files and wants Async DB schema drafts:

```bash
async-db schema migrate inspect ./src --out ./src/generated/db.schema-migration.json
async-db schema migrate generate --plan ./src/generated/db.schema-migration.json --schema-dir ./db --format mixed
async-db schema validate
```

`inspect` is non-mutating and emits `kind: "db.schemaMigrationReport"`.
`generate` writes per-resource `db/<resource>.schema.jsonc` drafts when the
contract can be represented as JSONC. In `--format mixed` mode, schemas that
need executable validator behavior get `.schema.js` drafts for manual review.
Use `--format jsonc` to force JSONC-only output and receive warnings for
unsupported behavior.

Generated files do not overwrite existing schema files unless `--force` is
passed. The inspector does not execute app schema files or install validator
dependencies; it is a review aid, not a lossless converter.

## Source Readers

@async/db reads all source files through a reader pipeline. Built-in readers handle JSON, JSONC, CSV, and schema files. Add `sources.readers` when another file format should remain the source of truth.

```js
// db.config.js
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
