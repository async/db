# Configuration

Most projects can skip `db.config.mjs` at first. Add config when defaults stop matching the project.

Use `defineConfig` for editor autocomplete and inline type checks:

```js
// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  stores: {
    default: 'json',
  },
  mock: {
    delay: [30, 100],
  },
});
```

See [db.config.example.mjs](../db.config.example.mjs) for a commented config with common values.

## Config Map

| Need | Default | Configure |
| --- | --- | --- |
| Fixture folder | `./db` | `dbDir` |
| Custom source formats | Built-in readers | `sources.readers` |
| Nested resource names | Fixture basename | `resources.naming` or `resources.customizeResource` |
| Runtime store behavior | JSON files under `.db/state` | `stores.default` or `resources.<name>.store` |
| Index intent metadata | Off | `resources.<name>.indexes` |
| Importable generated types | `.db/types/index.ts` | `types.commitOutFile` |
| Importable schema manifest | Off | `schemaOutFile` |
| Importable viewer manifest | Off | `viewerManifestOutFile` |
| REST response formats | `.json`, `.html`, `.md` | `rest.formats` |
| App-facing data route base | `/db` | `server.dataPath` |
| Unknown fields | Warn | `schema.unknownFields` |
| Schema defaults | Create and safe hydration | `defaults` |
| Schema-only mock records | Off | `seed.generateFromSchema` |
| Local latency | `30-100ms` | `mock.delay` |
| Random local failures | Off | `mock.errors` |
| GraphQL endpoint | `/graphql`, enabled | `graphql` |
| Legacy database shapes | Off | `forks` |
| Host, port, dev-tool route base, body limit | `127.0.0.1:7331`, `/__db`, 1 MB bodies | `server` |

## Full Example

```js
// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',
  stateDir: './.db',

  sources: {
    writePolicy: 'preserve',
    readers: [],
  },

  stores: {
    default: 'json',
  },

  types: {
    enabled: true,
    outFile: './.db/types/index.ts',
    commitOutFile: './src/generated/db.types.ts',
    useReadonly: false,
    emitComments: true,
  },

  schemaOutFile: './src/generated/db.schema.json',
  viewerManifestOutFile: './src/generated/db.viewer.json',

  schema: {
    unknownFields: 'warn',
  },

  defaults: {
    applyOnCreate: true,
    applyOnSafeMigration: true,
  },

  seed: {
    generateFromSchema: false,
    generatedCount: 5,
  },

  server: {
    apiBase: '/__db',
    dataPath: '/db',
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
    viewerLinks: [
      { label: 'App Data Viewer', href: 'http://127.0.0.1:5173/db' },
    ],
  },

  rest: {
    enabled: true,
    formats: {
      default: 'json',
      md({ resourceName, data }) {
        return {
          body: `# ${resourceName}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`,
          contentType: 'text/markdown; charset=utf-8',
        };
      },
      // yaml: {
      //   mediaTypes: ['application/yaml', 'text/yaml'],
      //   contentType: 'application/yaml; charset=utf-8',
      //   render({ data }) {
      //     return stringifyYaml(data);
      //   },
      // },
    },
  },

  graphql: {
    enabled: true,
    path: '/graphql',
  },

  mock: {
    delay: [30, 100],
    errors: null,
  },

  forks: ['legacy-demo'],
});
```

## Fixture Folder

Use `dbDir` when fixtures live somewhere other than `./db`:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',
});
```

Existing `sourceDir` configs still work; `dbDir` is the shorter fixture-folder name. If both are provided, `sourceDir` wins for backwards compatibility.

## Source And Store Binding

Source fixtures and runtime persistence are separate concerns. By default, source fixtures stay unchanged and app writes go to the generated JSON store under `.db/state`.

Use `resources.<name>.store` to bind a resource to a different store:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  stores: {
    default: 'json',
  },
  resources: {
    users: { store: 'sourceFile' },
    activityEvents: {
      store: 'json',
      indexes: [
        { fields: ['observedAt'] },
        { fields: ['domain', 'observedAt'] },
      ],
    },
  },
});
```

The `sourceFile` store is intentionally narrow. It is only for resources where supported writebacks should update plain `.json` source fixtures. JSONC and CSV sources remain source inputs and still hydrate runtime state.

`indexes` is metadata for store selection, generated tooling, and `doctor` scale warnings. The default JSON store does not build physical indexes.

## Schema Strictness

Unknown fields in schema-backed data warn by default. Use strict checks when fixture drift should fail:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  schema: {
    unknownFields: 'error',
  },
});
```

Keep the default `warn` while fixture shape is still changing.

## Schema Defaults

Schema defaults apply when creating collection records through the package API, REST, GraphQL, SQLite adapter, and generated Hono SQLite starter. Updates, patches, and document puts preserve omitted fields instead of backfilling defaults; include a field in the write body when you want to change it.

Safe runtime hydration also applies defaults to additive store migrations by default. Disable that separately when existing runtime records should remain untouched:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  defaults: {
    applyOnCreate: true,
    applyOnSafeMigration: false,
  },
});
```

## Generated Schema Seed Data

Generate mock runtime records for schema-only resources with empty seed data:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  seed: {
    generateFromSchema: true,
    generatedCount: 5,
  },
});
```

Data files in `db/*.json`, `db/*.jsonc`, and `db/*.csv` remain the source of truth when present.

## Mock Delay And Errors

@async/db delays local responses by `30-100ms` by default. Use `0` to disable delay, a number for fixed delay, or a tuple for a range.

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  mock: {
    delay: [50, 300],
    errors: {
      rate: 0.05,
      status: 503,
      message: 'Random local mock failure',
    },
  },
});
```

Random errors stay off by default. Turn them on when testing retries and error UI.

## Server Options

Use `server` for a different host, port, dev-tool route base, or JSON body limit:

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  server: {
    apiBase: '/__db',
    dataPath: '/db',
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
  },
});
```

`server.apiBase` scopes the standalone viewer and internal development routes:
viewer, schema, batch, import, live events, runtime log, and fork routes. REST
resources such as `/users` and the standalone GraphQL path stay unchanged unless
you configure those surfaces separately.

`server.dataPath` scopes the app-facing REST resource alias. It defaults to
`/db`, so `db/users.json` is available at `GET /db/users.json`. Set it to
`false` to disable the alias and use scoped REST under `/__db/rest` plus
standalone root REST routes.

## Database Forks

Use forks when part of an app needs an older fixture shape while other pages move to a new shape.

```txt
db/                         current database shape
db.forks/legacy-demo/       old demo/page shape
.db/state/              generated state for db/
.db/forks/legacy-demo/  generated state for the fork
```

```js
import { defineConfig } from '@async/db/config';

export default defineConfig({
  forks: ['legacy-demo'],
});
```

For a custom folder:

```js
export default defineConfig({
  forks: {
    'legacy-demo': {
      dbDir: './fixtures/legacy-demo',
    },
  },
});
```

Fork names are folder-style slugs: they must start with an alphanumeric character and may contain letters, numbers, underscores, and hyphens.

See [Server And Viewer](./server-and-viewer.md) for fork routes and [Package API](./package-api.md) for client usage.
