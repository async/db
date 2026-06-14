# JSON-First DB Spec

## Schema And Type Generation

The `db/` folder can contain data files, schema/type definitions, or both.

```txt
db/
  users.json                 optional seed data
  posts.json                 optional seed data
  settings.json              optional singleton data

  users.schema.json          optional schema/type source (strict JSON)
  users.schema.jsonc         optional schema/type source (JSON with comments)
  users.schema.js            optional executable schema source when package type is module
  posts.schema.jsonc
  settings.schema.jsonc

.db/
  state/
  wal/
  migrations/
  schema.generated.json
  types/
    index.d.ts               generated TypeScript declarations
```

Projects can also opt into committed generated types:

```txt
src/generated/
  db.types.d.ts            committed generated types
```

## Developer Workflows

Developers can choose among data-first files, schema/type-first files, or mixed mode.

### Data-First Files

The simplest path is a JSON file:

```txt
db/users.json
```

```json
[
  {
    "id": "u_1",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "role": "admin"
  }
]
```

The tool infers:

```txt
users collection
id field: id
fields: id, name, email, role
TypeScript type: User
REST routes
GraphQL fields
```

### Schema/Type-First Files

Developers can define types without real data:

```txt
db/users.schema.jsonc
```

```jsonc
{
  // Users who can sign into the local test app.
  "kind": "collection",
  "idField": "id",

  "fields": {
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable user id."
    },

    "name": {
      "type": "string",
      "required": true,
      "description": "Display name shown in the UI."
    },

    "email": {
      "type": "string",
      "required": true,
      "unique": true,
      "pattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
      "description": "Unique email address."
    },

    "role": {
      "type": "enum",
      "values": ["admin", "user"],
      "required": false,
      "default": "user",
      "description": "Local authorization role."
    }
  },

  "seed": [
    {
      "id": "u_1",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "role": "admin"
    }
  ]
}
```

This file acts as:

```txt
schema source
TypeScript source
REST/GraphQL source
optional default seed data
documentation source
```

Field schemas may declare practical local constraints:

```txt
unique: true              collection values must not repeat
min/max                   numeric lower and upper bounds
minLength/maxLength       string or array length bounds
pattern                   JavaScript RegExp source for string values
```

### Mixed Mode

Developers can provide both a data file and a schema file:

```txt
db/users.json
db/users.schema.jsonc
```

In mixed mode:

```txt
users.schema.jsonc controls the type/schema
users.json controls the seed records
```

If the schema file also contains `seed`, that embedded seed is ignored in favor of
the data file. The CLI should warn and suggest unbundling the seed from the
schema source so mixed mode keeps contracts and seed records in separate files.
`async-db schema unbundle users` removes embedded seed from the schema source and
writes non-empty seed data to `db/users.json`. Empty schema-only seed is removed
without creating an empty data file unless `--empty-seed` is passed. In-place JSONC
rewrites may lose comments, so the CLI should warn when it rewrites `.schema.jsonc`
without `--schema-out`.

`async-db schema bundle users` creates a portable schema-plus-seed artifact. Bundled
outputs should live outside the active data folder by default, such as
`artifacts/users.bundle.schema.json`, so they are not rediscovered as live schema
sources. Writing a bundle inside `db/` requires `--force`. Overwriting an existing
different seed or bundle output also requires `--force`.

`db.schema.js` at the project root is the canonical aggregate schema registry.
When present, it is authoritative for explicit schema definitions and
`db/**/*.schema.*` files are not auto-discovered as live schemas unless imported
by the root module. `async-db schema bundle --all --out db.schema.js` creates a
schema-only root registry without embedding seed/data files. If a schema source
has embedded seed and no separate data file is loaded, aggregate bundle first
writes that seed to `db/<resource>.json` and leaves the root schema seed-free.
`async-db schema unbundle --all --schema-dir db` spreads a root registry back to
per-resource schema files and leaves seed/data files untouched.
When bundling folder collection markers into a root registry, source globs are
rebased from the marker folder to the project root; for example,
`db/blog/index.schema.js` with `source: files('./**/*.mdx', { read: 'frontmatter' })`
becomes `source: files('./db/blog/**/*.mdx', { read: 'frontmatter' })` in
`db.schema.js`.

If the two disagree, the CLI reports the mismatch:

```txt
users.json has field "twitterHandle"
users.schema.jsonc does not define "twitterHandle"
```

Default behavior should be permissive in local development:

```txt
warn and allow
```

Configuration can enable stricter behavior:

