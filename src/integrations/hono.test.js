import assert from 'node:assert/strict';
import test from 'node:test';
import { dbContext, registerDbRoutes } from './hono.js';
import { openDb } from '../index.js';
import { makeProject, writeFixture } from '../../test/helpers.js';

test('dbContext reuses the opened db when created from options', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const middleware = dbContext({ cwd });
  const first = fakeContext();
  const second = fakeContext();
  let nextCalls = 0;

  await middleware(first, async () => {
    nextCalls += 1;
  });
  await middleware(second, async () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 2);
  assert.equal(first.get('db'), second.get('db'));
});

test('registerDbRoutes supports prefix resource filters and hook short-circuiting', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([{ id: 'home', title: 'Home' }]));
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const db = await openDb({ cwd });
  const app = fakeHonoApp();

  registerDbRoutes(app, db, {
    prefix: '/api',
    resources: ['pages'],
    hooks: {
      beforeList(ctx) {
        assert.equal(ctx.resourceName, 'pages');
        assert.equal(ctx.method, 'list');
        return ctx.c.json({ error: 'Forbidden' }, 403);
      },
    },
  });

  assert.equal(Boolean(app.route('GET', '/api/pages')), true);
  assert.equal(Boolean(app.route('GET', '/api/users')), false);

  const response = await app.route('GET', '/api/pages').handler(fakeHonoContext());

  assert.deepEqual(response, {
    status: 403,
    body: {
      error: 'Forbidden',
    },
  });
});

test('registerDbRoutes supports resource hooks that mutate write bodies', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([]));
  const db = await openDb({ cwd });
  const app = fakeHonoApp();

  registerDbRoutes(app, db, {
    prefix: '/api',
    resourceOptions: {
      pages: {
        hooks: {
          beforeCreate(ctx) {
            ctx.body.title = ctx.body.title.trim();
          },
        },
      },
    },
  });

  const response = await app.route('POST', '/api/pages').handler(fakeHonoContext({
    body: {
      id: 'home',
      title: '  Home  ',
    },
  }));

  assert.equal(response.status, 201);
  assert.deepEqual(await db.collection('pages').get('home'), {
    id: 'home',
    title: 'Home',
  });
});

test('registerDbRoutes runs lifecycle hooks before global and resource hooks', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([]));
  const db = await openDb({ cwd });
  const app = fakeHonoApp();
  const calls = [];

  registerDbRoutes(app, db, {
    prefix: '/api',
    lifecycleHooks: {
      beforeRequest(ctx) {
        calls.push(`request:${ctx.method}`);
      },
      beforeWrite(ctx) {
        calls.push(`write:${ctx.method}`);
        ctx.body.title = ctx.body.title.trim();
        ctx.body.updatedAt = '2026-05-14T00:00:00.000Z';
      },
    },
    hooks: {
      beforeCreate(ctx) {
        calls.push(`global:${ctx.method}`);
        ctx.body.fromGlobalHook = true;
      },
    },
    resourceOptions: {
      pages: {
        hooks: {
          beforeCreate(ctx) {
            calls.push(`resource:${ctx.method}`);
            ctx.body.fromResourceHook = true;
          },
        },
      },
    },
  });

  const response = await app.route('POST', '/api/pages').handler(fakeHonoContext({
    body: {
      id: 'home',
      title: '  Home  ',
    },
  }));

  assert.equal(response.status, 201);
  assert.deepEqual(calls, [
    'request:create',
    'write:create',
    'global:create',
    'resource:create',
  ]);
  assert.deepEqual(await db.collection('pages').get('home'), {
    id: 'home',
    title: 'Home',
    updatedAt: '2026-05-14T00:00:00.000Z',
    fromGlobalHook: true,
    fromResourceHook: true,
  });
});

