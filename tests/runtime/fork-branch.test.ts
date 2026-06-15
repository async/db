import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  const tenant = await db.forks.create('tenant_acme', {
    from: 'main',
    metadata: { purpose: 'tenant', plan: 'free' },
  });
  await tenant.branches.create('draft', { from: 'main', metadata: { purpose: 'draft' } });
  await tenant.branches.create('published', { from: 'main', metadata: { purpose: 'published' } });
  const draft = await tenant.branches.open('draft');
  const published = await tenant.branches.open('published');

  await draft.collection('pages').patch('home', {
    title: 'Draft Home',
    status: 'draft',
  });

  assert.deepEqual(await draft.collection('pages').all(), [
    { id: 'home', title: 'Draft Home', status: 'draft' },
  ]);
  assert.deepEqual(await published.collection('pages').all(), [
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
    metadata: { purpose: 'tenant', ownerId: 'org_acme' },
  });
  const forks = await db.forks.list();
  const savedFork = forks.find((fork: any) => fork.id === 'tenant_acme');

  assert.equal(tenant.scope.fork, 'tenant_acme');
  assert.equal(tenant.scope.branch, 'main');
  assert.equal(Object.hasOwn(savedFork, 'kind'), false);
  assert.deepEqual(savedFork.metadata, { purpose: 'tenant', ownerId: 'org_acme' });

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

test('opening forks and branches requires registered lifecycle state', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));

  const db = await openDb({ cwd });

  assert.throws(
    () => db.fork('tenant_typo'),
    (error: any) => {
      assert.equal(error.code, 'DB_FORK_NOT_FOUND');
      assert.equal(error.details.fork, 'tenant_typo');
      return true;
    },
  );

  await db.forks.create('tenant_acme', { from: 'main', metadata: { purpose: 'tenant' } });
  const tenant = db.fork('tenant_acme');
  assert.equal(tenant.branch('main').scope.branch, 'main');

  assert.throws(
    () => tenant.branch('preview_typo'),
    (error: any) => {
      assert.equal(error.code, 'DB_BRANCH_NOT_FOUND');
      assert.equal(error.details.fork, 'tenant_acme');
      assert.equal(error.details.branch, 'preview_typo');
      return true;
    },
  );
});

test('fork and branch lifecycle namespaces expose async open helpers', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    { id: 'home', title: 'Home' },
  ]));

  const db = await openDb({ cwd });
  await db.forks.create('tenant_acme', { from: 'main', metadata: { purpose: 'tenant' } });
  const tenant = await db.forks.open('tenant_acme');
  assert.equal(tenant.scope.fork, 'tenant_acme');
  assert.equal(tenant.scope.branch, 'main');

  await tenant.branches.create('draft', { from: 'main', metadata: { purpose: 'draft' } });
  const draft = await tenant.branches.open('draft');
  assert.equal(draft.scope.fork, 'tenant_acme');
  assert.equal(draft.scope.branch, 'draft');
  assert.deepEqual(await draft.collection('pages').all(), [
    { id: 'home', title: 'Home' },
  ]);

  await assert.rejects(
    () => db.forks.open('tenant_missing'),
    (error: any) => {
      assert.equal(error.code, 'DB_FORK_NOT_FOUND');
      return true;
    },
  );
  await assert.rejects(
    () => tenant.branches.open('preview_missing'),
    (error: any) => {
      assert.equal(error.code, 'DB_BRANCH_NOT_FOUND');
      return true;
    },
  );
});

