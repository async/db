# TypeScript Schema Sources

@async/db executes schema modules with normal Node.js ESM loading. It supports JavaScript schema files at runtime and lets TypeScript projects compile schema authoring files into those runtime files.

@async/db does not execute `.ts` schema files directly in this pass. Add a build step when you author schemas in TypeScript.

## Supported Authoring Paths

### JavaScript ESM

Use `.schema.js` when the nearest `package.json` has `"type": "module"`:

```json
{
  "type": "module"
}
```

```js
// db/users.schema.js
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    email: field.string({ required: true, unique: true }),
  },
});
```

This works for `db.schema.js`, `db/*.schema.js`, and `db/**/index.schema.js`.

### Compatibility Extensions

Prefer `.js` ESM schema files under a package with `"type": "module"`. This repo and most developer repos already have that package boundary, so docs and examples use `.js` as the normal path.

Async DB still supports `.schema.mjs`, `db.schema.mjs`, and `index.schema.mjs` for compatibility with older projects or package-less folders. It does not execute `.mts` schema sources directly; if TypeScript authoring uses `.mts` or `.ts`, compile those files to `.schema.js` before running `async-db sync`.

### TypeScript Authoring

Author TypeScript in a separate source folder and compile it into supported runtime schema files:

```ts
// db/schema-src/users.schema.ts
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    email: field.string({ required: true, unique: true }),
  },
});
```

Compile to `.schema.js`:

```json
{
  "scripts": {
    "db:schema:build": "tsc -p tsconfig.db-schema.json",
    "db:sync": "npm run db:schema:build && async-db sync"
  }
}
```

When the project root `package.json` is not already `"type": "module"`, @async/db creates `db/package.json` with `"type": "module"` before loading `.schema.js` files from the data folder (`db/`). Set `schema.autoModulePackageJson: false` when you want to manage that file yourself.

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "db/schema-src",
    "outDir": "db",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "declaration": false,
    "sourceMap": false,
    "strict": true
  },
  "include": ["db/schema-src/**/*.schema.ts"]
}
```
