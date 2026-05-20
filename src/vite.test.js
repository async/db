import assert from 'node:assert/strict';
import test from 'node:test';
import { dbPlugin } from './vite.js';
import { makeProject, writeFixture } from '../test/helpers.js';

test('db Vite plugin is serve-only and exposes a virtual client module', async () => {
  const plugin = dbPlugin({
    apiBase: '/__db',
  });

  assert.equal(plugin.name, 'db:vite');
  assert.equal(plugin.apply, 'serve');
  assert.equal(await plugin.resolveId('virtual:db/client'), '\0virtual:db/client');

  const loaded = await plugin.load('\0virtual:db/client');
  assert.match(loaded, /db\/client/);
  assert.match(loaded, /restBasePath: "\/__db\/rest"/);
  assert.match(loaded, /graphqlPath: "\/__db\/graphql"/);
  assert.match(loaded, /restBatchPath: "\/__db\/batch"/);
  assert.match(loaded, /export function fork/);
  assert.match(loaded, /client\.fork = fork/);
});

test('db Vite virtual client creates fork clients under the configured apiBase', async () => {
  const plugin = dbPlugin({
    apiBase: '/local-data',
  });

  const loaded = await plugin.load('\0virtual:db/client');

  assert.match(loaded, /const forkBase = `\/local-data\/forks\/\$\{encodeURIComponent\(forkName\)\}`;/);
  assert.match(loaded, /restBasePath: `\$\{forkBase\}\/rest`/);
  assert.match(loaded, /restBatchPath: `\$\{forkBase\}\/batch`/);
  assert.match(loaded, /graphqlPath: `\$\{forkBase\}\/graphql`/);
});

test('db Vite plugin falls back to configured server apiBase', async () => {
  const plugin = dbPlugin({
    server: {
      apiBase: '/_db',
    },
  });

  const loaded = await plugin.load('\0virtual:db/client');

  assert.match(loaded, /restBasePath: "\/_db\/rest"/);
  assert.match(loaded, /graphqlPath: "\/_db\/graphql"/);
  assert.match(loaded, /restBatchPath: "\/_db\/batch"/);
  assert.match(loaded, /const forkBase = `\/_db\/forks\/\$\{encodeURIComponent\(forkName\)\}`;/);
});

test('db Vite plugin apiBase option wins over configured server apiBase', async () => {
  const plugin = dbPlugin({
    apiBase: '/plugin-db',
    server: {
      apiBase: '/_db',
    },
  });

  const loaded = await plugin.load('\0virtual:db/client');

  assert.match(loaded, /restBasePath: "\/plugin-db\/rest"/);
  assert.match(loaded, /graphqlPath: "\/plugin-db\/graphql"/);
  assert.match(loaded, /restBatchPath: "\/plugin-db\/batch"/);
  assert.doesNotMatch(loaded, /\/_db/);
});

test('db Vite plugin can render a custom client import for the virtual module', async () => {
  const plugin = dbPlugin({
    clientImport: '@local/db/client',
  });

  const loaded = await plugin.load('\0virtual:db/client');
  assert.match(loaded, /@local\/db\/client/);
});

test('db Vite plugin registers middleware with Vite dev server', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const plugin = dbPlugin({ cwd });
  const middlewares = [];
  let closeServer;
  const server = {
    middlewares: {
      use(middleware) {
        middlewares.push(middleware);
      },
    },
    httpServer: {
      once(event, callback) {
        if (event === 'close') {
          closeServer = callback;
        }
      },
    },
    config: {
      logger: {
        warn() {},
      },
    },
  };

  await plugin.configureServer(server);

  assert.equal(middlewares.length, 1);
  assert.equal(typeof middlewares[0], 'function');
  closeServer?.();
});

test('db Vite plugin serves the default /db data route alias', async (t) => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const plugin = dbPlugin({ cwd });
  const middlewares = [];
  let closeServer;
  const server = {
    middlewares: {
      use(middleware) {
        middlewares.push(middleware);
      },
    },
    httpServer: {
      once(event, callback) {
        if (event === 'close') {
          closeServer = callback;
        }
      },
    },
    config: {
      logger: {
        warn() {},
      },
    },
  };

  await plugin.configureServer(server);
  t.after(() => {
    closeServer?.();
  });

  const response = makeViteResponse();
  let passedThrough = false;
  await middlewares[0](makeViteRequest('GET', '/db/users.json'), response, () => {
    passedThrough = true;
  });

  assert.equal(passedThrough, false);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), [{ id: 'u_1', name: 'Ada' }]);
});

test('db Vite plugin can disable the /db data route alias', async (t) => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const plugin = dbPlugin({
    cwd,
    server: {
      dataPath: false,
    },
  });
  const middlewares = [];
  let closeServer;
  const server = {
    middlewares: {
      use(middleware) {
        middlewares.push(middleware);
      },
    },
    httpServer: {
      once(event, callback) {
        if (event === 'close') {
          closeServer = callback;
        }
      },
    },
    config: {
      logger: {
        warn() {},
      },
    },
  };

  await plugin.configureServer(server);
  t.after(() => {
    closeServer?.();
  });

  const dataResponse = makeViteResponse();
  const scopedResponse = makeViteResponse();
  let passedThrough = false;
  await middlewares[0](makeViteRequest('GET', '/db/users.json'), dataResponse, () => {
    passedThrough = true;
  });
  await middlewares[0](makeViteRequest('GET', '/__db/rest/users.json'), scopedResponse, () => {});

  assert.equal(passedThrough, true);
  assert.equal(dataResponse.statusCode, null);
  assert.equal(scopedResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(scopedResponse.body), [{ id: 'u_1', name: 'Ada' }]);
});

test('db Vite plugin can disable the virtual client module', async () => {
  const plugin = dbPlugin({
    clientVirtualModule: false,
  });

  assert.equal(await plugin.resolveId('virtual:db/client'), null);
});

function makeViteRequest(method, url) {
  return {
    method,
    url,
    headers: {},
    [Symbol.asyncIterator]: async function* emptyBody() {},
    on() {},
  };
}

function makeViteResponse() {
  const headers = {};
  return {
    statusCode: null,
    headers,
    body: '',
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    writeHead(status, nextHeaders = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(nextHeaders)) {
        this.setHeader(name, value);
      }
    },
    end(chunk = '') {
      if (this.statusCode === null) {
        this.statusCode = 200;
      }
      this.body += chunk;
    },
    write(chunk = '') {
      this.body += chunk;
    },
  };
}