```js
export default {
  schema: {
    unknownFields: 'warn', // "allow" | "warn" | "error"
  },
};
```

## Type Generation

By default, generated TypeScript types are written to:

```txt
.db/types/index.d.ts
```

Projects can customize the output location:

```js
export default {
  dbDir: './db',
  stateDir: './.db',
  schemaOutFile: './src/generated/db.schema.json',

  schemaManifest: {
    customizeField({ fieldName, defaultManifest }) {
      if (fieldName.endsWith('Markdown')) {
        return {
          ...defaultManifest,
          ui: {
            ...defaultManifest.ui,
            component: 'markdown',
          },
        };
      }

      return defaultManifest;
    },
  },

  types: {
    enabled: true,

    // Default gitignored output.
    outFile: './.db/types/index.d.ts',

    // Optional committed output.
    // If set, generate the same types here too.
    commitOutFile: './src/generated/db.types.d.ts',

    // Optional.
    useReadonly: false,
    exportRuntimeHelpers: true,
  },
};
```

This supports two common workflows.

### Gitignored Generated Types

Good for quick local development:

```ts
import type { DbTypes } from '../.db/types/index';
```

### Committed Generated Types

Better for apps and CI:

```ts
import type { DbTypes } from './generated/db.types';
```

If the app relies on generated types, committing them is usually better because CI and other developers do not need to run `async-db sync` before TypeScript can resolve imports.

## Example Generated TypeScript

From `users.schema.jsonc`, generate something like this:

```ts
export type UserRole = 'admin' | 'user';

export type User = {
  /** Stable user id. */
  id: string;

  /** Display name shown in the UI. */
  name: string;

  /** Unique email address. */
  email: string;

  /** Local authorization role. */
  role?: UserRole;
};

export type Settings = {
  theme?: string;
  locale?: string;
  features?: {
    billing?: boolean;
  };
};

export type DbCollections = {
  users: User;
};

export type DbDocuments = {
  settings: Settings;
};

export type DbTypes = {
  collections: DbCollections;
  documents: DbDocuments;
};
```

Package usage:

```ts
import { openDb } from '@async/db';
import type { DbTypes } from './generated/db.types';

const db = await openDb<DbTypes>({
  dbDir: './db',
  stateDir: './.db',
  stores: {
    default: 'json',
  },
});

const users = db.collection('users');

await users.create({
  id: 'u_2',
  name: 'Grace Hopper',
  email: 'grace@example.com',
  role: 'user',
});

const user = users.get('u_2');

if (user) {
  console.log(user.email);
}
```

Singleton document usage:

```ts
const settings = db.document('settings');

await settings.set('/theme', 'dark');

const value = settings.get('/theme');
```

## JavaScript Schema Sources

JSONC is useful, but a JavaScript schema file can be more expressive while staying simple.

```txt
db/users.schema.js
db/users.schema.js
```

```js
import { collection, field } from '@async/db/schema';

export default collection({
  description: 'Users who can sign into the local test app.',
  idField: 'id',

  fields: {
    id: field.string({
      required: true,
      description: 'Stable user id.',
    }),

    name: field.string({
      required: true,
      description: 'Display name shown in the UI.',
    }),

    email: field.string({
      required: true,
      description: 'Unique email address.',
    }),

    role: field.enum(['admin', 'user'], {
      default: 'user',
      description: 'Local authorization role.',
    }),
  },

  seed: [
    {
      id: 'u_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'admin',
    },
  ],
});
```

This provides normal comments and a clean authoring API without requiring Node.js to load TypeScript files directly.

For v1, support:

```txt
.json
.jsonc
.csv
.schema.json
.schema.jsonc
.schema.js
.schema.js
```

Use `.schema.js` only with normal Node ESM rules: the nearest `package.json` must declare `"type": "module"`. Avoid direct `.ts` schema sources in v1; projects that author schemas in TypeScript should compile to `.schema.js` or `.schema.js`.

## Source Readers

All built-in source loading should use the same reader pipeline:

```txt
.json data
.jsonc data
.csv data
.schema.json
.schema.jsonc
.schema.js
.schema.js
```

Projects may add `sources.readers` in `db.config.js` to parse custom files into raw db inputs:

```ts
type DbSourceReader = {
  name: string;
  match(context): boolean | Promise<boolean>;
  read(context): DbSourceReaderResult | Promise<DbSourceReaderResult>;
};

type DbSourceReaderResult =
  | { kind: 'data'; data: unknown; format?: string; resourceName?: string }
  | { kind: 'schema'; schema: unknown; format?: string; resourceName?: string }
  | Array<DbSourceReaderResult>
  | null;
```

