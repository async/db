# Configuration

Most projects can skip `jsondb.config.mjs` at first. Add config when defaults stop matching the project.

Use `defineConfig` for editor autocomplete and inline type checks:

```js
// @ts-check
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  stores: {
    default: 'json',
  },
  mock: {
    delay: [30, 100],
  },
});
```

See [jsondb.config.example.mjs](../jsondb.config.example.mjs) for a commented config with common values.

## Config Map

| Need | Default | Configure |
| --- | --- | --- |
| Fixture folder | `./db` | `dbDir` |
| Custom source formats | Built-in readers | `sources.readers` |
| Nested resource names | Fixture basename | `resources.naming` or `resources.customizeResource` |
| Runtime store behavior | JSON files under `.jsondb/state` | `stores.default` or `resources.<name>.store` |
| Index intent metadata | Off | `resources.<name>.indexes` |
| Importable generated types | `.jsondb/types/index.ts` | `types.commitOutFile` |
| Importable schema manifest | Off | `schemaOutFile` |
| Unknown fields | Warn | `schema.unknownFields` |
| Schema-only mock records | Off | `seed.generateFromSchema` |
| Local latency | `30-100ms` | `mock.delay` |
| Random local failures | Off | `mock.errors` |
| Legacy database shapes | Off | `forks` |
| Host, port, body limit | `127.0.0.1:7331`, 1 MB bodies | `server` |

## Full Example

```js
// @ts-check
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  dbDir: './db',
  stateDir: './.jsondb',

  sources: {
    writePolicy: 'preserve',
    readers: [],
  },

  stores: {
    default: 'json',
  },

  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
    commitOutFile: './src/generated/jsondb.types.ts',
    useReadonly: false,
    emitComments: true,
  },

  schemaOutFile: './src/generated/jsondb.schema.json',

  schema: {
    unknownFields: 'warn',
  },

  seed: {
    generateFromSchema: false,
    generatedCount: 5,
  },

  server: {
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
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
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  dbDir: './jsondb',
});
```

Existing `sourceDir` configs still work; `dbDir` is the shorter fixture-folder name. If both are provided, `sourceDir` wins for backwards compatibility.

## Source And Store Binding

Source fixtures and runtime persistence are separate concerns. By default, source fixtures stay unchanged and app writes go to the generated JSON store under `.jsondb/state`.

Use `resources.<name>.store` to bind a resource to a different store:

```js
import { defineConfig } from 'jsondb/config';

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
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  schema: {
    unknownFields: 'error',
  },
});
```

Keep the default `warn` while fixture shape is still changing.

## Generated Schema Seed Data

Generate mock runtime records for schema-only resources with empty seed data:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  seed: {
    generateFromSchema: true,
    generatedCount: 5,
  },
});
```

Data files in `db/*.json`, `db/*.jsonc`, and `db/*.csv` remain the source of truth when present.

## Mock Delay And Errors

jsondb delays local responses by `30-100ms` by default. Use `0` to disable delay, a number for fixed delay, or a tuple for a range.

```js
import { defineConfig } from 'jsondb/config';

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

Use `server` for a different host, port, or JSON body limit:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
  },
});
```

## Database Forks

Use forks when part of an app needs an older fixture shape while other pages move to a new shape.

```txt
db/                         current database shape
db.forks/legacy-demo/       old demo/page shape
.jsondb/state/              generated state for db/
.jsondb/forks/legacy-demo/  generated state for the fork
```

```js
import { defineConfig } from 'jsondb/config';

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