test('registerDbRoutes only runs beforeWrite for mutating methods', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([{ id: 'home', title: 'Home' }]));
  const db = await openDb({ cwd });
  const app = fakeHonoApp();
  const calls = [];

  registerDbRoutes(app, db, {
    prefix: '/api',
    lifecycleHooks: {
      beforeRequest(ctx) {
        calls.push(`request:${ctx.method}`);
      },
      beforeWrite(ctx) {
        calls.push(`write:${ctx.method}`);
      },
    },
  });

  await app.route('GET', '/api/pages').handler(fakeHonoContext());
  await app.route('GET', '/api/pages/:id').handler(fakeHonoContext({
    params: {
      id: 'home',
    },
  }));
  await app.route('PATCH', '/api/pages/:id').handler(fakeHonoContext({
    params: {
      id: 'home',
    },
    body: {
      title: 'Homepage',
    },
  }));

  assert.deepEqual(calls, [
    'request:list',
    'request:get',
    'request:patch',
    'write:patch',
  ]);
});

test('registerDbRoutes supports beforeRequest short-circuiting', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([]));
  const db = await openDb({ cwd });
  const app = fakeHonoApp();
  let methodHookCalled = false;

  registerDbRoutes(app, db, {
    prefix: '/api',
    lifecycleHooks: {
      beforeRequest(ctx) {
        return ctx.c.json({ error: 'Unauthorized' }, 401);
      },
    },
    hooks: {
      beforeCreate() {
        methodHookCalled = true;
      },
    },
  });

  const response = await app.route('POST', '/api/pages').handler(fakeHonoContext({
    body: {
      id: 'home',
      title: 'Home',
    },
  }));

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Unauthorized' });
  assert.equal(methodHookCalled, false);
  assert.equal(await db.collection('pages').exists('home'), false);
});

test('registerDbRoutes supports beforeWrite short-circuiting', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([]));
  const db = await openDb({ cwd });
  const app = fakeHonoApp();
  let methodHookCalled = false;

  registerDbRoutes(app, db, {
    prefix: '/api',
    lifecycleHooks: {
      beforeRequest() {},
      beforeWrite(ctx) {
        return ctx.c.json({ error: 'Forbidden' }, 403);
      },
    },
    hooks: {
      beforeCreate() {
        methodHookCalled = true;
      },
    },
  });

  const response = await app.route('POST', '/api/pages').handler(fakeHonoContext({
    body: {
      id: 'home',
      title: 'Home',
    },
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: 'Forbidden' });
  assert.equal(methodHookCalled, false);
  assert.equal(await db.collection('pages').exists('home'), false);
});

test('registerDbRoutes traces list, get, and write routes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([{ id: 'home', title: 'Home' }]));
  const db = await openDb({ cwd });
  const traces = [];
  const unsubscribe = db.events.subscribe((event) => {
    if (event.type === 'request-trace') traces.push(event);
  });
  const app = fakeHonoApp();

  registerDbRoutes(app, db, {
    prefix: '/api',
    trace: {
      console: false,
    },
  });

  const list = await app.route('GET', '/api/pages').handler(fakeHonoContext({
    url: 'http://db.local/api/pages?select=id',
  }));
  const get = await app.route('GET', '/api/pages/:id').handler(fakeHonoContext({
    params: {
      id: 'home',
    },
    url: 'http://db.local/api/pages/home',
  }));
  const create = await app.route('POST', '/api/pages').handler(fakeHonoContext({
    body: {
      id: 'about',
      title: 'About',
    },
    url: 'http://db.local/api/pages',
  }));
  unsubscribe();

  assert.equal(list.status, 200);
  assert.equal(get.status, 200);
  assert.equal(create.status, 201);
  assert.match(list.headers['x-async-db-request-id'], /.+/);
  assert.match(get.headers['x-async-db-request-id'], /.+/);
  assert.match(create.headers['x-async-db-request-id'], /.+/);
  assert.deepEqual(traces.map((trace) => trace.operation), ['list', 'get', 'create']);
  assert.deepEqual(traces.map((trace) => trace.route), ['hono-rest', 'hono-rest', 'hono-rest']);
  assert.deepEqual(traces.map((trace) => trace.resource), ['pages', 'pages', 'pages']);
  assert.equal(traces[0].pathname, '/api/pages');
  assert.deepEqual(traces[0].queryKeys, ['select']);
  assert.equal(traces[1].id, 'home');
  assert.equal(traces[2].status, 201);
  assert.equal(traces[2].phases.some((phase) => phase.name === 'collection-write'), true);
});

