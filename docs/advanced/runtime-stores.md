# Runtime Stores

The default JSON store is the file-backed database path. Graduate one resource at a time. SQLite, Postgres, KV, Redis-like stores, and custom stores are resource-level integrations for data that outgrows whole-file JSON writes.

## Store options

| Store | Use when |
| --- | --- |
| **json** | Default store. Writes app state under `.db/state` and keeps source JSON files clean. |
| **sourceFile** | Intentionally writes supported plain JSON resources back into `db/`. |
| **sqlite / postgres** | Higher-write, indexed, transactional, or multi-writer resources. |
| **kv / redis** | Caches, session-like resources, flags, and small infrastructure state. |

## Mixed store config

```js
import { defineConfig } from '@async/db/config';
import { postgresStore } from '@async/db/postgres';

export default defineConfig({
  stores: {
    default: 'json',
    appDb: postgresStore({ client: pool }),
  },
  resources: {
    appSettings: { store: 'json' },
    featureFlags: { store: 'json' },
    orders: { store: 'appDb' },
  },
});
```

## Graduation signals

- Writes are frequent enough that whole-file persistence is wasteful.
- Multiple app instances or processes can write the resource.
- Users need indexed filtering or pagination across growing records.
- Backup, audit, retention, or transactions should own the resource.

See [Resource Graduation And Mixed Stores](../store-graduation.md) for the full migration path.
