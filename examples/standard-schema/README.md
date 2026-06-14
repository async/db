# Standard Schema Example

## What This Teaches

Use this when a Zod, Valibot, ArkType, or local validator should own parsing and validation. Any object that implements the Standard Schema v1 contract can be the resource contract; @async/db calls `~standard.validate` during writes and layers its own metadata and computed fields on top, without bundling a validator-library dependency.

## Run It

Run it:

```bash
pnpm run db -- sync --cwd ./examples/standard-schema
pnpm run db -- serve --cwd ./examples/standard-schema
```

`db/users.schema.js` uses a small local Standard Schema-compatible validator. It lowercases email addresses during writes, exposes a Standard JSON Schema converter for field inference, and then layers Async DB metadata on top.

You can keep Async DB's object-first schema shape and mix the validator in:

```js
export default collection({
  validator: UserSchema,
  fields: {
    email: field.string({ required: true, unique: true }),
    displayName: field.computed(field.string(), ({ record }) => record.email),
  },
});
```

The validator-first shorthand is also supported when the external schema owns the field shape:

```js
export default collection(UserSchema, {
  idField: 'id',
  fields: {
    email: field.meta({ unique: true }),
    displayName: field.computed(field.string(), {
      resolveMany({ records }) {
        return new Map(records.map((record) => [
          record.id,
          `${record.firstName} ${record.lastName}`,
        ]));
      },
    }),
  },
});
```

`field.meta(...)` is for Async DB metadata such as `unique`, `description`, defaults, relations, and manifest hints. `field.computed(...)` remains the resolver entrypoint, and resolver functions are not written to generated schema or manifest output.

The validator can be async. Package API, REST, and GraphQL writes await it and store the returned `value`.

```bash
pnpm run db -- create users '{"id":"u_2","email":" GRACE@EXAMPLE.COM ","firstName":"Grace","lastName":"Hopper"}' --cwd ./examples/standard-schema
```

The stored email becomes `grace@example.com`.

`db/settings.schema.js` intentionally uses an opaque Standard Schema validator with no JSON Schema converter and no field overlay. In that case generated TypeScript falls back to a conservative index signature, and diagnostics ask you to add `field.meta(...)` overlays or provide a JSON Schema converter when you want richer generated metadata.
