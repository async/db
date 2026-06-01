import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openDb } from './index.js';
import { makeProject, writeConfig, writeFixture } from '../test/helpers.js';

test('kvStore hydrates, persists, and refreshes selected resources', async () => {
  const cwd = await makeProject();
  const client = new FakeKvClient();
  globalThis.__asyncDbKvClient = client;
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));
  await writeConfig(cwd, `import { kvStore } from '@async/db/kv';

export default {
  resources: {
    users: {
      store: 'kv'
    }
  },
  stores: {
    kv: kvStore({
      client: globalThis.__asyncDbKvClient,
      prefix: 'test:'
    })
  }
};`);

  try {
    const db = await openDb({ cwd });
    await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });
    await db.document('settings').update({ theme: 'dark' });
    await db.close();

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
    await reopened.close();

    await writeFixture(cwd, 'users.json', JSON.stringify([
      { id: 'u_3', name: 'Katherine Johnson' },
    ]));
    const rehydrated = await openDb({ cwd });
    assert.deepEqual(await rehydrated.collection('users').all(), [
      { id: 'u_3', name: 'Katherine Johnson' },
    ]);
    await rehydrated.close();

    assert.equal(client.closed, false);
    assert.equal(client.values.has('test:users'), true);
  } finally {
    delete globalThis.__asyncDbKvClient;
  }
});

test('redisStore is a Redis-named KV helper and can close the injected client', async () => {
  const cwd = await makeProject();
  const client = new FakeKvClient();
  globalThis.__asyncDbRedisClient = client;
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `import { redisStore } from '@async/db/redis';

export default {
  stores: {
    default: 'redis',
    redis: redisStore({
      client: globalThis.__asyncDbRedisClient,
      close: true
    })
  }
};`);

  try {
    const db = await openDb({ cwd });
    assert.deepEqual(await db.collection('users').all(), [
      { id: 'u_1', name: 'Ada Lovelace' },
    ]);
    await db.close();

    assert.equal(client.closed, true);
  } finally {
    delete globalThis.__asyncDbRedisClient;
  }
});

class FakeKvClient {
  values = new Map();
  closed = false;

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async set(key, value) {
    this.values.set(key, value);
  }

  async close() {
    this.closed = true;
  }
}
