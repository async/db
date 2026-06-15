import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openDb } from './index.js';
import { createDbOperationHandler } from './operations.js';
import { openPostgresDb } from './postgres.js';
import { adaptPostgresClient, compoundKeyId, runPostgresImportPlan, type PostgresImportPlan } from './postgres-compat.js';
import { makeProject, writeConfig, writeFixture } from '../tests/helpers.js';

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

test('openPostgresDb maps existing tables with column mapping and compound object keys', async () => {
  const cwd = await makeProject();
  const client = new FakePostgresTableClient({
    'public.package_versions': [
      {
        package_name: '@async/db',
        package_version: '0.5.1',
        status: 'allowed',
        request_count: 2,
      },
      {
        package_name: 'blocked-lib',
        package_version: '1.0.0',
        status: 'blocked',
        request_count: 5,
      },
    ],
  });
  const db = await openPostgresDb({
    cwd,
    client,
    migrate: false,
    project: {
      resources: [
        {
          name: 'packages',
          kind: 'collection',
          fields: {
            name: { type: 'string', required: true },
            version: { type: 'string', required: true },
            status: { type: 'string' },
            requestCount: { type: 'number' },
          },
        },
      ],
    },
    tables: {
      packages: {
        schema: 'public',
        table: 'package_versions',
        primaryKey: ['name', 'version'],
        columns: {
          name: 'package_name',
          version: 'package_version',
          requestCount: 'request_count',
        },
      },
    },
  });

  assert.deepEqual(await db.table('packages').get({ name: '@async/db', version: '0.5.1' }), {
    name: '@async/db',
    version: '0.5.1',
    status: 'allowed',
    requestCount: 2,
  });
  assert.deepEqual(await db.table('packages').find({
    where: { status: 'blocked' },
  }), [
    {
      name: 'blocked-lib',
      version: '1.0.0',
      status: 'blocked',
      requestCount: 5,
    },
  ]);
  assert.equal(await db.table('packages').count({ where: { status: 'allowed' } }), 1);
  assert.deepEqual(await db.table('packages').aggregate({
    groupBy: 'status',
    metrics: {
      count: 'count',
      requests: { op: 'sum', field: 'requestCount' },
    },
    orderBy: 'status',
  }), [
    { status: 'allowed', count: 1, requests: 2 },
    { status: 'blocked', count: 1, requests: 5 },
  ]);

  await db.table('packages').patch({ name: '@async/db', version: '0.5.1' }, { requestCount: 3 });
  assert.equal(client.tableRows('public.package_versions')[0].request_count, 3);
});

test('openPostgresDb supports append-only table-backed collections', async () => {
  const cwd = await makeProject();
  const client = new FakePostgresTableClient({
    'public.install_events': [],
  });
  const db = await openPostgresDb({
    cwd,
    client,
    migrate: false,
    project: {
      resources: [
        {
          name: 'installEvents',
          kind: 'collection',
          idField: 'id',
          writePolicy: 'append-only',
          fields: {
            id: { type: 'string', required: true },
            packageName: { type: 'string' },
            decision: { type: 'string' },
          },
        },
      ],
    },
    tables: {
      installEvents: {
        schema: 'public',
        table: 'install_events',
        columns: {
          packageName: 'package_name',
        },
      },
    },
  });

  await db.table('installEvents').append({
    id: 'evt_1',
    packageName: '@async/db',
    decision: 'allowed',
  });
  assert.deepEqual(await db.table('installEvents').all(), [
    {
      id: 'evt_1',
      packageName: '@async/db',
      decision: 'allowed',
    },
  ]);
  await assert.rejects(
    () => db.table('installEvents').create({ id: 'evt_2', decision: 'blocked' }),
    /append-only/,
  );
  await assert.rejects(
    () => db.table('installEvents').patch('evt_1', { decision: 'blocked' }),
    /append-only/,
  );
  await assert.rejects(
    () => db.table('installEvents').delete('evt_1'),
    /append-only/,
  );
});

test('postgres compat adapters normalize common driver query shapes', async () => {
  const pg = adaptPostgresClient({
    async query(_sql, _params) {
      return { rows: [{ id: 'u_1' }], rowCount: 1 };
    },
  }, { driver: 'pg' });
  assert.deepEqual(await pg.query('SELECT 1'), { rows: [{ id: 'u_1' }], rowCount: 1 });

  const postgres = adaptPostgresClient({
    unsafe(sql, params) {
      return [{ sql, params }];
    },
  }, { driver: 'postgres' });
  assert.deepEqual(await postgres.query('SELECT * FROM users WHERE id = $1', ['u_1']), {
    rows: [{ sql: 'SELECT * FROM users WHERE id = $1', params: ['u_1'] }],
    rowCount: 1,
  });

  const pgPromise = adaptPostgresClient({
    any() {
      return [{ id: 'u_2' }];
    },
    result() {
      return { rows: [], rowCount: 1 };
    },
  }, { driver: 'pg-promise' });
  assert.deepEqual(await pgPromise.query('SELECT * FROM users'), { rows: [{ id: 'u_2' }] });
  assert.deepEqual(await pgPromise.query('UPDATE users SET name = $1', ['Ada']), { rows: [], rowCount: 1 });
});

