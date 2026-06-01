import assert from 'node:assert/strict';
import test from 'node:test';
import { createDbClient as createTypedDbClient, createIndexedDbCacheStorage as createTypedIndexedDbCacheStorage } from './client.js';

const createDbClient = (options: Parameters<typeof createTypedDbClient>[0]): any => createTypedDbClient(options) as any;
const createIndexedDbCacheStorage = (options: Parameters<typeof createTypedIndexedDbCacheStorage>[0]): any => createTypedIndexedDbCacheStorage(options) as any;

test('client can batch explicit GraphQL requests', async () => {
  const calls = withMockFetch([
    [
      { data: { users: [] } },
      { data: { settings: { theme: 'light' } } },
    ],
  ]);

  const client = createDbClient({ baseUrl: 'http://db.local' });
  const result = await client.graphql.batch([
    { query: '{ users { id } }' },
    { query: '{ settings { theme } }' },
  ]);

  assert.deepEqual(result, [
    { data: { users: [] } },
    { data: { settings: { theme: 'light' } } },
  ]);
  assert.equal(calls[0].url, 'http://db.local/graphql');
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { query: '{ users { id } }' },
    { query: '{ settings { theme } }' },
  ]);
});

test('client can automatically batch GraphQL requests', async () => {
  const calls = withMockFetch([
    [
      { data: { first: true } },
      { data: { second: true } },
    ],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    batching: true,
  });

  const [first, second] = await Promise.all([
    client.graphql('{ first }'),
    client.graphql('{ second }'),
  ]);

  assert.deepEqual(first, { data: { first: true } });
  assert.deepEqual(second, { data: { second: true } });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { query: '{ first }' },
    { query: '{ second }' },
  ]);
});

test('client automatic batching uses a 10ms default window', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const delays = [];
  (globalThis as any).setTimeout = (callback, delay, ...args) => {
    delays.push(delay);
    return originalSetTimeout(callback, 0, ...args);
  };

  withMockFetch([
    [
      { data: { users: [] } },
    ],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    batching: true,
  });

  try {
    await client.graphql('{ users { id } }');
    assert.equal(delays[0], 10);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('client automatic batching dedupes identical GraphQL requests', async () => {
  const calls = withMockFetch([
    [
      { data: { users: [{ id: 'u_1' }] } },
    ],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    batching: true,
  });

  const query = '{ users { id } }';
  const [first, second] = await Promise.all([
    client.graphql(query),
    client.graphql(query),
  ]);

  assert.deepEqual(first, { data: { users: [{ id: 'u_1' }] } });
  assert.deepEqual(second, { data: { users: [{ id: 'u_1' }] } });
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { query },
  ]);
});

test('client automatic batching does not dedupe GraphQL mutations by default', async () => {
  const calls = withMockFetch([
    [
      { data: { createUser: { id: 'u_1' } } },
      { data: { createUser: { id: 'u_1' } } },
    ],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    batching: true,
  });

  const mutation = 'mutation { createUser(input: { id: "u_1" }) { id } }';
  const [first, second] = await Promise.all([
    client.graphql(mutation),
    client.graphql(mutation),
  ]);

  assert.deepEqual(first, { data: { createUser: { id: 'u_1' } } });
  assert.deepEqual(second, { data: { createUser: { id: 'u_1' } } });
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { query: mutation },
    { query: mutation },
  ]);
});

test('client automatic batching can explicitly dedupe all GraphQL requests', async () => {
  const calls = withMockFetch([
    [
      { data: { createUser: { id: 'u_1' } } },
    ],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    batching: {
      enabled: true,
      dedupe: 'all',
    },
  });

  const mutation = 'mutation { createUser(input: { id: "u_1" }) { id } }';
  const [first, second] = await Promise.all([
    client.graphql(mutation),
    client.graphql(mutation),
  ]);

  assert.deepEqual(first, { data: { createUser: { id: 'u_1' } } });
  assert.deepEqual(second, { data: { createUser: { id: 'u_1' } } });
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { query: mutation },
  ]);
});

test('client can batch REST requests', async () => {
  const calls = withMockFetch([
    [
      {
        status: 200,
        headers: {},
        body: [{ id: 'u_1' }],
      },
      {
        status: 200,
        headers: {},
        body: { theme: 'light' },
      },
    ],
  ]);

  const client = createDbClient({ baseUrl: 'http://db.local' });
  const result = await client.rest.batch([
    { method: 'GET', path: '/users' },
    { method: 'GET', path: '/settings' },
  ]);

  assert.deepEqual(result, [
    {
      status: 200,
      headers: {},
      body: [{ id: 'u_1' }],
    },
    {
      status: 200,
      headers: {},
      body: { theme: 'light' },
    },
  ]);
  assert.equal(calls[0].url, 'http://db.local/__db/batch');
});

