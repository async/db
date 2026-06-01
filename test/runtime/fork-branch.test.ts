import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openDb as typedOpenDb } from '../../src/index.js';
import { makeProject, writeFixture } from '../helpers.js';

const openDb = async (options: unknown): Promise<any> => typedOpenDb(options as never) as Promise<any>;

test('fork branches isolate JSON resource state', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    { id: 'home', title: 'Home', status: 'published' },
  ]));

  const db = await openDb({ cwd });
  await db.forks.create('tenant_acme', {
    from: 'main',
    kind: 'tenant',
    metadata: { plan: 'free' },
  });
  const tenant = db.fork('tenant_acme');
  await tenant.branches.create('draft', { from: 'main', kind: 'draft' });
  await tenant.branches.create('published', { from: 'main', kind: 'published' });

  await tenant.branch('draft').collection('pages').patch('home', {
    title: 'Draft Home',
    status: 'draft',
  });

  assert.deepEqual(await tenant.branch('draft').collection('pages').all(), [
    { id: 'home', title: 'Draft Home', status: 'draft' },
  ]);
  assert.deepEqual(await tenant.branch('published').collection('pages').all(), [
    { id: 'home', title: 'Home', status: 'published' },
  ]);
});

test('fork metadata and scope validation use structured errors', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));

  const db = await openDb({ cwd });
  const tenant = await db.forks.create('tenant_acme', {
    from: 'main',
    kind: 'tenant',
    metadata: { ownerId: 'org_acme' },
  });
  const forks = await db.forks.list();
  const savedFork = forks.find((fork: any) => fork.id === 'tenant_acme');

  assert.equal(tenant.scope.fork, 'tenant_acme');
  assert.equal(tenant.scope.branch, 'main');
  assert.equal(savedFork.kind, 'tenant');
  assert.deepEqual(savedFork.metadata, { ownerId: 'org_acme' });

  await assert.rejects(
    () => db.forks.create('../bad'),
    (error: any) => {
      assert.equal(error.code, 'DB_SCOPE_NAME_INVALID');
      assert.equal(error.details.kind, 'fork');
      return true;
    },
  );
  assert.throws(
    () => db.branch('draft'),
    (error: any) => {
      assert.equal(error.code, 'DB_BRANCH_REQUIRES_FORK');
      return true;
    },
  );
});

test('snapshots capture and restore a fork branch resource', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
    version: 1,
  }));

  const db = await openDb({ cwd });
  await db.forks.create('tenant_acme', { from: 'main', kind: 'tenant' });
  const main = db.fork('tenant_acme').branch('main');

  const snapshot = await main.snapshots.create({
    label: 'before-settings-change',
    resources: ['settings'],
  });

  await main.document('settings').update({ theme: 'dark', version: 2 });
  assert.deepEqual(await main.document('settings').all(), {
    theme: 'dark',
    version: 2,
  });

  await main.snapshots.restore(snapshot.id, { resources: ['settings'] });

  assert.deepEqual(await main.document('settings').all(), {
    theme: 'light',
    version: 1,
  });
});

