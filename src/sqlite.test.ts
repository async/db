import assert from 'node:assert/strict';
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openDb } from './index.js';
import { openSqliteDb, sqliteStore } from './sqlite.js';
import { adaptSqliteDatabase, compoundKeyId, openCompatSqlite, openLegacySqlite, runSqliteImportPlan } from './sqlite-compat.js';
import { makeProject, writeConfig, writeFixture } from '../tests/helpers.js';

test('SQLite adapter supports collection and document CRUD when node:sqlite is available', async (t) => {
  try {
    await import('node:sqlite');
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return;
  }

  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      },
      "active": {
        "type": "boolean",
        "default": true
      },
      "profile": {
        "type": "object"
      }
    },
    "seed": []
  }`);
  await writeFixture(cwd, 'chart-mappings.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": []
  }`);
  await writeFixture(cwd, 'settings.schema.jsonc', `{
    "kind": "document",
    "fields": {
      "theme": {
        "type": "string",
        "default": "light"
      }
    },
    "seed": {}
  }`);

  const db = await openSqliteDb({
    cwd,
    file: ':memory:',
  });

  try {
    const created = await db.collection('users').create({
      name: 'Ada Lovelace',
      profile: {
        title: 'Mathematician',
      },
    });
    assert.deepEqual(created, {
      id: '1',
      name: 'Ada Lovelace',
      role: 'user',
      active: true,
      profile: {
        title: 'Mathematician',
      },
    });

    assert.deepEqual(await db.collection('users').get('1'), created);
    assert.equal(await db.collection('users').exists('1'), true);
    assert.equal(await db.collection('users').exists('missing'), false);
    assert.deepEqual(await db.collection('chart-mappings').create({
      id: 'mapping_1',
      name: 'Default',
    }), {
      id: 'mapping_1',
      name: 'Default',
    });
    assert.equal((await db.collection('chartMappings').get('mapping_1')).name, 'Default');

    await assert.rejects(
      () => db.collection('users').create({
        name: 'Grace Hopper',
        role: 'owner',
      }),
      /expected one of/,
    );

    assert.deepEqual(await db.document('settings').put({}), {});
    assert.deepEqual(await db.document('settings').all(), {});
  } finally {
    db.close();
  }
});