test('client apiBase customizes default REST batch path without changing REST or GraphQL defaults', async () => {
  const calls = withMockFetch([
    {
      status: 200,
      headers: {},
      body: [{ id: 'u_1' }],
    },
    [
      {
        status: 200,
        headers: {},
        body: [{ id: 'u_1' }],
      },
    ],
    {
      data: {
        users: [{ id: 'u_1' }],
      },
    },
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    apiBase: '/_db',
  });

  await client.rest.get('/users');
  await client.rest.batch([{ method: 'GET', path: '/users' }]);
  await client.graphql('{ users { id } }');

  assert.equal(calls[0].url, 'http://db.local/users');
  assert.equal(calls[1].url, 'http://db.local/_db/batch');
  assert.equal(calls[2].url, 'http://db.local/graphql');
});

test('client can target scoped REST base paths for Vite dev APIs', async () => {
  const calls = withMockFetch([
    {
      status: 200,
      headers: {},
      body: [{ id: 'u_1' }],
    },
    [
      {
        status: 200,
        headers: {},
        body: [{ id: 'u_1' }],
      },
    ],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    restBasePath: '/__db/rest',
    restBatchPath: '/__db/batch',
    graphqlPath: '/__db/graphql',
  });

  await client.rest.get('/users');
  await client.rest.batch([{ method: 'GET', path: '/users' }]);

  assert.equal(calls[0].url, 'http://db.local/__db/rest/users');
  assert.equal(calls[1].url, 'http://db.local/__db/batch');
  assert.deepEqual(JSON.parse(calls[1].init.body), [
    { method: 'GET', path: '/users' },
  ]);
});

test('client rejects removed fixture fork option', () => {
  assert.throws(
    () => createDbClient({ fork: 'legacy-demo' } as never),
    (error: any) => {
      assert.equal(error.code, 'CLIENT_FORK_OPTION_REMOVED');
      assert.match(error.message, /fork option/);
      assert.match(error.hint, /db\.forks\.open/);
      return true;
    },
  );
});

test('client supports relative scoped REST paths without baseUrl', async () => {
  const calls = withMockFetch([
    {
      status: 200,
      headers: {},
      body: [],
    },
  ]);

  const client = createDbClient({
    restBasePath: '/__db/rest',
  });

  await client.rest.get('/users');

  assert.equal(calls[0].url, '/__db/rest/users');
});