Custom readers run before built-in readers. Returning `null` lets later readers try; the first non-null result owns the file. Reader context includes repo-relative file path, absolute source path, parsed data file path metadata, config, source hash, `readText()`, and `readBuffer()`.

Readers must return raw data or raw schema only. Resource normalization, diagnostics, type generation, schema manifest output, REST/GraphQL metadata, generated ids, and runtime sync stay centralized in db. A reader may return multiple sources from one file, but each result must include `resourceName`; otherwise db reports a structured diagnostic.

## Type-Only Schema Files

A schema file can define a resource without seed data.

```jsonc
{
  // Audit events generated during local development.
  "kind": "collection",
  "idField": "id",

  "fields": {
    "id": {
      "type": "string",
      "required": true
    },
    "type": {
      "type": "string",
      "required": true
    },
    "createdAt": {
      "type": "string",
      "required": true
    },
    "payload": {
      "type": "object",
      "required": false,
      "default": {}
    }
  },

  "seed": []
}
```

Generated runtime state:

```txt
.db/state/auditEvents.json
```

```json
[]
```

Generated TypeScript:

```ts
export type AuditEvent = {
  id: string;
  type: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};
```

Generated REST:

```txt
GET     /audit-events
GET     /audit-events/:id
POST    /audit-events
PATCH   /audit-events/:id
DELETE  /audit-events/:id
```

Generated GraphQL:

```graphql
type AuditEvent {
  id: ID!
  type: String
  createdAt: String
  payload: JSON
}
```

## Defaults

Defaults should be used in three places:

```txt
1. When creating new records through REST/GraphQL/package API.
2. When backfilling safe additive schema changes.
3. When initializing an empty runtime store.
```

Example schema:

```jsonc
{
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": {
      "type": "string",
      "required": true
    },
    "name": {
      "type": "string",
      "required": true
    },
    "role": {
      "type": "enum",
      "values": ["admin", "user"],
      "default": "user"
    },
    "active": {
      "type": "boolean",
      "default": true
    }
  }
}
```

Creating a user:

```bash
async-db create users '{"id":"u_3","name":"Linus"}'
```

Stored result:

```json
{
  "id": "u_3",
  "name": "Linus",
  "role": "user",
  "active": true
}
```

## Comments And Descriptions

JSON itself does not support comments, so support comments through one or both of these:

```txt
.schema.jsonc
.schema.js
```

Comments are primarily for humans. For generated TypeScript and GraphQL docs, use machine-readable descriptions:

```jsonc
{
  "email": {
    "type": "string",
    "description": "Unique email address used for login."
  }
}
```

Generate:

```ts
export type User = {
  /** Unique email address used for login. */
  email: string;
};
```

And GraphQL:

```graphql
type User {
  "Unique email address used for login."
  email: String
}
```

## Config

Add this to `db.config.js`:

```js
export default {
  dbDir: './db',
  stateDir: './.db',

  sources: {
    writePolicy: 'preserve',
  },

  stores: {
    default: 'json',
  },

  types: {
    enabled: true,
    outFile: './.db/types/index.d.ts',
    commitOutFile: './src/generated/db.types.d.ts',
    useReadonly: false,
    emitComments: true,
  },

  schema: {
    source: 'auto', // "auto" | "data" | "schema"
    allowJsonc: true,
    unknownFields: 'warn', // "allow" | "warn" | "error"
    additiveChanges: 'auto',
    destructiveChanges: 'manual',
    typeChanges: 'manual',
  },

  defaults: {
    applyOnCreate: true,
    applyOnSafeMigration: true,
  },

  collections: {
    users: {
      idField: 'id',
    },
  },

  server: {
    apiBase: '/__db',
    dataPath: '/db',
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
  },

  rest: {
    enabled: true,
  },

  graphql: {
    enabled: false,
    path: '/graphql',
  },

  falcor: {
    enabled: false,
    path: '/model.json',
  },
};
```

Set `dbDir` to point at a custom data folder instead of the default `./db`. Existing `sourceDir` configs remain supported; if both are provided, `sourceDir` wins for backwards compatibility.

## CLI

Add type-specific commands:

```bash
async-db types
async-db types --watch
async-db types --out ./src/generated/db.types.d.ts
```

Add schema commands:

```bash
async-db schema
async-db schema users
async-db schema manifest --out ./src/generated/db.schema.json
async-db schema validate
```