test('SQLite adapter updates do not backfill omitted schema defaults', async (t) => {
  try {
    await import('node:sqlite');
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return;
  }

  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      },
      "active": {
        "type": "boolean",
        "default": true
      }
    },
    "seed": []
  }`);

  const db = await openSqliteDb({
    cwd,
    file: ':memory:',
  });

  try {
    (await db.database.prepare('INSERT INTO "users" ("id", "name") VALUES (?, ?)')).run('u_1', 'Ada Lovelace');

    const users = db.collection('users');
    const updated = await users.patch('u_1', {
      name: 'Ada Byron',
    });
    const created = await users.create({
      id: 'u_2',
      name: 'Grace Hopper',
    });

    assert.deepEqual(updated, {
      id: 'u_1',
      name: 'Ada Byron',
    });
    assert.deepEqual(await users.get('u_1'), {
      id: 'u_1',
      name: 'Ada Byron',
    });
    assert.deepEqual(created, {
      id: 'u_2',
      name: 'Grace Hopper',
      role: 'user',
      active: true,
    });
  } finally {
    db.close();
  }
});

test('openSqliteDb maps existing SQLite tables without relocating the database', async (t) => {
  let DatabaseSync;
  try {
    DatabaseSync = ((await import('node:sqlite')) as any).DatabaseSync;
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return;
  }

  const cwd = await makeProject();
  const sqliteFile = path.join(cwd, 'data/app.sqlite');
  await mkdir(path.dirname(sqliteFile), { recursive: true });
  const database = new DatabaseSync(sqliteFile);
  try {
    database.exec(`
      CREATE TABLE app_users (
        user_id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        active INTEGER NOT NULL
      ) STRICT;
      CREATE VIEW active_users AS
        SELECT user_id, full_name, active FROM app_users WHERE active = 1;
      INSERT INTO app_users (user_id, full_name, active) VALUES ('u_1', 'Ada Lovelace', 1);
    `);
  } finally {
    database.close();
  }

  const project = {
    resources: [
      {
        name: 'users',
        kind: 'collection',
        idField: 'id',
        fields: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          active: { type: 'boolean', required: true },
        },
      },
      {
        name: 'activeUsers',
        kind: 'collection',
        idField: 'id',
        fields: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          active: { type: 'boolean', required: true },
        },
      },
    ],
  };

  const db = await openSqliteDb({
    cwd,
    file: sqliteFile,
    migrate: false,
    project,
    tables: {
      users: {
        table: 'app_users',
        columns: {
          id: 'user_id',
          name: 'full_name',
        },
        primaryKey: 'id',
      },
      activeUsers: {
        table: 'active_users',
        columns: {
          id: 'user_id',
          name: 'full_name',
        },
        primaryKey: 'id',
        readOnly: true,
      },
    },
  });

  try {
    assert.deepEqual(await db.table('users').get('u_1'), {
      id: 'u_1',
      name: 'Ada Lovelace',
      active: true,
    });
    assert.deepEqual(await db.table('activeUsers').all(), [
      {
        id: 'u_1',
        name: 'Ada Lovelace',
        active: true,
      },
    ]);

    await db.table('users').create({
      id: 'u_2',
      name: 'Grace Hopper',
      active: false,
    });
    assert.deepEqual(await db.table('users').patch('u_2', { active: true }), {
      id: 'u_2',
      name: 'Grace Hopper',
      active: true,
    });

    await assert.rejects(
      () => db.table('activeUsers').create({
        id: 'u_3',
        name: 'Katherine Johnson',
        active: true,
      }),
      /read-only/,
    );
    await assert.rejects(
      () => access(path.join(cwd, '.db/sqlite/db.sqlite')),
      { code: 'ENOENT' },
    );
  } finally {
    db.close();
  }

  const reopened = new DatabaseSync(sqliteFile);
  try {
    assert.equal(reopened.prepare('SELECT full_name FROM app_users WHERE user_id = ?').get('u_2').full_name, 'Grace Hopper');
  } finally {
    reopened.close();
  }
});

test('openSqliteDb supports injected handles and compound object keys', async (t) => {
  let DatabaseSync;
  try {
    DatabaseSync = ((await import('node:sqlite')) as any).DatabaseSync;
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return;
  }

  const cwd = await makeProject();
  const sqliteFile = path.join(cwd, 'data/app.sqlite');
  await mkdir(path.dirname(sqliteFile), { recursive: true });
  const database = new DatabaseSync(sqliteFile);
  database.exec(`
    CREATE TABLE package_versions (
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (name, version)
    ) STRICT;
    INSERT INTO package_versions (name, version, status)
      VALUES ('@async/db', '0.4.0', 'allowed');
  `);

  const db = await openSqliteDb({
    cwd,
    database,
    migrate: false,
    project: {
      resources: [
        {
          name: 'packageVersions',
          kind: 'collection',
          fields: {
            name: { type: 'string', required: true },
            version: { type: 'string', required: true },
            status: { type: 'string', required: true },
          },
        },
      ],
    },
    tables: {
      packageVersions: {
        table: 'package_versions',
        primaryKey: ['name', 'version'],
      },
    },
  });

  try {
    const key = { name: '@async/db', version: '0.4.0' };
    assert.deepEqual(await db.table('packageVersions').get(key), {
      name: '@async/db',
      version: '0.4.0',
      status: 'allowed',
    });
    assert.deepEqual(await db.table('packageVersions').patch(key, { status: 'blocked' }), {
      name: '@async/db',
      version: '0.4.0',
      status: 'blocked',
    });
    assert.deepEqual(await db.table('packageVersions').create({
      name: '@async/db',
      version: '0.4.1',
      status: 'allowed',
    }), {
      name: '@async/db',
      version: '0.4.1',
      status: 'allowed',
    });
    assert.equal(await db.table('packageVersions').delete({ name: '@async/db', version: '0.4.1' }), true);
    await assert.rejects(
      () => db.table('packageVersions').get('@async/db'),
      /requires key fields name, version/,
    );

    db.close();
    assert.equal(database.prepare('SELECT status FROM package_versions WHERE name = ? AND version = ?').get('@async/db', '0.4.0').status, 'blocked');
  } finally {
    database.close();
  }
});

test('SQLite table-backed collections support query helpers and append-only resources', async (t) => {
  let DatabaseSync;
  try {
    DatabaseSync = ((await import('node:sqlite')) as any).DatabaseSync;
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return;
  }

  const cwd = await makeProject();
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE install_events (
      id INTEGER PRIMARY KEY,
      decision TEXT NOT NULL,
      bytes REAL
    ) STRICT;
    INSERT INTO install_events (id, decision, bytes) VALUES (1, 'allow', 100), (2, 'block', 50), (3, 'allow', 25);
  `);

  const db = await openSqliteDb({
    cwd,
    database,
    migrate: false,
    closeDatabase: false,
    project: {
      resources: [
        {
          name: 'installEvents',
          kind: 'collection',
          idField: 'id',
          writePolicy: 'append-only',
          fields: {
            id: { type: 'number', required: true },
            decision: { type: 'string', required: true },
            bytes: { type: 'number' },
          },
        },
      ],
    },
    tables: {
      installEvents: {
        table: 'install_events',
        primaryKey: 'id',
      },
    },
  });

  try {
    const events = db.table('installEvents');
    assert.deepEqual(await events.find({ where: { decision: 'allow' }, orderBy: '-bytes' }), [
      { id: 1, decision: 'allow', bytes: 100 },
      { id: 3, decision: 'allow', bytes: 25 },
    ]);
    assert.equal(await events.count({ where: { bytes: { lt: 100 } } }), 2);
    assert.deepEqual(await events.aggregate({
      groupBy: 'decision',
      metrics: {
        count: 'count',
        bytes: { op: 'sum', field: 'bytes' },
      },
      orderBy: 'decision',
    }), [
      { decision: 'allow', count: 2, bytes: 125 },
      { decision: 'block', count: 1, bytes: 50 },
    ]);
    assert.deepEqual(await events.append({ id: 4, decision: 'allow', bytes: 10 }), {
      id: 4,
      decision: 'allow',
      bytes: 10,
    });
    await assert.rejects(() => events.create({ id: 5, decision: 'block', bytes: 1 }), /append-only/);
    await assert.rejects(() => events.patch(1, { decision: 'block' }), /append-only/);
    await assert.rejects(() => events.delete(1), /append-only/);
  } finally {
    db.close();
    database.close();
  }
});

