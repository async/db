# Configuration

The default path is one data folder (`db/`), generated output under `.db/`, JSON runtime state, open local routes, and inferred schema. Add config only when the defaults stop matching the app.

## Common switches

| Need | Default | Configure |
| --- | --- | --- |
| Data folder (`db/`) | `./db` | `dbDir` |
| Runtime store | `json` | `stores.default` |
| Resource override | inherit | `resources.*.store` |
| Strict fields | `warn` | `schema.unknownFields` |
| App route base | `/db` | `server.dataPath` |
| Tool route base | `/__db` | `server.apiBase` |

## A practical starting config

```js
// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  outputs: {
    committedTypes: './src/generated/db.types.d.ts',
    operationRefs: './src/generated/db.operation-refs.json',
  },
  stores: {
    default: 'json',
  },
  mock: {
    delay: [30, 100],
  },
});
```

## Config reads as a boundary document

| Area | Purpose |
| --- | --- |
| **sources** | Where data files and schema input come from. |
| **runtime** | Where app writes and hydrated state should land. |
| **exposure** | Which local and app-facing routes are allowed. |

See also [Configuration](../configuration.md) in the main guide for the full config map.