test('client cache fetches the viewer manifest and serves cache-first REST collections', async () => {
  const calls = withMockFetch([
    viewerManifestFixture(),
    [{ id: 'u_1', name: 'Ada' }],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: true,
  });

  const first = await client.rest.get('/users');
  const second = await client.rest.get('/users');

  assert.deepEqual(first.body, [{ id: 'u_1', name: 'Ada' }]);
  assert.deepEqual(second.body, [{ id: 'u_1', name: 'Ada' }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://db.local/__db/manifest.json');
  assert.equal(calls[1].url, 'http://db.local/users');
});

test('client cache dedupes identical in-flight REST reads outside the batch window', async () => {
  const calls = withMockFetch([
    viewerManifestFixture(),
    [{ id: 'u_1', name: 'Ada' }],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: true,
  });

  const [first, second] = await Promise.all([
    client.rest.get('/users'),
    client.rest.get('/users'),
  ]);

  assert.deepEqual(first.body, [{ id: 'u_1', name: 'Ada' }]);
  assert.deepEqual(second.body, [{ id: 'u_1', name: 'Ada' }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'http://db.local/users');
});

test('client cache merges REST write responses into cached records', async () => {
  const calls = withMockFetch([
    viewerManifestFixture(),
    { id: 'u_1', name: 'Ada' },
    { id: 'u_1', name: 'Grace' },
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: true,
  });

  await client.rest.get('/users/u_1');
  await client.rest.patch('/users/u_1', { name: 'Grace' });
  const cached = await client.rest.get('/users/u_1');

  assert.deepEqual(cached.body, { id: 'u_1', name: 'Grace' });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'http://db.local/users/u_1');
  assert.equal(calls[2].init.method, 'PATCH');
});

test('client cache invalidates REST collection lists after writes', async () => {
  const calls = withMockFetch([
    viewerManifestFixture(),
    [{ id: 'u_1', name: 'Ada' }],
    { id: 'u_1', name: 'Grace' },
    [{ id: 'u_1', name: 'Grace' }],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: true,
  });

  await client.rest.get('/users');
  await client.rest.patch('/users/u_1', { name: 'Grace' });
  const refetched = await client.rest.get('/users');

  assert.deepEqual(refetched.body, [{ id: 'u_1', name: 'Grace' }]);
  assert.equal(calls.length, 4);
  assert.equal(calls[3].url, 'http://db.local/users');
});

test('client cache normalizes GraphQL objects by __typename and id', async () => {
  const calls = withMockFetch([
    viewerManifestFixture(),
    {
      data: {
        user: {
          __typename: 'User',
          id: 'u_1',
          name: 'Ada',
        },
      },
    },
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: true,
  });

  const query = '{ user(id: "u_1") { __typename id name } }';
  const first = await client.graphql(query);
  const second = await client.graphql(query);

  assert.deepEqual(first, {
    data: {
      user: {
        __typename: 'User',
        id: 'u_1',
        name: 'Ada',
      },
    },
  });
  assert.deepEqual(second, first);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'http://db.local/graphql');
});

test('client cache watch receives normalized record updates', async () => {
  withMockFetch([
    viewerManifestFixture(),
    { id: 'u_1', name: 'Ada' },
    { id: 'u_1', name: 'Grace' },
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: true,
  });
  const snapshots = [];
  const stop = client.cache.watch({ method: 'GET', path: '/users/u_1' }, (snapshot) => {
    snapshots.push(snapshot);
  });

  await client.rest.get('/users/u_1');
  await client.rest.patch('/users/u_1', { name: 'Grace' });
  stop();

  assert.deepEqual(snapshots.map((snapshot) => snapshot.data.body), [
    { id: 'u_1', name: 'Ada' },
    { id: 'u_1', name: 'Grace' },
  ]);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.stale), [false, false]);
});

test('client cache invalidates records from runtime log events', async () => {
  const eventSources = withMockEventSource();
  const calls = withMockFetch([
    viewerManifestFixture(),
    { id: 'u_1', name: 'Ada' },
    { id: 'u_1', name: 'Grace' },
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: true,
  });

  await client.rest.get('/users/u_1');
  eventSources.find((source) => source.url === 'http://db.local/__db/log').emit('db-log', {
    resource: 'users',
    kind: 'collection',
    op: 'update',
    id: 'u_1',
  });
  const refetched = await client.rest.get('/users/u_1');

  assert.deepEqual(refetched.body, { id: 'u_1', name: 'Grace' });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'http://db.local/users/u_1');
});

test('client cache refetches the viewer manifest after source sync events', async () => {
  const eventSources = withMockEventSource();
  const calls = withMockFetch([
    viewerManifestFixture(),
    [{ id: 'u_1', name: 'Ada' }],
    viewerManifestFixture(),
    [{ id: 'u_1', name: 'Grace' }],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: true,
  });

  await client.rest.get('/users');
  eventSources.find((source) => source.url === 'http://db.local/__db/events').emit('db', {
    type: 'synced',
    version: 2,
  });
  const refetched = await client.rest.get('/users');

  assert.deepEqual(refetched.body, [{ id: 'u_1', name: 'Grace' }]);
  assert.deepEqual(calls.map((call) => call.url), [
    'http://db.local/__db/manifest.json',
    'http://db.local/users',
    'http://db.local/__db/manifest.json',
    'http://db.local/users',
  ]);
});

test('client cache can refetch watched records after runtime log events', async () => {
  const eventSources = withMockEventSource();
  const calls = withMockFetch([
    viewerManifestFixture(),
    { id: 'u_1', name: 'Ada' },
    { id: 'u_1', name: 'Grace' },
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: {
      enabled: true,
      eventPolicy: 'refetch',
    },
  });
  const snapshots = [];
  client.cache.watch({ method: 'GET', path: '/users/u_1' }, (snapshot) => {
    snapshots.push(snapshot);
  });

  await client.rest.get('/users/u_1');
  eventSources.find((source) => source.url === 'http://db.local/__db/log').emit('db-log', {
    resource: 'users',
    kind: 'collection',
    op: 'update',
    id: 'u_1',
  });
  await waitForMicrotasks();

  assert.equal(calls.length, 3);
  assert.deepEqual(snapshots.at(-1).data.body, { id: 'u_1', name: 'Grace' });
  assert.equal(snapshots.at(-1).stale, false);
});