`async-db sync` should also regenerate types and should write the committed schema manifest when `schemaOutFile` is configured.

Expected output:

```txt
Loaded db/users.schema.jsonc
Loaded db/posts.json
Generated .db/schema.generated.json
Generated .db/types/index.d.ts
Generated src/generated/db.types.d.ts
Generated src/generated/db.schema.json
Synced runtime store
```

## REST And GraphQL Runtime

The package should keep protocol-specific implementation in dedicated modules:

```txt
src/rest/
src/graphql/
src/web/
```

REST should expose generated collection and singleton document routes.

Collection and single-record reads should support selective response shapes without changing the REST-first model:

```txt
GET /posts?select=id,title
GET /posts?offset=0&limit=20
GET /posts/p1?select=id,title
```

`offset` must be a non-negative integer, `limit` must be a positive integer, and collection responses should remain arrays. Pagination is applied before projection.

Schema-backed scalar fields can declare explicit to-one relation metadata:

```jsonc
{
  "authorId": {
    "type": "string",
    "required": true,
    "relation": {
      "name": "author",
      "to": "authors",
      "toField": "id",
      "cardinality": "one"
    }
  }
}
```

Generated schema metadata should include normalized `relations` both on the resource and at the top level. REST should support depth-1 explicit to-one expansion:

```txt
GET /posts/p1?expand=author
GET /posts/p1?expand=author&select=id,title,author.name
```

`select=author.name` without `expand=author` should fail with a structured hint. Missing required relation targets should produce schema diagnostics; optional missing targets should expand as `null`.

REST should support sequential batch requests:

```txt
POST /__db/batch
POST /batch
```

```json
[
  {
    "method": "GET",
    "path": "/users"
  },
  {
    "method": "PATCH",
    "path": "/settings",
    "body": {
      "theme": "dark"
    }
  }
]
```

REST batches are non-transactional by design. Items execute in order, and earlier successful writes remain committed if a later item fails.

Standalone development should also expose canonical resource aliases:

```txt
GET     /resources/users
GET     /resources/users/:id
POST    /resources/users
PATCH   /resources/users/:id
DELETE  /resources/users/:id
```

Bulk resource processing should target the collection route. `POST /resources/{resource}` with an array should create records sequentially. `PATCH /resources/{resource}` should accept either `{ ids, patch }` or per-record patch items. `PUT /resources/{resource}` should replace only listed records and preserve unlisted records. `DELETE /resources/{resource}?id=...&id=...` and `DELETE /resources/{resource}` with `{ ids }` should delete records sequentially. Bulk responses should include per-item status and a summary, and should not roll back earlier successful writes when a later item fails.

Schema-backed writes should validate declared field types before mutating runtime state. Required fields, primitive types, enum values, arrays, nullable fields, datetime strings, flexible objects with intentional additional properties, nested objects, and field constraints (`unique`, `min`, `max`, `minLength`, `maxLength`, `pattern`) should be checked for package API writes, REST writes, GraphQL mutations, `async-db sync`, and `async-db schema validate`.

The root route should work as a discovery endpoint. API-style requests to `GET /` should return JSON with resource names plus links for the data viewer, schema endpoint, GraphQL endpoint, resource routes, and registered response formats. Browser-style requests that prefer `text/html` should return a small HTML index with those same links.

The local server should also expose a built-in dependency-free viewer:

```txt
GET /__db
GET /__db/manifest
GET /__db/manifest.json
GET /__db/manifest.html
GET /__db/manifest.md
```

`server.apiBase` should default to `/__db` and should configure the
standalone viewer, viewer manifest, schema, batch, import, events, log, and fork route base
without changing root REST resource routes or the standalone GraphQL/Falcor paths.

`server.dataPath` should default to `/db` and should mount an app-facing REST
resource alias. For a data file at `db/users.json`, `GET /db/users.json` should
return the same synced runtime JSON resource as the REST resource route, not raw
static file contents. `GET /db/users.json?id=u_1` should return the same single
record shape as `GET /db/users/u_1.json`. Setting `server.dataPath: false`
should disable the alias while keeping scoped REST under `/__db/rest` and
standalone root REST routes.