test('registerDbRoutes traces hook short-circuit responses', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([]));
  const db = await openDb({ cwd });
  const traces = [];
  const unsubscribe = db.events.subscribe((event) => {
    if (event.type === 'request-trace') traces.push(event);
  });
  const app = fakeHonoApp();
  let methodHookCalled = false;

  registerDbRoutes(app, db, {
    prefix: '/api',
    trace: {
      slowMs: 0,
      console: false,
    },
    lifecycleHooks: {
      beforeRequest(ctx) {
        return ctx.c.json({ error: 'Unauthorized' }, 401);
      },
    },
    hooks: {
      beforeCreate() {
        methodHookCalled = true;
      },
    },
  });

  const response = await app.route('POST', '/api/pages').handler(fakeHonoContext({
    body: {
      id: 'home',
      title: 'Home',
    },
  }));
  unsubscribe();

  assert.equal(response.status, 401);
  assert.match(response.headers['x-async-db-request-id'], /.+/);
  assert.equal(methodHookCalled, false);
  assert.equal(await db.collection('pages').exists('home'), false);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].route, 'hono-rest');
  assert.equal(traces[0].resource, 'pages');
  assert.equal(traces[0].operation, 'create');
  assert.equal(traces[0].status, 401);
  assert.equal(traces[0].hook, 'beforeRequest');
  assert.equal(traces[0].shortCircuit, true);
  assert.equal(traces[0].slow, true);
  assert.equal(traces[0].phases.some((phase) => phase.name === 'hono-hook' && phase.hook === 'beforeRequest'), true);
});

test('registerDbRoutes auto-mounts registered operations from global config', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada', email: 'ada@example.com' }]));
  const db = await openDb({
    cwd,
    operations: {
      enabled: true,
      registry: {
        'users.get': {
          name: 'GetUser',
          method: 'GET',
          path: '/users/{id}.json',
          query: {
            select: 'id,name',
          },
        },
      },
      acceptRefs: 'ref',
    },
  });
  const app = fakeHonoApp();

  registerDbRoutes(app, db, {
    prefix: '/api/db',
  });

  const route = app.route('POST', '/api/db/operations/:ref');
  assert.equal(Boolean(route), true);
  const response = await route.handler(fakeHonoContext({
    params: {
      ref: 'users.get',
    },
    body: {
      variables: {
        id: 'u_1',
      },
    },
    url: 'http://db.local/api/db/operations/users.get',
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    id: 'u_1',
    name: 'Ada',
  });
});

test('registerDbRoutes runs lifecycle beforeRequest for registered operations', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const db = await openDb({
    cwd,
    operations: {
      enabled: true,
      registry: {
        'users.get': {
          name: 'GetUser',
          method: 'GET',
          path: '/users/{id}.json',
        },
      },
    },
  });
  const app = fakeHonoApp();
  const calls = [];

  registerDbRoutes(app, db, {
    prefix: '/api/db',
    lifecycleHooks: {
      beforeRequest(ctx) {
        calls.push(`${ctx.method}:${ctx.ref}`);
        assert.equal(ctx.resource, null);
        assert.equal(ctx.resourceName, null);
        return ctx.c.json({ error: 'Unauthorized' }, 401);
      },
    },
  });

  const response = await app.route('POST', '/api/db/operations/:ref').handler(fakeHonoContext({
    params: {
      ref: 'users.get',
    },
    body: {
      variables: {
        id: 'u_1',
      },
    },
  }));

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Unauthorized' });
  assert.deepEqual(calls, ['operation:users.get']);
});

