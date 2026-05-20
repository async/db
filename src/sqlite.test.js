import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openJsonFixtureDb } from './index.js';
import { openSqliteJsonDb } from './sqlite.js';
import { makeProject, writeConfig, writeFixture } from '../test/helpers.js';

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

  const db = await openSqliteJsonDb({
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

  const db = await openSqliteJsonDb({
    cwd,
    file: ':memory:',
  });

  try {
    db.database.prepare('INSERT INTO "users" ("id", "name") VALUES (?, ?)').run('u_1', 'Ada Lovelace');

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
  await writeConfig(cwd, `import { sqliteStore } from 'jsondb/sqlite';

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

  const db = await openJsonFixtureDb({ cwd });
  await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });
  await db.document('settings').update({ theme: 'dark' });

  await access(path.join(cwd, '.jsondb/runtime.sqlite'));
  await assert.rejects(
    () => access(path.join(cwd, '.jsondb/state/users.json')),
    { code: 'ENOENT' },
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/settings.json'), 'utf8')), {
    theme: 'dark',
  });

  const reopened = await openJsonFixtureDb({ cwd });
  assert.deepEqual(await reopened.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
    { id: 'u_2', name: 'Grace Hopper' },
  ]);

  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_3', name: 'Katherine Johnson' },
  ]));
  const rehydrated = await openJsonFixtureDb({ cwd });
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
  await writeConfig(cwd, `import { sqliteStore } from 'jsondb/sqlite';

export default {
  resources: {
    users: {
      store: 'sqlite'
    }
  },
  stores: {
    sqlite: sqliteStore({ file: './.jsondb/custom-runtime.sqlite' })
  }
};`);

  const db = await openJsonFixtureDb({ cwd });
  await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });

  await access(path.join(cwd, '.jsondb/custom-runtime.sqlite'));
  await assert.rejects(
    () => access(path.join(cwd, '.jsondb/state/users.json')),
    { code: 'ENOENT' },
  );
});

test('sqliteStore database handle closes through JsonFixtureDb.close', async (t) => {
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
  await writeConfig(cwd, `import { sqliteStore } from 'jsondb/sqlite';

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

  const db = await openJsonFixtureDb({ cwd });
  const users = db.collection('users');
  assert.deepEqual(await users.all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
  ]);

  await db.close();

  await assert.rejects(
    () => users.all(),
    /closed|database/i,
  );

  const reopened = await openJsonFixtureDb({ cwd });
  assert.deepEqual(await reopened.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
  ]);
  await reopened.close();
});
