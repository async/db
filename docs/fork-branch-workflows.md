# Fork And Branch Workflows

`@async/db` treats forks and branches as generic database lifecycle primitives. App code gives those primitives business meaning.

## Concepts

- `fork`: isolated logical database instance, useful for tenants, sandboxes, templates, demos, and prod-debug copies.
- `branch`: named data line inside one fork, useful for `main`, `draft`, `published`, previews, migrations, and debug work.
- `snapshot`: immutable captured state of a fork branch.
- `migration`: app-controlled move of one resource from one store to another.

The default root database already points at `main`, so simple apps can call resources and operations directly:

```js
await db.query('projects.list');
await db.collection('projects').all();
```

When an app has tenants or sandboxes, open or ensure the fork. A fork handle starts on its default `main` branch, so most app code does not need to mention `branch('main')`:

```js
const tenant = await db.forks.ensure('tenant_acme', {
  from: 'main',
  kind: 'tenant',
});

await tenant.query('projects.list');
```

Open named branches only when you intentionally leave `main`:

```js
const draft = await tenant.branches.open('draft');

await draft.query('projects.list');
```

## Free Plan To Paid Store

The app decides what "paid" means. `@async/db` only moves resources and switches routing:

```js
export async function upgradeTenantToPaid({ tenantId }) {
  const tenant = await db.forks.open(tenantId);

  const backup = await tenant.snapshots.create({
    label: 'before-paid-upgrade',
    resources: ['projects'],
  });

  await tenant.migrations.start('projects-to-postgres', {
    resources: ['projects'],
    mode: 'read-only',
  });

  await tenant.resources.migrate('projects', {
    from: 'json',
    to: 'postgres',
  });

  await tenant.migrations.verify('projects-to-postgres', {
    resources: ['projects'],
    checks: ['count', 'checksum'],
  });

  await tenant.routing.set({
    projects: 'postgres',
  });

  await tenant.migrations.finish('projects-to-postgres');
  return backup;
}
```

Before cutover, JSON is the live store. After cutover, Postgres is live and the JSON snapshot is backup/export data.

## Prod Debug Snapshot

Debugging a production issue should not mutate production data:

```js
export async function createDebugForkFromSnapshot({ snapshotId, ticketId }) {
  return db.forks.create(`debug_${ticketId}`, {
    from: { snapshot: snapshotId },
    kind: 'debug',
    metadata: {
      ticketId,
      ttl: '24h',
    },
  });
}
```

The debug fork can run destructive reproductions, then be deleted.

## Other App-Owned Patterns

- Feature flag preview: branch flag resources, test rollout behavior, then promote.
- Settings rollback: snapshot settings before admin edits and restore if needed.
- Pricing plan staging: edit plan resources on a branch before publishing.
- Policy rule sandbox: branch permission rules and run access-decision tests.
- Prompt template experiment: compare generated outputs across prompt branches.
- Seed/demo template: create tenant forks from a template fork with `from: { fork: 'demo_template', branch: 'main' }`.
- Forked test environment: create a temporary fork, run destructive tests, delete it.

These helpers should live in app code. The package only owns the generic database lifecycle APIs.