The viewer manifest should be the shared JSON contract used by the built-in viewer and custom data viewers. `/manifest.json` should return JSON by default. `/manifest.html` should render a formatted JSON viewer with dark mode as the default, dark/light/system controls, copy, and pretty/raw formatting controls. `/manifest.md` should render Markdown with the manifest JSON in a fenced code block for AI clients. `/manifest` should choose among registered media types from `Accept`, and explicit `/manifest.<extension>` routes should use the matching registered response format. The manifest should include API links, capabilities, diagnostics, configured viewer links, response format metadata, collections, documents, field metadata, UI hints, and relation hints. It must not include seed records, source paths, source hashes, runtime state paths, or GraphQL SDL. Custom viewers should use the manifest for UI metadata and fetch actual records from REST or GraphQL.

The viewer should support:

```txt
resource list
collection table viewer
singleton document JSON viewer
selected JSON copy
CSV drag-and-drop import into the configured data folder
REST route specs with copy/paste examples
REST request runner
GraphQL SDL viewer
GraphQL query and mutation examples
GraphQL runner with variables
schema and field inspection
diagnostics summary
```

The CLI should include a data health check:

```txt
async-db doctor
async-db doctor --json
async-db doctor --strict
async-db check --strict
```

`doctor` should include existing source/schema diagnostics and advisory data file findings. It should detect duplicate collection ids, mixed id value types, inconsistent field value types, likely relation fields such as `todos.userId -> users.id`, and likely relation values missing from a target collection. Relation inference must be suggestive only; it must not mutate data files, write schema files, or silently change REST/GraphQL shape behavior. `doctor` should exit nonzero for error diagnostics, while `--strict` should also exit nonzero for warnings. Informational relation suggestions should not fail strict mode.

CSV data-first files should be treated as collections. The first row is the header row, headers become JSON field names, values are parsed into records, and the default JSON store is written as `.db/state/<resource>.json`. When a CSV data file is paired with a schema file, schema-declared array fields should coerce semicolon-delimited cells and JSON array string cells into arrays before validation and store hydration.

Collection data files should always have an id field. If a JSON/JSONC/CSV collection source omits `id`, generate counter ids in the selected runtime store, starting at `"1"` and avoiding existing ids. Source files stay unchanged by default. For resources bound to the `sourceFile` store, write generated ids back to plain `.json` data files.

Runtime stores should track source hashes for JSON, JSONC, and CSV files. If a source hash changes during sync, regenerate runtime state for that resource from the source data file. If the hash is unchanged, preserve runtime edits.

The viewer should support uploading a CSV through:

```txt
POST /__db/import
```

The upload should copy the CSV into the configured data folder, run sync, reload the in-memory resources, update the URL query parameter to the imported resource, and reload the dashboard view.

While serving, db should watch the configured data folder for data and schema changes, ignoring `.db/`. On change, reload resources and notify the single-file viewer through the configured events route, defaulting to `/__db/events`, so the dashboard refreshes automatically. If one source file fails to parse or load, report a file-specific diagnostic in the viewer and keep the remaining valid resources available. If the runtime cannot create a file watcher because of environment resource limits such as `EMFILE` or `ENOSPC`, keep the HTTP server running, publish a warning diagnostic, and serve without live reload.

Vite development should be supported through a dependency-light plugin export:

```js
import { dbPlugin } from '@async/db/vite';

export default {
  plugins: [dbPlugin()],
};
```

The plugin should return a plain Vite-compatible plugin object with `apply: 'serve'`, mount @async/db into the existing Vite dev middleware stack, and avoid bundling Node-only file-backed runtime code into production builds. By default, Vite dev routes should be scoped under `/__db` and should not answer root app routes. A plugin-level `apiBase` should win over `server.apiBase`:

```txt
GET  /db/users.json
GET  /__db
GET  /__db/schema
POST /__db/batch
POST /__db/graphql
POST /__db/model.json
GET  /__db/rest/users
```

Standalone `async-db serve` should keep root REST routes such as `/users`, plus `/graphql`, `/model.json`, `/batch`, and `/resources/*` aliases. The Vite plugin may opt into root REST routes with `rootRoutes: true`.

GraphQL should support a dependency-free subset suitable for local app development:

```graphql
query GetUser($id: ID!) {
  allUsers: users {
    id
    displayName: name
  }
  ada: user(id: $id) {
    email
  }
}
```

Supported GraphQL behavior:

```txt
queries
mutations
root and nested aliases
variables
operationName selection for multi-operation documents
__typename meta fields
named fragments and inline fragments
@include and @skip executable directives
object/list/scalar input values
collection list queries
collection single-record queries by id
collection create/update/delete mutations
singleton document queries
singleton document update/set mutations
selection-set projection
minimal __schema and __type introspection
HTTP batching by posting an array to /graphql
```