test('SQLite compat adapts low-level driver handles and compound keys', async () => {
  const preparedHandle = {
    execCalls: [] as string[],
    exec(sql: string) {
      this.execCalls.push(sql);
    },
    prepare(sql: string) {
      return {
        get(value: unknown) {
          return { id: value, sql };
        },
        all() {
          return [{ id: 'u_1', name: 'Ada' }];
        },
        run() {
          return { changes: 1, lastInsertRowid: 2 };
        },
      };
    },
    close() {},
  };
  const adaptedPrepared = adaptSqliteDatabase(preparedHandle, { driver: 'better-sqlite3' });
  assert.deepEqual(await (await adaptedPrepared.prepare('SELECT * FROM users')).all(), [
    { id: 'u_1', name: 'Ada' },
  ]);
  assert.deepEqual(await (await adaptedPrepared.prepare('SELECT * FROM users WHERE id = ?')).get('u_1'), {
    id: 'u_1',
    sql: 'SELECT * FROM users WHERE id = ?',
  });
  assert.equal(compoundKeyId(['name', 'version'], { name: '@async/db', version: '0.4.2' }), '%40async%2Fdb@0.4.2');

  const asyncHandle = {
    async all(sql: string, value: unknown) {
      return [{ id: value, sql }];
    },
    async get(sql: string, value: unknown) {
      return { id: value, sql };
    },
    async run() {
      return { changes: 1, lastID: 3 };
    },
    async exec() {},
    async close() {},
  };
  const adaptedAsync = adaptSqliteDatabase(asyncHandle, { driver: 'sqlite' });
  assert.deepEqual(await (await adaptedAsync.prepare('SELECT * FROM users WHERE id = ?')).all('u_2'), [
    { id: 'u_2', sql: 'SELECT * FROM users WHERE id = ?' },
  ]);
});