test('client cache network-first reads prefer the network over a fresh cache hit', async () => {
  const calls = withMockFetch([
    viewerManifestFixture(),
    [{ id: 'u_1', name: 'Ada' }],
    [{ id: 'u_1', name: 'Grace' }],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: {
      enabled: true,
      readPolicy: 'network-first',
    },
  });

  await client.rest.get('/users');
  const fresh = await client.rest.get('/users');

  assert.deepEqual(fresh.body, [{ id: 'u_1', name: 'Grace' }]);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'http://db.local/users');
});

test('client cache invalidate write policy refetches stale records on next read', async () => {
  const calls = withMockFetch([
    viewerManifestFixture(),
    { id: 'u_1', name: 'Ada' },
    { id: 'u_1', name: 'Grace from write' },
    { id: 'u_1', name: 'Grace from refetch' },
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: {
      enabled: true,
      writePolicy: 'invalidate',
    },
  });

  await client.rest.get('/users/u_1');
  await client.rest.patch('/users/u_1', { name: 'Grace' });
  const refetched = await client.rest.get('/users/u_1');

  assert.deepEqual(refetched.body, { id: 'u_1', name: 'Grace from refetch' });
  assert.equal(calls.length, 4);
  assert.equal(calls[3].url, 'http://db.local/users/u_1');
});

test('client cache refetch write policy refreshes active watches after writes', async () => {
  const calls = withMockFetch([
    viewerManifestFixture(),
    { id: 'u_1', name: 'Ada' },
    { id: 'u_1', name: 'Grace from write' },
    { id: 'u_1', name: 'Grace from refetch' },
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    cache: {
      enabled: true,
      writePolicy: 'refetch',
    },
  });
  const snapshots = [];
  client.cache.watch({ method: 'GET', path: '/users/u_1' }, (snapshot) => {
    snapshots.push(snapshot);
  });

  await client.rest.get('/users/u_1');
  await client.rest.patch('/users/u_1', { name: 'Grace' });
  await waitForMicrotasks();

  assert.equal(calls.length, 4);
  assert.deepEqual(snapshots.at(-1).data.body, { id: 'u_1', name: 'Grace from refetch' });
  assert.equal(snapshots.at(-1).stale, false);
});

test('client cache can hydrate from an explicit async storage adapter', async () => {
  let savedSnapshot = null;
  const saveContexts = [];
  const storage = {
    async load() {
      return savedSnapshot;
    },
    async save(snapshot, context) {
      saveContexts.push(context);
      savedSnapshot = snapshot;
    },
    async clear() {
      savedSnapshot = null;
    },
  };
  const firstCalls = withMockFetch([
    viewerManifestFixture(),
    [{ id: 'u_1', name: 'Ada' }],
  ]);

  const firstClient = createDbClient({
    baseUrl: 'http://db.local',
    cache: {
      enabled: true,
      storage,
    },
  });

  await firstClient.rest.get('/users');
  await waitForMicrotasks();

  assert.equal(firstCalls.length, 2);
  assert.equal(savedSnapshot?.queries.length, 1);
  assert.deepEqual(savedSnapshot.resources.users.u_1, { id: 'u_1', name: 'Ada' });
  assert.match(saveContexts.at(-1).baseNamespace, /^async-db:/);
  assert.match(saveContexts.at(-1).manifestFingerprint, /^[a-z0-9]+$/);
  assert.notEqual(saveContexts.at(-1).namespace, saveContexts.at(-1).baseNamespace);

  const secondCalls = withMockFetch([]);
  const secondClient = createDbClient({
    baseUrl: 'http://db.local',
    cache: {
      enabled: true,
      storage,
    },
  });

  const cached = await secondClient.rest.get('/users');

  assert.deepEqual(cached.body, [{ id: 'u_1', name: 'Ada' }]);
  assert.equal(secondCalls.length, 0);
});

test('createIndexedDbCacheStorage persists and clears snapshots under an explicit key', async () => {
  const indexedDB = createFakeIndexedDb();
  const storage = createIndexedDbCacheStorage({
    name: 'async-db-test',
    storeName: 'snapshots',
    key: 'client-a',
    indexedDB: indexedDB as any,
  });
  const otherStorage = createIndexedDbCacheStorage({
    name: 'async-db-test',
    storeName: 'snapshots',
    key: 'client-b',
    indexedDB: indexedDB as any,
  });

  await storage.save({ marker: 'a' });

  assert.deepEqual(await storage.load(), { marker: 'a' });
  assert.equal(await otherStorage.load(), null);

  await storage.clear();

  assert.equal(await storage.load(), null);
});