Unsupported in the dependency-free v1 subset:

```txt
subscriptions
full spec introspection coverage
general-purpose GraphQL validation
```

Falcor should support a dependency-free JSONGraph endpoint suitable for local
app development:

```txt
POST /model.json
POST /__db/model.json
```

Supported Falcor behavior:

```txt
get(pathSets)
set(jsonGraphEnvelope)
call(functionPath, args)
collection list refs and length fields
collection by-id maps such as usersById.u_1.name
singleton document paths such as settings.theme
registered operation calls through operations.{ref}
```

Falcor `set` should update direct collection fields or document paths through
normal runtime writes and schema validation, then return post-write JSONGraph
for the written paths. Creates, deletes, reorders, and multi-step workflows
should use `call` mapped to registered operations. @async/db should not depend
on `falcor`, `falcor-router`, or `falcor-express` at runtime.

## Repo Example Launcher

The repo should include an npm task that starts every example database and serves an index page of viewer links:

```bash
pnpm run examples
```

The index page should list each example and link to:

```txt
/__db
/__db/schema
/graphql
```

Examples should range from basic to advanced:

```txt
examples/basic
examples/data-first
examples/schema-first
examples/advanced
```

## Client API

Provide a small HTTP client for consuming db from apps and tests:

```ts
import { createDbClient } from '@async/db/client';

const client = createDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  restBasePath: '',
  batching: {
    enabled: true,
    delayMs: 0,
  },
});
```

The client should support:

```txt
client.graphql(query, variables)
client.graphql.batch(requests)
client.rest(method, path, body)
client.rest.batch(requests)
optional scoped REST base paths for embedded dev servers
optional automatic batching for individual GraphQL and REST calls
10ms default automatic batching window
read-safe dedupe for identical REST GET and GraphQL query requests
explicit dedupe: 'all' opt-in for deduping writes and mutations
```

Local mock behavior should support latency and chaos errors:

```js
export default {
  mock: {
    delay: [50, 300],
    errors: {
      rate: 0.05,
      status: 503,
      message: 'Random local mock failure',
    },
  },
};
```

## Error Messages

Errors should be readable by humans and useful to AI agents. They should explain:

```txt
what failed
where it failed
what value was received when useful
what values or commands are valid
what to try next
```

REST and server errors should use this shape:

```json
{
  "error": {
    "code": "REST_BATCH_INVALID_PATH",
    "message": "REST batch path must start with \"/\": users",
    "hint": "Use absolute local paths such as \"/users\", \"/settings\", or \"/__db/schema\".",
    "details": {
      "path": "users"
    }
  }
}
```

GraphQL errors should use standard GraphQL `errors[]` entries with `extensions`:

```json
{
  "data": null,
  "errors": [
    {
      "message": "Unknown GraphQL query field \"nope\".",
      "extensions": {
        "code": "GRAPHQL_UNKNOWN_QUERY_FIELD",
        "hint": "Use one of: \"users\", \"user\".",
        "details": {
          "field": "nope",
          "availableFields": ["users", "user"]
        }
      }
    }
  ]
}
```

## Codex Prompt Add-On

Append this to the Codex prompt:

````md
## Type generation and schema-only files

Add automatic TypeScript type generation.

By default, generated types should be written to:

```txt
.db/types/index.d.ts
```

Also support a configurable committed output file:

```js
export default {
  types: {
    enabled: true,
    outFile: './.db/types/index.d.ts',
    commitOutFile: './src/generated/db.types.d.ts',
    emitComments: true,
    useReadonly: false
  }
};
```

If `commitOutFile` is set, generate the same TypeScript types there so users can import and commit them.

The generated file should export:

```ts
export type DbCollections = {};
export type DbDocuments = {};
export type DbTypes = {
  collections: DbCollections;
  documents: DbDocuments;
};
```

For each collection, generate a record type:

```ts
export type User = {
  id: string;
  name: string;
  email: string;
  role?: 'admin' | 'user';
};
```

Use schema field descriptions to emit JSDoc comments.

## Schema manifest output and model-driven admin UIs

Add optional JSON schema manifest generation for local-first admin/CMS UIs that render forms from db models instead of duplicating per-resource form configuration.

This is separate from `.db/schema.generated.json`. The existing generated schema file remains runtime/server metadata and may include diagnostics, source paths, seeds, REST route lists, and GraphQL SDL. The committed manifest is a small importable artifact for applications.

Configure it with:

```js
export default {
  schemaOutFile: './src/generated/db.schema.json',
};
```

