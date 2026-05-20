import assert from 'node:assert/strict';
import test from 'node:test';
import { createDbClient } from './client.js';

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
  globalThis.setTimeout = (callback, delay, ...args) => {
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

test('client fork option derives scoped REST, batch, and GraphQL paths', async () => {
  const calls = withMockFetch([
    {
      status: 200,
      headers: {},
      body: [{ id: 'u_legacy' }],
    },
    [
      {
        status: 200,
        headers: {},
        body: [{ id: 'u_legacy' }],
      },
    ],
    {
      data: {
        users: [{ id: 'u_legacy' }],
      },
    },
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    fork: 'legacy-demo',
  });

  await client.rest.get('/users');
  await client.rest.batch([{ method: 'GET', path: '/users' }]);
  await client.graphql('{ users { id } }');

  assert.equal(calls[0].url, 'http://db.local/__db/forks/legacy-demo/rest/users');
  assert.equal(calls[1].url, 'http://db.local/__db/forks/legacy-demo/batch');
  assert.equal(calls[2].url, 'http://db.local/__db/forks/legacy-demo/graphql');
});

test('client apiBase option customizes default fork paths', async () => {
  const calls = withMockFetch([
    {
      status: 200,
      headers: {},
      body: [{ id: 'u_legacy' }],
    },
    [
      {
        status: 200,
        headers: {},
        body: [{ id: 'u_legacy' }],
      },
    ],
    {
      data: {
        users: [{ id: 'u_legacy' }],
      },
    },
  ]);

  const client = createDbClient({
    baseUrl: 'http://db.local',
    apiBase: '/_db',
    fork: 'legacy-demo',
  });

  await client.rest.get('/users');
  await client.rest.batch([{ method: 'GET', path: '/users' }]);
  await client.graphql('{ users { id } }');

  assert.equal(calls[0].url, 'http://db.local/_db/forks/legacy-demo/rest/users');
  assert.equal(calls[1].url, 'http://db.local/_db/forks/legacy-demo/batch');
  assert.equal(calls[2].url, 'http://db.local/_db/forks/legacy-demo/graphql');
});

test('client fork option rejects unsafe fork names', () => {
  assert.throws(
    () => createDbClient({ fork: '../legacy-demo' }),
    /Invalid db fork name/,
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
  globalThis.fetch = async (url, init) => {
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
  };

  test.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = createDbClient({ baseUrl: 'http://db.local' });

  await assert.rejects(
    () => client.graphql('{ users { id } }'),
    (error) => {
      assert.equal(error.code, 'CLIENT_HTTP_ERROR');
      assert.match(error.message, /http:\/\/db\.local\/graphql/);
      assert.equal(error.details.responseBody.error.code, 'SERVER_DOWN');
      return true;
    },
  );
});

function withMockFetch(responses) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const body = responses.shift();
    return {
      status: 200,
      headers: new Headers(),
      async text() {
        return JSON.stringify(body);
      },
    };
  };

  test.after(() => {
    globalThis.fetch = originalFetch;
  });

  return calls;
}