test('runPostgresImportPlan defaults to dry-run and applies deterministic compound ids', async () => {
  const sourceDb = {
    table() {
      return {
        async all() {
          return [
            { tenant_id: 'acme', slug: 'core', name: 'Core' },
          ];
        },
      };
    },
    async close() {},
  };
  const imported = [];
  const targetDb = {
    collection() {
      return {
        async create(record) {
          imported.push(record);
        },
        async append(record) {
          imported.push(record);
        },
      };
    },
  };
  const plan: PostgresImportPlan = {
    version: 1,
    kind: 'postgres.importPlan',
    source: {
      connectionStringEnv: 'DATABASE_URL',
      schemas: ['public'],
    },
    target: {
      kind: 'postgres-envelope',
      connectionStringEnv: 'DATABASE_URL',
      schema: 'public',
      table: '_async_db_resources',
    },
    resources: [
      {
        resource: 'projects',
        schema: 'public',
        table: 'projects',
        kind: 'collection',
        importKind: 'collection',
        primaryKey: ['tenant_id', 'slug'],
        idField: 'id',
        fields: {
          id: { type: 'string', required: true },
          tenant_id: { type: 'string', required: true },
          slug: { type: 'string', required: true },
          name: { type: 'string' },
        },
        columns: {},
        keyStrategy: { kind: 'compound-generated-id', fields: ['tenant_id', 'slug'], idField: 'id' },
        estimatedRows: 1,
        batchSize: 500,
        warnings: [],
      },
    ],
    batchSize: 500,
    warnings: [],
  };

  assert.deepEqual(await runPostgresImportPlan(plan, { sourceDb }), {
    applied: false,
    resources: [
      { resource: 'projects', table: 'public.projects', rows: 1, kind: 'collection' },
    ],
  });
  assert.deepEqual(imported, []);

  await runPostgresImportPlan(plan, { sourceDb, targetDb, apply: true });
  assert.deepEqual(imported, [
    {
      tenant_id: 'acme',
      slug: 'core',
      name: 'Core',
      id: 'acme@core',
    },
  ]);
  assert.equal(compoundKeyId(['tenant_id', 'slug'], imported[0]), 'acme@core');
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

class FakePostgresTableClient {
  tables;
  queries = [];

  constructor(tables) {
    this.tables = new Map(Object.entries(tables).map(([name, rows]) => [name, (rows as Array<Record<string, unknown>>).map((row) => ({ ...row }))]));
  }

  tableRows(name) {
    return this.tables.get(name);
  }

  async query(sql, params = []) {
    this.queries.push({ sql, params });
    const table = tableNameFromSql(sql);
    if (!table) {
      if (/^CREATE (SCHEMA|TABLE)\b/.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`Unhandled fake Postgres table query: ${sql}`);
    }
    const rows = this.tables.get(table) ?? [];

    if (/^SELECT \* FROM/.test(sql)) {
      return { rows: filterRows(sql, rows, params).map((row) => ({ ...row })) };
    }

    if (/^SELECT 1 as found FROM/.test(sql)) {
      return { rows: filterRows(sql, rows, params).length > 0 ? [{ found: 1 }] : [] };
    }

    if (/^SELECT ".+" as id FROM/.test(sql)) {
      const column = /^SELECT "([^"]+)"/.exec(sql)?.[1];
      return { rows: rows.map((row) => ({ id: row[column] })) };
    }

    if (/^INSERT INTO/.test(sql)) {
      const columns = /\(([^)]+)\)\s+VALUES/.exec(sql)?.[1]
        .split(',')
        .map((column) => column.trim().replace(/^"|"$/g, '')) ?? [];
      const record = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
      rows.push(record);
      this.tables.set(table, rows);
      return { rows: [], rowCount: 1 };
    }

    if (/^UPDATE/.test(sql)) {
      const setColumns = /SET\s+(.+)\s+WHERE/.exec(sql)?.[1]
        .split(',')
        .map((entry) => /^"([^"]+)"/.exec(entry.trim())?.[1])
        .filter(Boolean) ?? [];
      const keyColumns = whereColumns(sql);
      const updateValues = params.slice(0, setColumns.length);
      const keyValues = params.slice(setColumns.length);
      let rowCount = 0;
      for (const row of rows) {
        if (keyColumns.every((column, index) => row[column] === keyValues[index])) {
          setColumns.forEach((column, index) => {
            row[column] = updateValues[index];
          });
          rowCount += 1;
        }
      }
      return { rows: [], rowCount };
    }

    if (/^DELETE FROM/.test(sql)) {
      const keyColumns = whereColumns(sql);
      const nextRows = rows.filter((row) => !keyColumns.every((column, index) => row[column] === params[index]));
      this.tables.set(table, nextRows);
      return { rows: [], rowCount: rows.length - nextRows.length };
    }

    throw new Error(`Unhandled fake Postgres table query: ${sql}`);
  }
}

function tableNameFromSql(sql) {
  const match = /\b(?:FROM|INTO|UPDATE)\s+"([^"]+)"\."([^"]+)"/.exec(sql)
    ?? /\b(?:FROM|INTO|UPDATE)\s+"([^"]+)"/.exec(sql);
  if (!match) {
    return null;
  }
  return match[2] ? `${match[1]}.${match[2]}` : match[1];
}

function filterRows(sql, rows, params) {
  const keyColumns = whereColumns(sql);
  if (keyColumns.length === 0) {
    return rows;
  }
  return rows.filter((row) => keyColumns.every((column, index) => row[column] === params[index]));
}

function whereColumns(sql) {
  const where = /\bWHERE\s+(.+)$/i.exec(sql)?.[1];
  if (!where) {
    return [];
  }
  return [...where.matchAll(/"([^"]+)"\s*=\s*\$\d+/g)].map((match) => match[1]);
}