When `schemaOutFile` is set, `async-db sync` writes the manifest. The CLI can also write one directly:

```bash
async-db schema manifest --out ./src/generated/db.schema.json
```

Custom viewer UIs can use the live `GET /__db/manifest.json` route or a committed viewer manifest. Browser users can open `GET /__db/manifest.html`, AI clients can open `GET /__db/manifest.md`, and `GET /__db/manifest` negotiates from registered `Accept` media types:

```js
export default {
  viewerManifestOutFile: './src/generated/db.viewer.json',
  server: {
    viewerLinks: [
      { label: 'App Data Viewer', href: 'http://127.0.0.1:5173/db' },
    ],
  },
};
```

```bash
async-db viewer manifest --out ./src/generated/db.viewer.json
```

The manifest should have this top-level shape:

```json
{
  "version": 1,
  "collections": {},
  "documents": {}
}
```

Each resource entry should include `kind`, `name`, `idField` for collections, optional `description`, and `fields`. Each field should include normalized field metadata such as `type`, `required`, `nullable`, `default`, `values`, nested object `fields`, array `items`, `relation`, constraints, and inferred `ui` defaults.

The manifest must not include seed records, source hashes, source paths, runtime state, diagnostics, REST route lists, or GraphQL SDL.

Default UI inference should be deterministic and safe:

```txt
boolean -> toggle
small enum -> radio
larger enum -> select
email-like field name -> email
url-like field name -> url
image/avatar/photo-like field name -> image
description/body/content/notes/bio/markdown-like field name -> textarea
array<string> -> tags
array<enum> -> multiSelect
object with declared fields -> fieldset
open object or unknown field -> json
relation field -> relationSelect with optionsFrom
collection id field -> readonly
```

Manifest defaults are metadata only. They must not change data files, seed data, runtime state, validation, REST, or GraphQL behavior.

Apps can customize or omit field entries with a visitor hook:

```js
export default {
  schemaManifest: {
    customizeField({ field, fieldName, resource, resourceName, path, file, sourceFile, defaultManifest }) {
      if (resourceName === 'users' && fieldName === 'passwordHash') {
        return null;
      }

      if (fieldName.endsWith('Markdown')) {
        return {
          ...defaultManifest,
          ui: {
            ...defaultManifest.ui,
            component: 'markdown',
          },
        };
      }

      return defaultManifest;
    },
  },
};
```

The visitor return value must be JSON-serializable. Functions, classes, symbols, bigint values, non-finite numbers, and non-plain objects should fail generation with a diagnostic that includes resource and field path. Returning `null` omits the field from the manifest.

The intended first use is permissioned admin CRUD for resources such as dashboards, users, and permission policies. Admin screens can map manifest field metadata to reusable create/edit/view components while policy checks decide whether fields are hidden, readonly, or editable for a given session.

Support schema-only files.

The package should accept these source formats:

```txt
db/users.json              data-first file
db/users.jsonc             data-first file with comments
db/users.csv               data-first collection file
db/users.schema.jsonc      schema/type-first file
db/users.schema.js        schema/type-first file using JS helpers
db/users.schema.js         schema/type-first file using JS helpers in type: module projects
```

The main source JSON/JSONC/CSV data file can be used to infer schema and generate types.

A `.schema.jsonc` file can define a resource without seed data:

```jsonc
{
  // Users who can sign into the local test app.
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable user id."
    },
    "role": {
      "type": "enum",
      "values": ["admin", "user"],
      "default": "user",
      "description": "Local authorization role."
    }
  },
  "seed": []
}
```

Support `.schema.js` files for richer authoring:

```js
import { collection, field } from '@async/db/schema';

export default collection({
  description: 'Users who can sign into the local test app.',
  idField: 'id',
  fields: {
    id: field.string({
      required: true,
      description: 'Stable user id.'
    }),
    role: field.enum(['admin', 'user'], {
      default: 'user',
      description: 'Local authorization role.'
    })
  },
  seed: []
});
```

