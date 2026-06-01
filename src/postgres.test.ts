import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openDb } from './index.js';
import { createDbOperationHandler } from './operations.js';
import { makeProject, writeConfig, writeFixture } from '../test/helpers.js';

test('postgresStore hydrates, persists, and refreshes selected resources', async () => {
  const cwd = await makeProject();
  const client = new FakePostgresClient();
  globalThis.__asyncDbPostgresClient = client;
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));
  await writeConfig(cwd, `import { postgresStore } from '@async/db/postgres';

export default {
  resources: {
    users: {
      store: 'postgres'
    }
  },
  stores: {
    postgres: postgresStore({
      client: globalThis.__asyncDbPostgresClient,
      namespace: 'test'
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
    assert.ok(client.queries.some((entry) => /CREATE TABLE IF NOT EXISTS "public"\."_async_db_resources"/.test(entry.sql)));
  } finally {
    delete globalThis.__asyncDbPostgresClient;
  }
});

test('postgresStore can close an injected client when configured', async () => {
  const cwd = await makeProject();
  const client = new FakePostgresClient();
  globalThis.__asyncDbPostgresClient = client;
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `import { postgresStore } from '@async/db/postgres';

export default {
  stores: {
    default: 'postgres',
    postgres: postgresStore({
      client: globalThis.__asyncDbPostgresClient,
      close: true
    })
  }
};`);

  try {
    const db = await openDb({ cwd });
    await db.close();

    assert.equal(client.closed, true);
  } finally {
    delete globalThis.__asyncDbPostgresClient;
  }
});

test('postgresStore mixes database resources with JSON resources behind operation refs', async () => {
  const cwd = await makeProject();
  const client = new FakePostgresClient();
  globalThis.__asyncDbPostgresClient = client;
  await writeFixture(cwd, 'featureFlags.json', JSON.stringify([
    {
      id: 'flag_billing_v2',
      key: 'billing.v2',
      enabled: true,
    },
  ]));
  await writeFixture(cwd, 'orders.json', JSON.stringify([
    {
      id: 'order_1',
      totalCents: 2500,
      status: 'paid',
    },
  ]));
  await writeConfig(cwd, `import { postgresStore } from '@async/db/postgres';

export default {
  resources: {
    featureFlags: {
      store: 'json'
    },
    orders: {
      store: 'postgres'
    }
  },
  stores: {
    default: 'json',
    postgres: postgresStore({
      client: globalThis.__asyncDbPostgresClient,
      namespace: 'mixed'
    })
  },
  operations: {
    enabled: true,
    acceptRefs: 'ref',
    registry: {
      'flags.list': {
        name: 'ListFeatureFlags',
        ref: 'flags.list',
        method: 'GET',
        path: '/feature-flags.json',
        query: {
          select: 'id,key,enabled'
        }
      },
      'orders.list': {
        name: 'ListOrders',
        ref: 'orders.list',
        method: 'GET',
        path: '/orders.json',
        query: {
          select: 'id,totalCents,status'
        }
      }
    }
  }
};`);

  try {
    const db = await openDb({ cwd });
    const operations = createDbOperationHandler(db as never);

    await db.collection('orders').create({
      id: 'order_2',
      totalCents: 4200,
      status: 'paid',
    });

    assert.deepEqual((await operations.execute('flags.list')).body, [
      {
        id: 'flag_billing_v2',
        key: 'billing.v2',
        enabled: true,
      },
    ]);
    assert.deepEqual((await operations.execute('orders.list')).body, [
      {
        id: 'order_1',
        totalCents: 2500,
        status: 'paid',
      },
      {
        id: 'order_2',
        totalCents: 4200,
        status: 'paid',
      },
    ]);

    await assert.rejects(
      () => access(path.join(cwd, '.db/state/orders.json')),
      { code: 'ENOENT' },
    );
    assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/featureFlags.json'), 'utf8')), [
      {
        id: 'flag_billing_v2',
        key: 'billing.v2',
        enabled: true,
      },
    ]);
    assert.ok(client.rows.has('mixed:orders'));
    await db.close();
  } finally {
    delete globalThis.__asyncDbPostgresClient;
  }
});

class FakePostgresClient {
  rows = new Map();
  queries = [];
  closed = false;

  async query(sql, params = []) {
    this.queries.push({ sql, params });

    if (/^CREATE (SCHEMA|TABLE)\b/.test(sql)) {
      return { rows: [] };
    }

    if (/^SELECT kind, source_hash, value FROM/.test(sql)) {
      const [namespace, name] = params;
      const row = this.rows.get(`${namespace}:${name}`);
      return { rows: row ? [structuredClone(row)] : [] };
    }

    if (/^INSERT INTO/.test(sql)) {
      const [namespace, name, kind, sourceHash, value] = params;
      this.rows.set(`${namespace}:${name}`, {
        kind,
        source_hash: sourceHash,
        value: JSON.parse(value),
      });
      return { rows: [] };
    }

    throw new Error(`Unhandled fake Postgres query: ${sql}`);
  }

  async end() {
    this.closed = true;
  }
}
