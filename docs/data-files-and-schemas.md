# Data Files And Schemas

@async/db discovers data and schema sources recursively under the configured data folder, `./db` by default.

## Start With JSON Files

The default path is one JSON file per collection:

```txt
db/users.json
```

```json
[
  {
    "id": "u_1",
    "name": "Ada Lovelace",
    "active": true
  }
]
```

Run `async-db sync`, then read and write the collection through local REST routes such as `GET /db/users.json`. @async/db infers useful contracts from the JSON shape and uses them for generated types, REST metadata, GraphQL metadata, viewer metadata, and write validation.

Collections default to `idField: "id"`, which normalizes to `identity: { "fields": ["id"] }`. If a JSON collection omits `id`, @async/db adds counter ids in the selected runtime store:

```json
[
  { "id": "1", "name": "Ada Lovelace" },
  { "id": "2", "name": "Grace Hopper" }
]
```

By default, source files stay unchanged and generated ids are written to the selected runtime store.

Collections can also declare compound identity explicitly. Compound identity uses object keys; it does not encode fake delimiter ids:

```json
{
  "kind": "collection",
  "identity": { "fields": ["name", "version"] },
  "fields": {
    "name": { "type": "string", "required": true },
    "version": { "type": "string", "required": true },
    "tag": { "type": "string" }
  }
}
```

Package API calls use the same object key:

```ts
await db.collection('packageVersions').get({
  name: '@async/db',
  version: '0.9.0',
});
```

REST keeps `/:id` routes for single-field identity. Compound-key resources use `/__key` with query parameters for reads and object bodies for writes. GraphQL exposes a resource-specific `KeyInput` type and uses a `key` argument for reads, updates, and deletes.

Append-only event logs can use `writePolicy: "append-only"` and `log` metadata. They allow `append()` and reject create, update, delete, and replace-all mutation APIs.

Encoded payload fields use `type: "bytes"` with `encoding: "base64"`, `"base64url"`, or `"hex"`. The normalized schema and manifests include bytes metadata so viewers, generated types, REST, and GraphQL can treat payloads as strings while validation checks the declared encoding.

## Add Schema When Inference Is Not Enough

Use a schema file when data inference is too loose or when you need intent that is not represented in the seed records.

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
    }
  }
}
```

Field constraints are checked during `sync`, schema validation, package API writes, REST writes, and GraphQL mutations. Use `nullable: true` when `null` is intentional.

Inspect inferred contracts before committing to explicit schema:

```bash
pnpm run db -- schema infer
pnpm run db -- schema infer users
```

## More Formats

Beyond plain JSON, @async/db supports additional built-in source formats:

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

### JSONC

Use `db/users.jsonc` when you want comments or trailing commas in seed data while keeping the same data-first workflow as JSON.

### CSV

Use CSV when data starts in a spreadsheet or export:

```txt
db/users.csv
```

```csv
id,name,email,active
u_1,Ada Lovelace,ada@example.com,true
```

`sync` parses the header row, infers a collection schema, and writes `.db/state/users.json` through the default JSON store. When a CSV is paired with a schema file, array fields stay arrays in runtime state.

See [examples/csv](../examples/csv) for a runnable CSV example.

`.schema.js` and `db.schema.js` use normal Node.js ESM rules. If the project root `package.json` is already `"type": "module"`, no extra marker is needed. If the root is not ESM, @async/db creates `db/package.json` with `"type": "module"` before loading `.schema.js` files inside the configured data folder. Set `schema.autoModulePackageJson: false` to manage that file yourself.

TypeScript schema files are intentionally not loaded directly in v1 because Node.js does not execute TypeScript without an explicit loader or build step. See [TypeScript Schema Sources](./typescript-schema-sources.md) for the supported compile-to-JavaScript workflow.

## Advanced

The sections below cover richer schema authoring, folder collections, custom readers, and migration helpers.

### JavaScript Schema Sources

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

`.schema.js` files execute as trusted local project JavaScript.

### Standard Schema Validators

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

See [examples/standard-schema](../examples/standard-schema) for a runnable dependency-free example.

### Database-Derived Fields

Use `derived` metadata when a field is owned by a database, trigger, view,
materialized view, generated column, identity column, or another external
system. Async DB records the field in generated schemas, manifests, viewer
metadata, and TypeScript output, and rejects writes to it. It does not compute
the value.

Keep `computed` for Async DB resolver-backed fields. Use `derived` when the
old database or external schema should keep owning the value during migration.

### Root Schema Registry

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

When `db.schema.js` exists it is authoritative for explicit schemas.

### Computed Fields

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
  },
});
```

Computed fields are read-only and are rejected on package API, REST, GraphQL,
and registered operation writes.

See [examples/computed-fields](../examples/computed-fields) for a runnable example.

### Folder Content Collections

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

The [content collections example](../examples/content-collections) shows docs and blog folders, static stores, relations, computed fields, and an example-owned preview renderer.

### Git-Backed Content Collections

Use `@async/db/git` when the content source of truth is a Git repository. Config owns the remote alias, and schema files own the content mapping.

