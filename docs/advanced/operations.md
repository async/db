# Operations

Registered operations are allowlisted REST or GraphQL templates. They expose a reviewed contract instead of raw route exploration. Client code calls a name or ref; the server resolves the template, substitutes variables, and executes through normal @async/db validation and shaping.

## Operation source

```json
{
  "name": "GetUserProfile",
  "ref": "users.profile.get",
  "method": "GET",
  "path": "/users/{id}.json",
  "query": {
    "select": "id,name,email"
  }
}
```

## Client call

```js
import { createDbClient } from '@async/db/client';
import operationRefs from './generated/db.operation-refs.json';

const db = createDbClient({ apiBase: '/api/db' });

await db.query(
  operationRefs.operations.GetUserProfile.ref,
  { id: 'u_1' },
);
```

## Production contract checklist

| Step | Detail |
| --- | --- |
| **build refs** | Generate server-side registry output and browser-safe operation refs. |
| **accept refs** | Prefer `operations.acceptRefs: "ref"` for public clients. |
| **lock raw rest** | Set `server.expose.rest: "registered-only"` once raw routes should close. |
| **own policy** | Refs are not secrets. App code still owns auth, authorization, limits, and observability. |

> [!WARNING]
> Operation refs are allowlist identifiers, not secrets. They keep route shape reviewable while normal app policy still owns authentication, authorization, limits, and monitoring.

The built-in local viewer uses the same client-safe contract. Operation mode is
available only when operations are enabled and the manifest reports client-safe
refs or summaries. It shows the public endpoint/ref shape and a variables
editor, but it does not render server operation templates or registry output.

See [Prototype To Production](../prototype-to-production.md) for the full graduation path.