test('createIndexedDbCacheStorage indexes the latest manifest-scoped namespace', async () => {
  const indexedDB = createFakeIndexedDb();
  const storage = createIndexedDbCacheStorage({
    name: 'async-db-test',
    storeName: 'snapshots',
    indexedDB: indexedDB as any,
  });
  const context = {
    baseNamespace: 'async-db:http://db.local:/__db',
    namespace: 'async-db:http://db.local:/__db:manifest-a',
    manifestFingerprint: 'manifest-a',
  };

  await storage.save({ marker: 'latest' }, context);

  assert.deepEqual(await storage.load({
    baseNamespace: context.baseNamespace,
    namespace: context.baseNamespace,
    manifestFingerprint: null,
  }), { marker: 'latest' });
});

test('createIndexedDbCacheStorage explains unavailable IndexedDB environments', () => {
  assert.throws(
    () => createIndexedDbCacheStorage({ indexedDB: false as any }),
    (error: any) => {
      assert.equal(error.code, 'CLIENT_INDEXEDDB_UNAVAILABLE');
      assert.match(error.message, /IndexedDB cache storage is not available/);
      return true;
    },
  );
});

test('client automatic batching dedupes REST GET requests but not writes by default', async () => {
  const calls = withMockFetch([
    [
      {
        status: 200,
        headers: {},
        body: [{ id: 'u_1' }],
      },
      {
        status: 201,
        headers: {},
        body: { id: 'u_2' },
      },
      {
        status: 201,
        headers: {},
        body: { id: 'u_2' },
      },
    ],
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    batching: true,
  });

  const [firstRead, secondRead, firstWrite, secondWrite] = await Promise.all([
    client.rest.get('/users'),
    client.rest.get('/users'),
    client.rest.post('/users', { id: 'u_2' }),
    client.rest.post('/users', { id: 'u_2' }),
  ]);

  assert.deepEqual(firstRead.body, [{ id: 'u_1' }]);
  assert.deepEqual(secondRead.body, [{ id: 'u_1' }]);
  assert.equal(firstWrite.status, 201);
  assert.equal(secondWrite.status, 201);
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { method: 'GET', path: '/users' },
    { method: 'POST', path: '/users', body: { id: 'u_2' } },
    { method: 'POST', path: '/users', body: { id: 'u_2' } },
  ]);
});

test('client HTTP errors explain the failing URL and response body', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push({ url, init });
    return {
      ok: false,
      status: 503,
      headers: new Headers(),
      async text() {
        return JSON.stringify({
          error: {
            code: 'SERVER_DOWN',
            message: 'Server unavailable',
          },
        });
      },
    };
  }) as typeof fetch;

  test.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = createDbClient({ baseUrl: 'http://db.local' });

  await assert.rejects(
    () => client.graphql('{ users { id } }'),
    (error: any) => {
      assert.equal(error.code, 'CLIENT_HTTP_ERROR');
      assert.match(error.message, /http:\/\/db\.local\/graphql/);
      assert.equal(error.details.responseBody.error.code, 'SERVER_DOWN');
      return true;
    },
  );
});

test('client operation executes literal REST templates and registered refs', async () => {
  const calls = withMockFetch([
    {
      id: 'u_1',
      name: 'Ada',
    },
    {
      id: 'u_1',
      name: 'Ada',
    },
    {
      id: 'u_1',
      name: 'Ada',
    },
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]);
  const client = createDbClient({ baseUrl: 'http://db.local' });

  await client.operation('/users/{id}.json?select=id,name', { id: 'u 1' });
  await client.operation({
    method: 'GET',
    path: '/users/{id}.json',
    query: {
      select: 'id,name',
    },
  }, { id: 'u_1' });
  await client.operation('users.get', { id: 'u_1' });
  await client.operation({ name: 'GetUser', ref: 'users.fetch' }, { id: 'u_2' });

  assert.equal(calls[0].url, 'http://db.local/users/u%201.json?select=id,name');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].url, 'http://db.local/users/u_1.json?select=id,name');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[2].url, 'http://db.local/__db/operations/users.get');
  assert.equal(calls[2].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    variables: {
      id: 'u_1',
    },
  });
  assert.equal(calls[3].url, 'http://db.local/__db/operations/users.fetch');
  assert.equal(calls[3].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    variables: {
      id: 'u_2',
    },
  });
});