test('registerDbRoutes keeps explicit operation routes app-owned when server exposure is registered-only', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const db = await openDb({
    cwd,
    operations: {
      enabled: true,
      registry: {
        'users.get': {
          name: 'GetUser',
          method: 'GET',
          path: '/users/{id}.json',
        },
      },
    },
    server: {
      expose: {
        rest: 'registered-only',
      },
    },
  });
  const app = fakeHonoApp();
  const calls = [];

  registerDbRoutes(app, db, {
    prefix: '/api/db',
    operations: true,
    lifecycleHooks: {
      beforeRequest(ctx) {
        calls.push(`${ctx.method}:${ctx.ref ?? ctx.resourceName}`);
        if (ctx.method === 'operation' && !ctx.c.req.header('authorization')) {
          return ctx.c.json({ error: 'Unauthorized' }, 401);
        }
        return undefined;
      },
    },
  });

  const unauthorized = await app.route('POST', '/api/db/operations/:ref').handler(fakeHonoContext({
    params: {
      ref: 'users.get',
    },
    body: {
      variables: {
        id: 'u_1',
      },
    },
  }));
  const authorized = await app.route('POST', '/api/db/operations/:ref').handler(fakeHonoContext({
    params: {
      ref: 'users.get',
    },
    body: {
      variables: {
        id: 'u_1',
      },
    },
    headers: {
      authorization: 'Bearer test',
    },
  }));

  assert.equal(unauthorized.status, 401);
  assert.deepEqual(unauthorized.body, { error: 'Unauthorized' });
  assert.equal(authorized.status, 200);
  assert.deepEqual(authorized.body, {
    id: 'u_1',
    name: 'Ada',
  });
  assert.deepEqual(calls, ['operation:users.get', 'operation:users.get']);
});

test('registerDbRoutes can disable operation routes for a local mount', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const db = await openDb({
    cwd,
    operations: {
      enabled: true,
      registry: {
        'users.get': {
          name: 'GetUser',
          method: 'GET',
          path: '/users/{id}.json',
        },
      },
    },
  });
  const app = fakeHonoApp();

  registerDbRoutes(app, db, {
    prefix: '/api/db',
    operations: false,
  });

  assert.equal(Boolean(app.route('GET', '/api/db/users')), true);
  assert.equal(Boolean(app.route('POST', '/api/db/operations/:ref')), false);
});

test('registerDbRoutes supports local operation registry overrides', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada', email: 'ada@example.com' }]));
  const db = await openDb({
    cwd,
    operations: {
      enabled: true,
      registry: {
        'sha256:global': {
          name: 'GlobalUser',
          method: 'GET',
          path: '/users/{id}.json',
          query: {
            select: 'id',
          },
        },
      },
    },
  });
  const app = fakeHonoApp();

  registerDbRoutes(app, db, {
    prefix: '/api/db',
    operations: {
      registry: {
        LocalUser: {
          name: 'LocalUser',
          method: 'GET',
          path: '/users/{id}.json',
          query: {
            select: 'id,email',
          },
        },
      },
      acceptRefs: 'name',
    },
  });

  const response = await app.route('POST', '/api/db/operations/:ref').handler(fakeHonoContext({
    params: {
      ref: 'LocalUser',
    },
    body: {
      variables: {
        id: 'u_1',
      },
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    id: 'u_1',
    email: 'ada@example.com',
  });
});

test('registerDbRoutes supports custom operation resolveRef and validateRef', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const db = await openDb({ cwd });
  const app = fakeHonoApp();
  const registry = {
    'internal:get-user': {
      method: 'GET',
      path: '/users/{id}.json',
    },
  };

  registerDbRoutes(app, db, {
    prefix: '/api/db',
    operations: {
      resolveRef(ref) {
        return ref.endsWith('get-user') ? registry['internal:get-user'] : null;
      },
      validateRef({ decodedRef }) {
        return decodedRef.startsWith('public:');
      },
    },
  });

  const rejected = await app.route('POST', '/api/db/operations/:ref').handler(fakeHonoContext({
    params: {
      ref: 'internal:get-user',
    },
    body: {
      variables: {
        id: 'u_1',
      },
    },
  }));
  const accepted = await app.route('POST', '/api/db/operations/:ref').handler(fakeHonoContext({
    params: {
      ref: 'public:get-user',
    },
    body: {
      variables: {
        id: 'u_1',
      },
    },
  }));

  assert.equal(rejected.status, 404);
  assert.equal(rejected.body.error.code, 'OPERATION_NOT_FOUND');
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body, {
    id: 'u_1',
    name: 'Ada',
  });
});