test('openLegacySqlite uses injected compat handles without migrating schemas', async () => {
  const cwd = await makeProject();
  const database = adaptSqliteDatabase({
    exec() {
      throw new Error('migrate should not run');
    },
    prepare() {
      return {
        get() {
          return undefined;
        },
        all() {
          return [{ id: 'u_1', name: 'Ada' }];
        },
        run() {
          throw new Error('writes should not run');
        },
      };
    },
    close() {},
  }, { driver: 'node:sqlite' });

  const db = await openLegacySqlite({
    cwd,
    file: ':memory:',
    database,
    project: {
      resources: [
        {
          name: 'users',
          kind: 'collection',
          idField: 'id',
          fields: {
            id: { type: 'string', required: true },
            name: { type: 'string', required: true },
          },
        },
      ],
    },
    tables: {
      users: 'users',
    },
  });

  assert.deepEqual(await db.table('users').all(), [
    { id: 'u_1', name: 'Ada' },
  ]);
});

test('runSqliteImportPlan applies legacy rows into an Async DB-owned SQLite state file', async (t) => {
  let DatabaseSync: any;
  try {
    ({ DatabaseSync } = await import('node:sqlite') as any);
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return;
  }

  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'data'), { recursive: true });
  const legacyFile = path.join(cwd, 'data/local-registry.sqlite');
  const legacy = new DatabaseSync(legacyFile);
  legacy.exec(`
    CREATE TABLE package_versions (
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (name, version)
    );
    INSERT INTO package_versions (name, version, status) VALUES ('@async/db', '0.4.2', 'allowed');

    CREATE TABLE install_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_name TEXT NOT NULL,
      decision TEXT NOT NULL
    );
    INSERT INTO install_events (package_name, decision) VALUES ('@async/db', 'allowed');

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    INSERT INTO settings (key, value) VALUES ('registry', '"https://registry.npmjs.org"');
  `);
  legacy.close();

  await writeFixture(cwd, 'packageVersions.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "version": { "type": "string", "required": true },
      "status": { "type": "string", "required": true }
    },
    "seed": []
  }`);
  await writeFixture(cwd, 'installEvents.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "writePolicy": "append-only",
    "fields": {
      "id": { "type": "number", "required": true },
      "package_name": { "type": "string", "required": true },
      "decision": { "type": "string", "required": true }
    },
    "seed": []
  }`);
  await writeFixture(cwd, 'settings.schema.jsonc', `{
    "kind": "document",
    "fields": {
      "registry": { "type": "string" }
    },
    "seed": {}
  }`);

  const importPlan: Parameters<typeof runSqliteImportPlan>[0] = {
    version: 1,
    kind: 'sqlite.importPlan',
    source: {
      sqliteFile: 'data/local-registry.sqlite',
      driver: 'node:sqlite',
    },
    target: {
      stateFile: 'data/local-registry.asyncdb',
    },
    resources: [
      {
        resource: 'packageVersions',
        table: 'package_versions',
        kind: 'collection',
        importKind: 'collection',
        primaryKey: ['name', 'version'],
        idField: 'id',
        fields: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          version: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
        keyStrategy: { kind: 'compound-generated-id', fields: ['name', 'version'], idField: 'id' },
      },
      {
        resource: 'installEvents',
        table: 'install_events',
        kind: 'collection',
        importKind: 'append-only',
        primaryKey: ['id'],
        idField: 'id',
        writePolicy: 'append-only',
        fields: {
          id: { type: 'number', required: true },
          package_name: { type: 'string', required: true },
          decision: { type: 'string', required: true },
        },
        keyStrategy: { kind: 'append-only', idField: 'id' },
      },
      {
        resource: 'settings',
        table: 'settings',
        kind: 'document',
        importKind: 'document',
        primaryKey: ['key'],
        fields: {
          key: { type: 'string', required: true },
          value: { type: 'string' },
        },
        keyStrategy: { kind: 'key-value-document', keyField: 'key', valueField: 'value' },
      },
    ],
  };
  const dryRun = await runSqliteImportPlan(importPlan, { cwd });

  assert.equal(dryRun.applied, false);
  assert.deepEqual(dryRun.resources.map((resource) => [resource.resource, resource.rows]), [
    ['packageVersions', 1],
    ['installEvents', 1],
    ['settings', 1],
  ]);

  const applied = await runSqliteImportPlan(importPlan, { cwd, apply: true });

  assert.equal(applied.applied, true);
  const db = await openDb({
    cwd,
    stores: {
      default: 'sqlite',
      sqlite: sqliteStore({ file: 'data/local-registry.asyncdb' }),
    },
  });
  assert.deepEqual(await db.collection('packageVersions').all(), [
    {
      id: '%40async%2Fdb@0.4.2',
      name: '@async/db',
      version: '0.4.2',
      status: 'allowed',
    },
  ]);
  assert.deepEqual(await db.collection('installEvents').all(), [
    {
      id: 1,
      package_name: '@async/db',
      decision: 'allowed',
    },
  ]);
  assert.deepEqual(await db.document('settings').all(), {
    registry: 'https://registry.npmjs.org',
  });
  await db.close();
});