test('resource migrations lock writes, copy to another store, verify, and switch routing', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'projects.json', JSON.stringify([
    { id: 'p_1', name: 'Launch checklist' },
  ]));
  const targetStore = new Map<string, unknown>();

  const db = await openDb({
    cwd,
    stores: {
      default: 'json',
      paidStore: {
        read(resource: { name: string }, fallback: unknown) {
          return targetStore.has(resource.name) ? targetStore.get(resource.name) : fallback;
        },
        write(resource: { name: string }, value: unknown) {
          targetStore.set(resource.name, value);
        },
      },
    },
  });
  await db.forks.create('tenant_acme', { from: 'main', kind: 'tenant' });
  const tenant = db.fork('tenant_acme').branch('main');

  await tenant.migrations.start('projects-to-paid-store', {
    resources: ['projects'],
    mode: 'read-only',
  });

  await assert.rejects(
    () => tenant.collection('projects').create({ id: 'p_2', name: 'Blocked write' }),
    (error: any) => {
      assert.equal(error.code, 'RESOURCE_MIGRATING');
      assert.equal(error.details.resource, 'projects');
      assert.equal(error.details.migration, 'projects-to-paid-store');
      return true;
    },
  );

  await tenant.resources.migrate('projects', {
    from: 'json',
    to: 'paidStore',
  });
  await tenant.migrations.verify('projects-to-paid-store', {
    resources: ['projects'],
    checks: ['count', 'checksum'],
  });
  await tenant.routing.set({
    projects: 'paidStore',
  });
  await tenant.migrations.finish('projects-to-paid-store');

  const reopenedTenant = db.fork('tenant_acme').branch('main');
  assert.deepEqual(targetStore.get('projects'), [
    { id: 'p_1', name: 'Launch checklist' },
  ]);
  assert.deepEqual(await reopenedTenant.collection('projects').all(), [
    { id: 'p_1', name: 'Launch checklist' },
  ]);
  await reopenedTenant.collection('projects').create({ id: 'p_2', name: 'Paid project' });
  assert.deepEqual(targetStore.get('projects'), [
    { id: 'p_1', name: 'Launch checklist' },
    { id: 'p_2', name: 'Paid project' },
  ]);

  await db.collection('projects').create({ id: 'p_root', name: 'Root project stays JSON' });
  assert.deepEqual(targetStore.get('projects'), [
    { id: 'p_1', name: 'Launch checklist' },
    { id: 'p_2', name: 'Paid project' },
  ]);
});

test('migration read-only locks apply to fresh branch handles', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'projects.json', JSON.stringify([
    { id: 'p_1', name: 'Launch checklist' },
  ]));

  const db = await openDb({ cwd });
  await db.forks.create('tenant_acme', { from: 'main', kind: 'tenant' });
  const tenant = db.fork('tenant_acme').branch('main');

  await tenant.migrations.start('projects-to-postgres', {
    resources: ['projects'],
    mode: 'read-only',
  });

  const reopenedTenant = db.fork('tenant_acme').branch('main');
  await assert.rejects(
    () => reopenedTenant.collection('projects').create({ id: 'p_2', name: 'Blocked write' }),
    (error: any) => {
      assert.equal(error.code, 'RESOURCE_MIGRATING');
      assert.equal(error.details.resource, 'projects');
      assert.equal(error.details.migration, 'projects-to-postgres');
      return true;
    },
  );
});

test('snapshots write immutable JSON manifests under fork storage', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    { id: 'home', title: 'Home' },
  ]));

  const db = await openDb({ cwd });
  await db.forks.create('tenant_acme', { from: 'main', kind: 'tenant' });
  const main = db.fork('tenant_acme').branch('main');
  const snapshot = await main.snapshots.create({
    label: 'before-publish',
    resources: ['pages'],
  });

  const manifestPath = path.join(
    cwd,
    '.db/forks/tenant_acme/snapshots',
    snapshot.id,
    'manifest.json',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  assert.equal(manifest.label, 'before-publish');
  assert.equal(manifest.fork, 'tenant_acme');
  assert.equal(manifest.branch, 'main');
  assert.deepEqual(manifest.resources, ['pages']);
});

test('fork branch query executes registered operations against branch state', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    { id: 'home', title: 'Home' },
  ]));

  const db = await openDb({
    cwd,
    operations: {
      enabled: true,
      registry: {
        'cms.page': {
          name: 'GetCmsPage',
          ref: 'cms.page',
          method: 'GET',
          path: '/pages/{id}.json',
        },
      },
    },
  });
  await db.forks.create('tenant_acme', { from: 'main' });
  const tenant = db.fork('tenant_acme');
  await tenant.branches.create('preview', { from: 'main' });
  await tenant.branch('preview').collection('pages').patch('home', {
    title: 'Preview Home',
  });

  assert.deepEqual(await tenant.branch('preview').query('cms.page', { id: 'home' }), {
    id: 'home',
    title: 'Preview Home',
  });
});