```js
// db.config.js
import { defineConfig } from '@async/db/config';
import { githubRemote } from '@async/db/git';

export default defineConfig({
  git: {
    remotes: {
      content: githubRemote({
        repo: 'acme/site-content',
        branch: 'main',
        mode: 'app',
      }),
    },
  },
  graphql: { enabled: true },
});
```

One-record-per-file collections use `gitFiles(pattern, options)`. Path placeholders derive record identity for reads; declare `idField` when the schema key is not `id`.

```js
// db/posts/index.schema.js
import { collection, field } from '@async/db/schema';
import { gitFiles } from '@async/db/git';

export default collection({
  source: gitFiles('content/posts/{id}.mdx', {
    remote: 'content',
    read: 'frontmatter',
    bodyField: 'body',
  }),
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    status: field.enum(['draft', 'published'], { default: 'draft' }),
    body: field.string({ required: true }),
  },
});
```

Singleton JSON documents use `gitFile(...)`:

```js
import { document, field } from '@async/db/schema';
import { gitFile } from '@async/db/git';

export default document({
  source: gitFile('content/site.json', {
    remote: 'content',
    read: 'json',
  }),
  fields: {
    title: field.string({ required: true }),
    theme: field.string(),
  },
});
```

One collection file containing a JSON array uses `gitCollectionFile(...)`:

```js
import { collection, field } from '@async/db/schema';
import { gitCollectionFile } from '@async/db/git';

export default collection({
  source: gitCollectionFile('content/authors.json', {
    remote: 'content',
    read: 'json',
  }),
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    name: field.string({ required: true }),
  },
});
```

Supported read modes are `json`, `jsonc`, `frontmatter`, `md`, `mdx`, and `text`. JSONC reads are allowed, but JSONC writes are rejected by default because preserving comments and formatting is not automatic. MDX compilation remains app-owned; Async DB stores frontmatter fields plus the raw body field.

For a Tina-style CMS shape, use a SQLite Git mirror in config and keep resource mappings in schema files:

```js
// db.config.js
import { defineConfig } from '@async/db/config';
import { githubRemote } from '@async/db/git';
import { sqliteMirror } from '@async/db/sqlite';

export default defineConfig({
  git: {
    remotes: {
      content: githubRemote({
        repo: 'acme/marketing-content',
        branch: 'main',
        mode: 'app',
      }),
    },
    mirror: sqliteMirror({
      file: './.db/git-mirror.sqlite',
      writes: 'through',
    }),
  },
  outputs: {
    schemaManifest: './src/generated/db.schema.json',
    committedTypes: './src/generated/db.types.d.ts',
  },
  graphql: { enabled: true },
});
```

In that setup, `pages` can map to `content/pages/{slug}.mdx`, `authors` to `content/authors/{id}.json`, and `site` to `content/site.json`. Reads go through the local mirror after sync rather than making live GitHub calls per request.

### Bundle And Unbundle

Single-resource bundle and unbundle commands keep their existing behavior:

```bash
pnpm run db -- schema bundle users --out artifacts/users.bundle.schema.json
pnpm run db -- schema unbundle users
```

Aggregate root schema output is schema-only and never embeds seed data:

```bash
pnpm run db -- schema bundle --all
pnpm run db -- schema unbundle --all --schema-dir db
```

When aggregate unbundle cannot write executable schema files, choose an ESM package boundary or write JSONC schema drafts instead. The `unbundle --format jsonc` flag forces JSONC-only output.

### Migrating Existing Schema Declarations

Use `schema migrate` when an app already declares schemas through Prisma,
Drizzle, SQL migrations, JSON Schema/OpenAPI, TypeBox, Zod, Valibot, ArkType,
or ORM model files and wants Async DB schema drafts:

```bash
async-db schema migrate inspect ./src --out ./src/generated/db.schema-migration.json
async-db schema migrate generate --plan ./src/generated/db.schema-migration.json --schema-dir ./db --format mixed
async-db schema validate
```

### Source Readers

@async/db reads all source files through a reader pipeline. Built-in readers handle JSON, JSONC, CSV, and schema files. Add `sources.readers` when another file format should remain the source of truth.

Custom readers run before built-in readers. The first reader that returns a result owns the file.

### Nested Data Folders

Data files can be grouped under `db/` without changing resource names when basenames are unique:

```txt
db/
  cms/
    pages.schema.json
    pages.json
  analytics/
    charts.schema.json
    charts.json
```

If nested folders contain repeated basenames, configure naming in `db.config.js`:

| Option | Example path | Resource name | Use when |
| --- | --- | --- | --- |
| `basename` | `db/cms/pages.json` | `pages` | Basenames are unique. |
| `folder-prefixed` | `db/cms/pages.json` | `cmsPages` | Folders are domains and repeated filenames are common. |
| `path` | `db/cms/landing/pages.json` | `cmsLandingPages` | Deep folder structure should become part of the API name. |
| `customizeResource` | `db/marketing/pages.json` | `landingPages` | Public API names must be explicit and stable. |

## Related Examples

- [Data-first](../examples/data-first/README.md)
- [CSV](../examples/csv/README.md)
- [Schema-first](../examples/schema-first/README.md)
- [Advanced](../examples/advanced/README.md)
