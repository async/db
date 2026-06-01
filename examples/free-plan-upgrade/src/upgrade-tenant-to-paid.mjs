import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '@async/db';

const paidStoreData = new Map();

export async function openUpgradeDemoDb() {
  return openDb({
    cwd: new URL('../', import.meta.url).pathname,
    stores: {
      default: 'json',
      paidPostgres: {
        read(resource, fallback) {
          return paidStoreData.has(resource.name) ? paidStoreData.get(resource.name) : fallback;
        },
        write(resource, value) {
          paidStoreData.set(resource.name, value);
        },
      },
    },
  });
}

export async function upgradeTenantToPaid({ db, tenantId }) {
  await db.forks.create(tenantId, {
    from: 'main',
    kind: 'tenant',
    metadata: {
      plan: 'free',
    },
  });

  const tenant = db.fork(tenantId).branch('main');
  const backup = await tenant.snapshots.create({
    label: 'before-paid-upgrade',
    resources: ['projects'],
  });

  await tenant.migrations.start('projects-to-paid-postgres', {
    resources: ['projects'],
    mode: 'read-only',
  });

  await tenant.resources.migrate('projects', {
    from: 'json',
    to: 'paidPostgres',
  });

  await tenant.migrations.verify('projects-to-paid-postgres', {
    resources: ['projects'],
    checks: ['count', 'checksum'],
  });

  await tenant.routing.set({
    projects: 'paidPostgres',
  });

  await tenant.migrations.finish('projects-to-paid-postgres');

  return {
    tenant,
    backup,
  };
}

async function main() {
  const db = await openUpgradeDemoDb();
  const { tenant, backup } = await upgradeTenantToPaid({
    db,
    tenantId: 'tenant_acme',
  });

  assert.equal(backup.resources.includes('projects'), true);
  assert.deepEqual(await tenant.collection('projects').all(), [
    {
      id: 'p_1',
      name: 'Launch checklist',
      status: 'active',
    },
  ]);

  await tenant.collection('projects').create({
    id: 'p_2',
    name: 'Paid workspace project',
    status: 'active',
  });

  assert.deepEqual(paidStoreData.get('projects'), [
    {
      id: 'p_1',
      name: 'Launch checklist',
      status: 'active',
    },
    {
      id: 'p_2',
      name: 'Paid workspace project',
      status: 'active',
    },
  ]);

  await db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