test('client query aliases registered operations and supports GraphQL templates', async () => {
  const calls = withMockFetch([
    {
      id: 'u_registry',
      name: 'Ada',
    },
    {
      id: 'u_1',
      name: 'Ada',
    },
    {
      data: {
        user: {
          id: 'u_1',
        },
      },
    },
    {
      data: {
        user: {
          id: 'u_2',
        },
      },
    },
  ]);
  const client = createDbClient({ baseUrl: 'http://db.local' });

  await client.query('GetUser', { id: 'u_1' });
  await client.query('/users/{id}.json?select=id,name', { id: 'u 1' });
  await client.query({
    query: 'query GetUser($id: ID!) { user(id: $id) { id } }',
    operationName: 'GetUser',
    variables: {
      id: '{id}',
    },
  }, { id: 'u_1' });
  await client.query('users.fetch', { id: 'u_2' });

  assert.equal(calls[0].url, 'http://db.local/__db/operations/GetUser');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    variables: {
      id: 'u_1',
    },
  });
  assert.equal(calls[1].url, 'http://db.local/users/u%201.json?select=id,name');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[2].url, 'http://db.local/graphql');
  assert.equal(calls[2].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    query: 'query GetUser($id: ID!) { user(id: $id) { id } }',
    variables: {
      id: 'u_1',
    },
    operationName: 'GetUser',
  });
  assert.equal(calls[3].url, 'http://db.local/__db/operations/users.fetch');
  assert.equal(calls[3].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    variables: {
      id: 'u_2',
    },
  });
});

function withMockFetch(responses): any[] {
  const originalFetch = globalThis.fetch;
  const calls: any[] = [];

  globalThis.fetch = (async (url, init) => {
    calls.push({ url, init });
    const body = responses.shift();
    return {
      status: 200,
      headers: new Headers(),
      async text() {
        return JSON.stringify(body);
      },
    };
  }) as typeof fetch;

  test.after(() => {
    globalThis.fetch = originalFetch;
  });

  return calls;
}

function withMockEventSource() {
  const originalEventSource = globalThis.EventSource;
  const sources: any[] = [];

  (globalThis as any).EventSource = class MockEventSource {
    url: string;
    listeners: Map<string, Array<(event: { data: string }) => void>>;

    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sources.push(this);
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type, payload) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({
          data: JSON.stringify(payload),
        });
      }
    }

    close() {}
  };

  test.after(() => {
    globalThis.EventSource = originalEventSource;
  });

  return sources;
}

async function waitForMicrotasks() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function viewerManifestFixture() {
  return {
    version: 1,
    kind: 'db.viewerManifest',
    api: {
      manifestJson: '/__db/manifest.json',
      events: '/__db/events',
      log: '/__db/log',
      resources: {
        users: {
          kind: 'collection',
          list: '/users',
          record: '/users/{id}',
        },
        settings: {
          kind: 'document',
          read: '/settings',
          write: '/settings',
        },
      },
    },
    collections: {
      users: {
        kind: 'collection',
        typeName: 'User',
        routePath: '/users',
        idField: 'id',
        fields: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
    documents: {
      settings: {
        kind: 'document',
        typeName: 'Settings',
        routePath: '/settings',
        fields: {
          theme: { type: 'string' },
        },
      },
    },
  };
}

function createFakeIndexedDb(): any {
  const databases = new Map();
  return {
    open(name) {
      const request: any = {};
      queueMicrotask(() => {
        let database = databases.get(name);
        const isNewDatabase = !database;
        if (!database) {
          database = createFakeIndexedDatabase();
          databases.set(name, database);
        }
        request.result = database;
        if (isNewDatabase) {
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function createFakeIndexedDatabase(): any {
  const stores = new Map();
  return {
    objectStoreNames: {
      contains(storeName) {
        return stores.has(storeName);
      },
    },
    createObjectStore(storeName) {
      stores.set(storeName, new Map());
    },
    transaction(storeName) {
      return {
        error: null,
        objectStore() {
          const values = stores.get(storeName);
          return {
            get(key) {
              return fakeIndexedRequest(values.get(key) ?? null);
            },
            put(value, key) {
              values.set(key, value);
              return fakeIndexedRequest(key);
            },
            delete(key) {
              values.delete(key);
              return fakeIndexedRequest(undefined);
            },
          };
        },
      };
    },
  };
}

function fakeIndexedRequest(result): any {
  const request: any = {};
  queueMicrotask(() => {
    request.result = result;
    request.onsuccess?.();
  });
  return request;
}
