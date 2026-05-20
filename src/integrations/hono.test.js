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
  return {
    req: {
      param(name) {
        return options.params?.[name];
      },
      async json() {
        return options.body ?? {};
      },
      url: options.url ?? 'http://db.local/api/pages',
    },
    json(body, status = 200) {
      return {
        status,
        body,
      };
    },
    body(value, status = 200) {
      return {
        status,
        body: value,
      };
    },
  };
}