test('registerDbRoutes operation bodies accept empty JSON bodies', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({ theme: 'dark' }));
  const db = await openDb({
    cwd,
    operations: {
      enabled: true,
      registry: {
        GetSettings: {
          name: 'GetSettings',
          method: 'GET',
          path: '/settings.json',
        },
      },
      acceptRefs: 'name',
    },
  });
  const app = fakeHonoApp();

  registerDbRoutes(app, db, {
    prefix: '/api/db',
  });

  const response = await app.route('POST', '/api/db/operations/:ref').handler(fakeHonoContext({
    params: {
      ref: 'GetSettings',
    },
    rawBody: '',
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { theme: 'dark' });
});

test('registerDbRoutes operation bodies return structured JSON errors', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({ theme: 'dark' }));
  const db = await openDb({
    cwd,
    server: {
      maxBodyBytes: 8,
    },
    operations: {
      enabled: true,
      registry: {
        GetSettings: {
          name: 'GetSettings',
          method: 'GET',
          path: '/settings.json',
        },
      },
      acceptRefs: 'name',
    },
  });
  const app = fakeHonoApp();

  registerDbRoutes(app, db, {
    prefix: '/api/db',
  });

  const invalid = await app.route('POST', '/api/db/operations/:ref').handler(fakeHonoContext({
    params: {
      ref: 'GetSettings',
    },
    rawBody: '{',
  }));
  const oversized = await app.route('POST', '/api/db/operations/:ref').handler(fakeHonoContext({
    params: {
      ref: 'GetSettings',
    },
    rawBody: '{"variables":{}}',
  }));

  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'REST_INVALID_JSON_BODY');
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, 'JSON_BODY_TOO_LARGE');
});

test('registerDbRoutes preserves operation response content types', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const db = await openDb({
    cwd,
    operations: {
      enabled: true,
      registry: {
        GetUserMarkdown: {
          name: 'GetUserMarkdown',
          method: 'GET',
          path: '/users/{id}.md',
        },
      },
      acceptRefs: 'name',
    },
  });
  const app = fakeHonoApp();

  registerDbRoutes(app, db, {
    prefix: '/api/db',
  });

  const response = await app.route('POST', '/api/db/operations/:ref').handler(fakeHonoContext({
    params: {
      ref: 'GetUserMarkdown',
    },
    body: {
      variables: {
        id: 'u_1',
      },
    },
  }));

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/markdown/);
  assert.match(response.body, /Ada/);
});

function fakeContext() {
  const values = new Map();
  return {
    set(key, value) {
      values.set(key, value);
    },
    get(key) {
      return values.get(key);
    },
  };
}

function fakeHonoApp() {
  const routes = [];
  const app = {
    routes,
    route(method, routePath) {
      return routes.find((route) => route.method === method && route.path === routePath);
    },
  };

  for (const method of ['get', 'post', 'patch', 'delete', 'put']) {
    app[method] = (routePath, handler) => {
      routes.push({
        method: method.toUpperCase(),
        path: routePath,
        handler,
      });
    };
  }

  return app;
}

function fakeHonoContext(options = {}) {
  const headers = {};
  function response(body, status, responseHeaders = {}) {
    for (const [name, value] of Object.entries(responseHeaders ?? {})) {
      headers[String(name).toLowerCase()] = value;
    }
    const result = {
      status,
      body,
    };
    if (Object.keys(headers).length > 0) {
      result.headers = { ...headers };
    }
    return result;
  }

  return {
    req: {
      param(name) {
        return options.params?.[name];
      },
      async text() {
        if ('rawBody' in options) {
          return options.rawBody;
        }
        return JSON.stringify(options.body ?? {});
      },
      async json() {
        return options.body ?? {};
      },
      header(name) {
        return options.headers?.[String(name).toLowerCase()] ?? options.headers?.[name];
      },
      url: options.url ?? 'http://db.local/api/pages',
    },
    header(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    json(body, status = 200) {
      return response(body, status);
    },
    body(value, status = 200, responseHeaders = {}) {
      return response(value, status, responseHeaders);
    },
  };
}