test('fork and branch create reject duplicates while ensure preserves existing state', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    { id: 'home', title: 'Home' },
  ]));

  const db = await openDb({ cwd });
  const tenant = await db.forks.ensure('tenant_acme', {
    from: 'main',
    metadata: { purpose: 'tenant', ownerId: 'org_acme' },
  });
  await tenant.collection('pages').patch('home', { title: 'Tenant Home' });

  await assert.rejects(
    () => db.forks.create('tenant_acme', { from: 'main', metadata: { purpose: 'tenant' } }),
    (error: any) => {
      assert.equal(error.code, 'DB_FORK_ALREADY_EXISTS');
      assert.equal(error.details.fork, 'tenant_acme');
      return true;
    },
  );

  const ensuredTenant = await db.forks.ensure('tenant_acme', {
    from: 'main',
    metadata: { purpose: 'tenant', ownerId: 'changed' },
  });
  assert.deepEqual(await ensuredTenant.collection('pages').all(), [
    { id: 'home', title: 'Tenant Home' },
  ]);

  const draft = await ensuredTenant.branches.ensure('draft', { from: 'main', metadata: { purpose: 'draft' } });
  await draft.collection('pages').patch('home', { title: 'Draft Home' });

  await assert.rejects(
    () => ensuredTenant.branches.create('draft', { from: 'main', metadata: { purpose: 'draft' } }),
    (error: any) => {
      assert.equal(error.code, 'DB_BRANCH_ALREADY_EXISTS');
      assert.equal(error.details.fork, 'tenant_acme');
      assert.equal(error.details.branch, 'draft');
      return true;
    },
  );

  const ensuredDraft = await ensuredTenant.branches.ensure('draft', { from: 'main', metadata: { purpose: 'draft' } });
  assert.deepEqual(await ensuredDraft.collection('pages').all(), [
    { id: 'home', title: 'Draft Home' },
  ]);
});

test('branch lifecycle can list and delete non-main branches', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    { id: 'home', title: 'Home' },
  ]));

  const db = await openDb({ cwd });
  const tenant = await db.forks.ensure('tenant_acme', { from: 'main', metadata: { purpose: 'tenant' } });
  await tenant.branches.create('draft', { from: 'main', metadata: { purpose: 'draft' } });
  await tenant.branches.create('published', { from: 'main', metadata: { purpose: 'published' } });

  const branches = await tenant.branches.list();
  assert.deepEqual(branches.map((branch: any) => branch.id).sort(), [
    'draft',
    'main',
    'published',
  ]);
  assert.equal(branches.some((branch: any) => Object.hasOwn(branch, 'kind')), false);
  assert.equal(await tenant.branches.delete('draft'), true);
  assert.equal(await tenant.branches.delete('draft'), false);

  await assert.rejects(
    () => tenant.branches.open('draft'),
    (error: any) => {
      assert.equal(error.code, 'DB_BRANCH_NOT_FOUND');
      return true;
    },
  );
  await assert.rejects(
    () => tenant.branches.delete('main'),
    (error: any) => {
      assert.equal(error.code, 'DB_BRANCH_MAIN_DELETE_FORBIDDEN');
      return true;
    },
  );
});

test('fork creation rejects unsupported string sources', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));

  const db = await openDb({ cwd });

  await assert.rejects(
    () => db.forks.create('tenant_from_unknown_string', { from: 'template_free' }),
    (error: any) => {
      assert.equal(error.code, 'DB_FORK_SOURCE_UNSUPPORTED');
      assert.equal(error.details.from, 'template_free');
      return true;
    },
  );
});

test('fork creation copies from explicit fork branch and snapshot sources', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    { id: 'home', title: 'Home' },
  ]));

  const db = await openDb({ cwd });
  await db.forks.create('template_demo', { from: 'main', metadata: { purpose: 'template' } });
  const template = await db.forks.open('template_demo');
  await template.collection('pages').patch('home', { title: 'Template Home' });

  await db.forks.create('tenant_from_template', {
    from: { fork: 'template_demo', branch: 'main' },
    metadata: { purpose: 'tenant' },
  });

  const tenantFromTemplate = await db.forks.open('tenant_from_template');
  assert.deepEqual(await tenantFromTemplate.collection('pages').all(), [
    { id: 'home', title: 'Template Home' },
  ]);

  const snapshot = await template.snapshots.create({
    label: 'debug-source',
    resources: ['pages'],
  });
  await template.collection('pages').patch('home', { title: 'Changed After Snapshot' });

  await db.forks.create('tenant_from_snapshot', {
    from: { fork: 'template_demo', snapshot: snapshot.id },
    metadata: { purpose: 'debug' },
  });

  const tenantFromSnapshot = await db.forks.open('tenant_from_snapshot');
  assert.deepEqual(await tenantFromSnapshot.collection('pages').all(), [
    { id: 'home', title: 'Template Home' },
  ]);
});