Support a root `db.schema.js` registry for one-file schema authoring:

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
      })
    }
  })
};
```

`field.computed(type, fn)` is shorthand for `{ resolve: fn }`. Normal function
resolvers are invoked with `this` bound to a delegated runtime resolver context.
The context exposes `this.get(name)`, `this.has(name)`, direct property aliases,
and `this._internal` for the unoverridden internal view. Internal values include
`db`, `resource`, `field`, `fieldName`, `config`, `services`, `cache`, `value`,
`record`, `records`, and `args`. App-provided context values win over internal
values with the same key. Schema/type/manifest/doctor/bundle/unbundle/generate
commands may import trusted schema modules for metadata, but must not call
computed resolvers.

The package API should expose `loadDbSchema({ from })` for metadata-only schema
loading from a project root, `db/` folder, `db.schema.js`, or individual schema
file. `db.schema.js` follows the same locator rules when the project uses `"type": "module"`. Loaded schemas expose `schema.validator(resource, options)` for endpoint
input validation and `schema.resolver(resourceOrField, options)` for direct
computed field execution. Validators reject computed/read-only fields, default
unknown fields to `error`, and support `strip`, `allow`, `warn`, and patch/replace
validation modes. `openDb({ schema })` accepts a loaded schema object and opens
runtime stores from the same locator.

Folder-backed content collections use `index.schema.js` as an explicit marker:

```txt
db/docs/index.schema.js
db/docs/intro.mdx
```

The resource name comes from the containing folder. Folder collections require an
explicit `source: files(pattern, { read })` declaration. Runtime store behavior
belongs in `db.config.js` through `resources.<name>.store`; use `store: 'static'`
there when file-backed content should be read-only. Core only parses frontmatter
plus raw `.md` / `.mdx` body text. MDX compilation remains app-owned.

Do not require TypeScript execution for schema files in v1. Use `.schema.js` for executable schema definitions in ESM package boundaries, or compile TypeScript-authored schema files to `.schema.js`.

Rules:

1. If only `users.json` exists, infer schema from data.
2. If only `users.schema.json`, `users.schema.jsonc`, or `users.schema.js` exists, create the collection from schema and optional seed/default data.
3. If both `users.json` and `users.schema.*` exist, the schema file is authoritative for types and validation, while the JSON file provides seed data.
4. Additive fields are safe and automatic.
5. Removed fields and type changes require explicit approval.
6. Defaults should apply when creating records and when safely backfilling additive fields.
7. Generated TypeScript types should update during `async-db sync`, `async-db types`, and service startup when needed.

Add CLI commands:

```bash
async-db types
async-db types --watch
async-db types --out ./src/generated/db.types.d.ts
async-db schema
async-db schema validate
async-db schema unbundle users
async-db schema unbundle --all --schema-dir db
async-db schema bundle users --out artifacts/users.bundle.schema.json
async-db schema bundle --all --out db.schema.js
async-db generate hono
async-db generate hono --api rest,graphql --out ./server
async-db generate hono --api none --app module
```

## Hono And SQLite Starter Generation

Add `async-db generate hono` for graduating a file-backed app into a starter API backed by SQLite.

Default behavior:

```txt
outDir: ./db-api
api: rest
db: sqlite
app: standalone
runtime: node-sqlite
seed: false
```

Generated output should be TypeScript-first and include a portable repository interface, SQLite adapter using `node:sqlite`, validators, initial SQL migration, and optional Hono REST/GraphQL route modules. Standalone output should include `package.json`, `tsconfig.json`, `src/app.ts`, and `src/server.ts`.

API selection:

```bash
async-db generate hono --api rest
async-db generate hono --api graphql
async-db generate hono --api rest,graphql
async-db generate hono --api none
```

SQLite generation rules:

```txt
collections -> SQLite tables with id TEXT PRIMARY KEY
documents -> _db_documents(name TEXT PRIMARY KEY, value TEXT)
string/enum -> TEXT
number -> REAL
boolean -> INTEGER
object/array/unknown -> JSON text in TEXT columns
```

Generation should fail on schema errors. For production SQLite output, warning diagnostics should also block generation unless `--allow-warnings` is provided. Seed insertion is disabled by default; `--seed fixtures` can emit data file seed support for local SQLite mimicry.

Keep Hono and SQLite runtime support isolated under optional exports:

```txt
db/hono
db/sqlite
```

The core package must not add mandatory Hono or SQLite npm dependencies.

Acceptance criteria:

* Data-first files generate TypeScript types.
* Schema-only files generate TypeScript types.
* JSONC schema comments are allowed.
* Field descriptions become JSDoc in generated TypeScript.
* `types.outFile` writes to `.db/types/index.d.ts` by default.
* `types.commitOutFile` writes to a custom importable location.
* Package API can be typed with the generated `DbTypes`.
````

The intended developer loop is:

```txt
create/edit JSON or schema data files
run async-db sync
types are generated
REST and GraphQL are generated
runtime store is updated
source files stay clean unless writeback is requested
```
