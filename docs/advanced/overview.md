# Advanced Settings Atlas

Use these pages after the first JSON file works. They explain which knob changes source discovery, schema contracts, runtime persistence, exposed routes, operation refs, mock behavior, and generated artifacts.

```txt
db.config.js
stores.default = "json"
resources.orders.store = "appDb"
server.expose.rest = "registered-only"
operations.acceptRefs = "ref"
```

| Layer | What it controls |
| --- | --- |
| **source** | Where data files and schema files live. |
| **runtime** | Where writes and hydrated state land. |
| **public API** | Which routes clients may call. |

## Decision map

| Question | Default | Advanced setting | Page |
| --- | --- | --- | --- |
| Where do data files live? | `./db` | `dbDir`, `sourceDir` | [Configuration](./configuration.md) |
| When should schema drift fail? | `warn` | `schema.unknownFields` | [Schema contracts](./schema.md) |
| Where do writes land? | `.db/state` | `stores`, `resources.*.store` | [Runtime stores](./runtime-stores.md) |
| Which routes are public? | open local dev | `server.expose` | [Server routes](./server.md) |
| How do clients call stable contracts? | raw REST | `operations`, refs | [Operations](./operations.md) |
| How realistic should local responses feel? | 30–100ms | `mock.delay`, `mock.errors` | [Mocking](./mocking.md) |
| What belongs in git? | ignore `.db` | `outputs.*` | [Generated files](./generated-files.md) |

## Advanced pages

1. **[Configuration](./configuration.md)** — Use config when defaults stop matching the project shape.
2. **[Schema contracts](./schema.md)** — Know what inference can prove and when explicit schema should take over.
3. **[Runtime stores](./runtime-stores.md)** — Keep JSON where it fits and move only the resource that outgrows it.
4. **[Server routes](./server.md)** — Separate local viewer routes from app-facing data routes.
5. **[Registered operations](./operations.md)** — Expose reviewed callable refs instead of raw resource exploration.
6. **[Mocking](./mocking.md)** — Make loading, retry, and empty states visible while staying local.
7. **[Generated files](./generated-files.md)** — Keep `.db/` out of git, then deliberately commit generated types, manifests, or operation refs only when the app imports them.