test('snapshots capture and restore a fork branch resource', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
    version: 1,
  }));

  const db = await openDb({ cwd });
  await db.forks.create('tenant_acme', { from: 'main', metadata: { purpose: 'tenant' } });
  const main = await db.forks.open('tenant_acme');

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
  await db.forks.create('tenant_acme', { from: 'main', metadata: { purpose: 'tenant' } });
  const tenant = await db.forks.open('tenant_acme');

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

  const reopenedTenant = await db.forks.open('tenant_acme');
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
  await db.forks.create('tenant_acme', { from: 'main', metadata: { purpose: 'tenant' } });
  const tenant = await db.forks.open('tenant_acme');

  await tenant.migrations.start('projects-to-postgres', {
    resources: ['projects'],
    mode: 'read-only',
  });

  const reopenedTenant = await db.forks.open('tenant_acme');
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

test('migration verification can resume after reopening the db', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'projects.json', JSON.stringify([
    { id: 'p_1', name: 'Launch checklist' },
  ]));
  const targetStore = new Map<string, unknown>();
  const options = {
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
  };

  const db = await openDb(options);
  await db.forks.create('tenant_acme', { from: 'main', metadata: { purpose: 'tenant' } });
  const tenant = await db.forks.open('tenant_acme');

  await tenant.migrations.start('projects-to-paid-store', {
    resources: ['projects'],
    mode: 'read-only',
  });
  await tenant.resources.migrate('projects', {
    from: 'json',
    to: 'paidStore',
  });

  const reopened = await openDb(options);
  const reopenedTenant = await reopened.forks.open('tenant_acme');
  await reopenedTenant.migrations.verify('projects-to-paid-store', {
    resources: ['projects'],
    checks: ['count', 'checksum'],
  });
  await reopenedTenant.routing.set({ projects: 'paidStore' });
  await reopenedTenant.migrations.finish('projects-to-paid-store');

  const secondReopen = await openDb(options);
  const secondReopenedTenant = await secondReopen.forks.open('tenant_acme');
  assert.deepEqual(await secondReopenedTenant.collection('projects').all(), [
    { id: 'p_1', name: 'Launch checklist' },
  ]);
});

test('snapshots write immutable JSON manifests under fork storage', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    { id: 'home', title: 'Home' },
  ]));

  const db = await openDb({ cwd });
  await db.forks.create('tenant_acme', { from: 'main', metadata: { purpose: 'tenant' } });
  const main = await db.forks.open('tenant_acme');
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
  const tenant = await db.forks.open('tenant_acme');
  await tenant.branches.create('preview', { from: 'main' });
  const preview = await tenant.branches.open('preview');
  await preview.collection('pages').patch('home', {
    title: 'Preview Home',
  });

  assert.deepEqual(await preview.query('cms.page', { id: 'home' }), {
    id: 'home',
    title: 'Preview Home',
  });
});

test('control-plane JSON reports corruption with recovery guidance', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));

  const db = await openDb({ cwd });
  await mkdir(path.join(cwd, '.db/forks'), { recursive: true });
  await writeFile(path.join(cwd, '.db/forks/registry.json'), '{ not json', 'utf8');

  await assert.rejects(
    () => db.forks.list(),
    (error: any) => {
      assert.equal(error.code, 'JSON_STATE_INVALID');
      assert.match(error.hint, /known-good snapshot/);
      assert.equal(error.details.filePath, path.join(cwd, '.db/forks/registry.json'));
      return true;
    },
  );
});