test('openCompatSqlite reports missing optional drivers clearly', async () => {
  await assert.rejects(
    () => openCompatSqlite({ driver: 'better-sqlite3', file: ':memory:' }),
    (error: any) => {
      assert.equal(error.code, 'SQLITE_COMPAT_DRIVER_UNAVAILABLE');
      assert.match(error.hint, /Install "better-sqlite3"/);
      return true;
    },
  );
});

test('sqliteStore registers through stores config and coexists with json store', async (t) => {
  try {
    await import('node:sqlite');
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return;
  }

  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));
  await writeConfig(cwd, `import { sqliteStore } from '@async/db/sqlite';

export default {
  resources: {
    users: {
      store: 'sqlite'
    }
  },
  stores: {
    sqlite: sqliteStore()
  }
};`);

  const db = await openDb({ cwd });
  await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });
  await db.document('settings').update({ theme: 'dark' });

  await access(path.join(cwd, '.db/runtime.sqlite'));
  await assert.rejects(
    () => access(path.join(cwd, '.db/state/users.json')),
    { code: 'ENOENT' },
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/settings.json'), 'utf8')), {
    theme: 'dark',
  });

  const reopened = await openDb({ cwd });
  assert.deepEqual(await reopened.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
    { id: 'u_2', name: 'Grace Hopper' },
  ]);

  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_3', name: 'Katherine Johnson' },
  ]));
  const rehydrated = await openDb({ cwd });
  assert.deepEqual(await rehydrated.collection('users').all(), [
    { id: 'u_3', name: 'Katherine Johnson' },
  ]);
});

test('sqliteStore resolves explicit relative file paths from the project cwd', async (t) => {
  try {
    await import('node:sqlite');
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return;
  }

  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `import { sqliteStore } from '@async/db/sqlite';

export default {
  resources: {
    users: {
      store: 'sqlite'
    }
  },
  stores: {
    sqlite: sqliteStore({ file: './.db/custom-runtime.sqlite' })
  }
};`);

  const db = await openDb({ cwd });
  await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });

  await access(path.join(cwd, '.db/custom-runtime.sqlite'));
  await assert.rejects(
    () => access(path.join(cwd, '.db/state/users.json')),
    { code: 'ENOENT' },
  );
});

test('sqliteStore database handle closes through Db.close', async (t) => {
  try {
    await import('node:sqlite');
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return;
  }

  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `import { sqliteStore } from '@async/db/sqlite';

export default {
  resources: {
    users: {
      store: 'sqlite'
    }
  },
  stores: {
    sqlite: sqliteStore()
  }
};`);

  const db = await openDb({ cwd });
  const users = db.collection('users');
  assert.deepEqual(await users.all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
  ]);

  await db.close();

  await assert.rejects(
    () => users.all(),
    /closed|database/i,
  );

  const reopened = await openDb({ cwd });
  assert.deepEqual(await reopened.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
  ]);
  await reopened.close();
});
