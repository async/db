import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openDb } from './db.js';
import { makeProject, writeConfig, writeFixture } from '../test/helpers.js';
import { createDbRequestHandler, reloadDb, watchSourceDir } from './server.js';

test('server reload path keeps valid resources when another source file fails', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const db = await openDb({ cwd, allowSourceErrors: true });
  await writeFixture(cwd, 'posts.json', JSON.stringify([{ id: 'p_1', title: 'Hello' }]));

  const withPosts = await reloadDb(db);
  assert.equal(withPosts.schema.resources.posts.routePath, '/posts');
  assert.equal(Boolean(db.resources.get('posts')), true);

  await writeFixture(cwd, 'broken.json', '{"id": ');

  const withError = await reloadDb(db);
  assert.equal(Boolean(withError.schema.resources.users), true);
  assert.equal(Boolean(withError.schema.resources.posts), true);
  assert.equal(withError.diagnostics[0].code, 'SOURCE_LOAD_FAILED');
  assert.equal(withError.diagnostics[0].file, 'db/broken.json');
  assert.equal(Boolean(db.resources.get('users')), true);
  assert.equal(Boolean(db.resources.get('posts')), true);
});

test('server source watch falls back without crashing when file watchers are unavailable', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const db = await openDb({ cwd, allowSourceErrors: true });
  const published = [];
  const warnings = [];
  const error = new Error('too many open files, watch');
  error.code = 'EMFILE';

  const watcher = await watchSourceDir(db, {
    publish(payload) {
      published.push(payload);
    },
  }, {
    watch() {
      throw error;
    },
    warn(message) {
      warnings.push(message);
    },
  });

  assert.equal(watcher.enabled, false);
  assert.equal(db.diagnostics.at(-1).code, 'SERVER_WATCH_UNAVAILABLE');
  assert.equal(published[0].type, 'watch-disabled');
  assert.match(warnings[0], /disabled.*too many open files/i);
  watcher.close();
});

test('server source watch handles watcher error events without crashing', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const db = await openDb({ cwd, allowSourceErrors: true });
  const published = [];
  const warnings = [];
  const fsWatcher = new EventEmitter();
  fsWatcher.close = () => {};

  const watcher = await watchSourceDir(db, {
    publish(payload) {
      published.push(payload);
    },
  }, {
    watch() {
      return fsWatcher;
    },
    warn(message) {
      warnings.push(message);
    },
  });

  const error = new Error('system limit for number of file watchers reached');
  error.code = 'ENOSPC';
  fsWatcher.emit('error', error);

  assert.equal(watcher.enabled, false);
  assert.equal(db.diagnostics.at(-1).code, 'SERVER_WATCH_UNAVAILABLE');
  assert.equal(published[0].type, 'watch-disabled');
  assert.match(warnings[0], /disabled.*file watchers/i);
  watcher.close();
});

test('server source watch ignores dot folders inside db', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const db = await openDb({ cwd, allowSourceErrors: true });
  const published = [];
  const fsWatcher = new EventEmitter();
  fsWatcher.close = () => {};

  const watcher = await watchSourceDir(db, {
    publish(payload) {
      published.push(payload);
    },
  }, {
    watch(_directory, _options, listener) {
      fsWatcher.listener = listener;
      return fsWatcher;
    },
  });

  fsWatcher.listener('change', '.db/state/users.json');
  fsWatcher.listener('change', '.cache/internal.json');
  await new Promise((resolve) => setTimeout(resolve, 125));

  assert.deepEqual(published, []);
  watcher.close();
});

test('server source watch stays attached to db sources and ignores store writes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const db = await openDb({ cwd, allowSourceErrors: true });
  const published = [];
  const fsWatcher = new EventEmitter();
  fsWatcher.close = () => {};
  let watchedDirectory;

  const watcher = await watchSourceDir(db, {
    publish(payload) {
      published.push(payload);
    },
  }, {
    watch(directory, _options, listener) {
      watchedDirectory = directory;
      fsWatcher.listener = listener;
      return fsWatcher;
    },
  });

  assert.equal(watchedDirectory, db.config.sourceDir);

  await db.collection('users').create({ id: 'u_2', name: 'Grace' });
  await new Promise((resolve) => setTimeout(resolve, 125));
  assert.deepEqual(published, []);

  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada' },
    { id: 'u_3', name: 'Katherine' },
  ]));
  fsWatcher.listener('change', 'users.json');
  await new Promise((resolve) => setTimeout(resolve, 125));

  assert.equal(published.length, 1);
  assert.equal(published[0].type, 'synced');
  assert.deepEqual((await db.collection('users').all()).map((user) => user.id), ['u_1', 'u_3']);
  watcher.close();
});

test('request handler supports scoped Vite routes without root REST routes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]));

  const db = await openDb({
    cwd,
    allowSourceErrors: true,
    rest: {
      formats: {
        yaml: {
          mediaTypes: ['application/yaml'],
          contentType: 'application/yaml; charset=utf-8',
          render({ data }) {
            return `yaml: ${JSON.stringify(data)}\n`;
          },
        },
      },
    },
  });
  const handler = createDbRequestHandler(db, {
    apiBase: '/__db',
    rootRoutes: false,
    graphqlPath: '/__db/graphql',
    restBasePath: '/__db/rest',
  });

  const users = makeResponse();
  const schema = makeResponse();
  const manifest = makeResponse();
  const manifestMarkdown = makeResponse();
  const manifestYaml = makeResponse();
  const batch = makeResponse();
  const graphql = makeResponse();
  const dataUsers = makeResponse();
  const rootUsers = makeResponse();
  let passedThrough = false;

  assert.equal(await handler(makeRequest('GET', '/__db/rest/users'), users), true);
  assert.equal(await handler(makeRequest('GET', '/db/users.json'), dataUsers), true);
  assert.equal(await handler(makeRequest('GET', '/__db/schema'), schema), true);
  assert.equal(await handler(makeRequest('GET', '/__db/manifest'), manifest), true);
  assert.equal(await handler(makeRequest('GET', '/__db/manifest.md'), manifestMarkdown), true);
  assert.equal(await handler(makeRequest('GET', '/__db/manifest.yaml'), manifestYaml), true);
  assert.equal(await handler(makeRequest('POST', '/__db/batch', [
    { method: 'GET', path: '/users' },
  ]), batch), true);
  assert.equal(await handler(makeRequest('POST', '/__db/graphql', {
    query: '{ users { id } }',
  }), graphql), true);
  assert.equal(await handler(makeRequest('GET', '/users'), rootUsers, () => {
    passedThrough = true;
  }), false);

  assert.equal(users.status, 200);
  assert.deepEqual(users.json(), [{ id: 'u_1', name: 'Ada' }]);
  assert.equal(dataUsers.status, 200);
  assert.deepEqual(dataUsers.json(), [{ id: 'u_1', name: 'Ada' }]);
  assert.equal(schema.status, 200);
  assert.equal(schema.json().resources.users.routePath, '/users');
  assert.equal(manifest.status, 200);
  assert.equal(manifest.json().api.manifest, '/__db/manifest');
  assert.equal(manifest.json().api.manifestJson, '/__db/manifest.json');
  assert.equal(manifest.json().api.manifestMarkdown, '/__db/manifest.md');
  assert.equal(manifest.json().api.resources.users.list, '/__db/rest/users');
  assert.equal(manifestMarkdown.status, 200);
  assert.match(manifestMarkdown.headers['content-type'], /text\/markdown/);
  assert.match(manifestMarkdown.body, /^# db viewer manifest/m);
  assert.equal(manifestYaml.status, 200);
  assert.match(manifestYaml.headers['content-type'], /application\/yaml/);
  assert.match(manifestYaml.body, /db\.viewerManifest/);
  assert.equal(batch.status, 200);
  assert.equal(batch.json()[0].body[0].id, 'u_1');
  assert.equal(graphql.status, 200);
  assert.deepEqual(graphql.json().data.users, [{ id: 'u_1' }]);
  assert.equal(rootUsers.status, null);
  assert.equal(passedThrough, true);
});

test('request handler preserves standalone root REST and GraphQL routes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]));

  const db = await openDb({ cwd, allowSourceErrors: true });
  const handler = createDbRequestHandler(db);
  const users = makeResponse();
  const dataUsers = makeResponse();
  const dataUser = makeResponse();
  const dataUserJson = makeResponse();
  const scopedUsers = makeResponse();
  const scopedUser = makeResponse();
  const graphql = makeResponse();

  assert.equal(await handler(makeRequest('GET', '/users'), users), true);
  assert.equal(await handler(makeRequest('GET', '/db/users.json'), dataUsers), true);
  assert.equal(await handler(makeRequest('GET', '/db/users/u_1'), dataUser), true);
  assert.equal(await handler(makeRequest('GET', '/db/users/u_1.json'), dataUserJson), true);
  assert.equal(await handler(makeRequest('GET', '/__db/rest/users.json'), scopedUsers), true);
  assert.equal(await handler(makeRequest('GET', '/__db/rest/users/u_1'), scopedUser), true);
  assert.equal(await handler(makeRequest('POST', '/graphql', {
    query: '{ users { id } }',
  }), graphql), true);

  assert.equal(users.status, 200);
  assert.deepEqual(users.json(), [{ id: 'u_1', name: 'Ada' }]);
  assert.equal(dataUsers.status, 200);
  assert.deepEqual(dataUsers.json(), [{ id: 'u_1', name: 'Ada' }]);
  assert.equal(dataUser.status, 200);
  assert.deepEqual(dataUser.json(), { id: 'u_1', name: 'Ada' });
  assert.equal(dataUserJson.status, 200);
  assert.deepEqual(dataUserJson.json(), { id: 'u_1', name: 'Ada' });
  assert.equal(scopedUsers.status, 200);
  assert.deepEqual(scopedUsers.json(), [{ id: 'u_1', name: 'Ada' }]);
  assert.equal(scopedUser.status, 200);
  assert.deepEqual(scopedUser.json(), { id: 'u_1', name: 'Ada' });
  assert.equal(graphql.status, 200);
  assert.deepEqual(graphql.json().data.users, [{ id: 'u_1' }]);
});

test('request handler can disable the dataPath alias while keeping scoped REST', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]));
  await writeConfig(cwd, `export default {
    server: {
      dataPath: false,
    },
  };`);

  const db = await openDb({ cwd, allowSourceErrors: true });
  const handler = createDbRequestHandler(db);
  const dataUsers = makeResponse();
  const scopedUsers = makeResponse();

  assert.equal(await handler(makeRequest('GET', '/db/users.json'), dataUsers), true);
  assert.equal(await handler(makeRequest('GET', '/__db/rest/users.json'), scopedUsers), true);

  assert.equal(dataUsers.status, 404);
  assert.equal(dataUsers.json().error.code, 'REST_UNKNOWN_RESOURCE');
  assert.equal(scopedUsers.status, 200);
  assert.deepEqual(scopedUsers.json(), [{ id: 'u_1', name: 'Ada' }]);
});

test('request handler disables GraphQL when graphql.enabled is false', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]));
  await writeConfig(cwd, `export default {
    graphql: {
      enabled: false
    },
    mock: {
      delay: [0, 0],
      errors: {
        rate: 1,
        status: 599,
        message: 'forced chaos'
      }
    }
  };`);

  const db = await openDb({ cwd, allowSourceErrors: true });
  const handler = createDbRequestHandler(db);
  const users = makeResponse();
  const graphql = makeResponse();

  assert.equal(await handler(makeRequest('GET', '/users'), users), true);
  assert.equal(await handler(makeRequest('POST', '/graphql', {
    query: '{ users { id } }',
  }), graphql), true);

  assert.equal(users.status, 599);
  assert.equal(users.json().mock, true);
  assert.equal(graphql.status, 404);
  assert.equal(graphql.json().error.code, 'GRAPHQL_DISABLED');
  assert.equal(graphql.json().error.details.path, '/graphql');
});

test('request handler disables generated REST routes when rest.enabled is false', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]));
  await writeConfig(cwd, `export default {
    rest: {
      enabled: false,
    },
  };`);

  const db = await openDb({ cwd, allowSourceErrors: true });
  const handler = createDbRequestHandler(db);
  const root = makeResponse();
  const users = makeResponse();
  const batch = makeResponse();
  const schema = makeResponse();
  const manifest = makeResponse();
  const graphql = makeResponse();

  assert.equal(await handler(makeRequest('GET', '/'), root), true);
  assert.equal(await handler(makeRequest('GET', '/users'), users), true);
  assert.equal(await handler(makeRequest('POST', '/__db/batch', [
    { method: 'GET', path: '/users' },
  ]), batch), true);
  assert.equal(await handler(makeRequest('GET', '/__db/schema'), schema), true);
  assert.equal(await handler(makeRequest('GET', '/__db/manifest'), manifest), true);
  assert.equal(await handler(makeRequest('POST', '/graphql', {
    query: '{ users { id } }',
  }), graphql), true);

  assert.equal(root.status, 200);
  assert.deepEqual(root.json().links.resources, {});
  assert.equal(users.status, 404);
  assert.equal(users.json().error.code, 'REST_DISABLED');
  assert.equal(users.json().error.details.resource, 'users');
  assert.equal(batch.status, 404);
  assert.equal(batch.json().error.code, 'REST_DISABLED');
  assert.equal(schema.status, 200);
  assert.equal(schema.json().resources.users.routePath, '/users');
  assert.equal(manifest.status, 200);
  assert.equal(manifest.json().capabilities.rest, false);
  assert.equal(manifest.json().capabilities.writes, false);
  assert.equal(manifest.json().capabilities.restBatch, false);
  assert.equal(manifest.json().capabilities.graphql, true);
  assert.equal(graphql.status, 200);
  assert.deepEqual(graphql.json().data.users, [{ id: 'u_1' }]);
});

test('request handler reports disabled REST before mock errors', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]));
  await writeConfig(cwd, `export default {
    rest: {
      enabled: false,
    },
    mock: {
      delay: [0, 0],
      errors: {
        rate: 1,
        status: 599,
        message: 'forced chaos'
      }
    }
  };`);

  const db = await openDb({ cwd, allowSourceErrors: true });
  const handler = createDbRequestHandler(db);
  const users = makeResponse();

  assert.equal(await handler(makeRequest('GET', '/users'), users), true);

  assert.equal(users.status, 404);
  assert.equal(users.json().error.code, 'REST_DISABLED');
  assert.equal(users.json().error.details.resource, 'users');
});

test('request handler derives standalone dev-tool routes from configured server apiBase', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_main',
      name: 'Main Ada',
    },
  ]));
  await mkdir(path.join(cwd, 'db.forks/legacy-demo'), { recursive: true });
  await writeFile(path.join(cwd, 'db.forks/legacy-demo/users.json'), `${JSON.stringify([
    {
      id: 'u_legacy',
      fullName: 'Legacy Ada',
    },
  ])}\n`, 'utf8');
  await writeConfig(cwd, `export default {
    server: {
      apiBase: '/_db',
    },
    rest: {
      formats: {
        yaml: {
          mediaTypes: ['application/yaml'],
          contentType: 'application/yaml; charset=utf-8',
          render({ data }) {
            return 'yaml: ' + JSON.stringify(data) + '\\n';
          },
        },
      },
    },
    forks: ['legacy-demo'],
  };`);

  const db = await openDb({ cwd, allowSourceErrors: true });
  const handler = createDbRequestHandler(db);
  const viewer = makeResponse();
  const schema = makeResponse();
  const manifest = makeResponse();
  const batch = makeResponse();
  const imported = makeResponse();
  const events = makeResponse();
  const log = makeResponse();
  const forkUsers = makeResponse();
  const forkBatch = makeResponse();
  const forkSchema = makeResponse();
  const forkManifest = makeResponse();
  const forkManifestYaml = makeResponse();
  const forkGraphql = makeResponse();
  const rootUsers = makeResponse();
  const rootGraphql = makeResponse();

  assert.equal(await handler(makeRequest('GET', '/_db'), viewer), true);
  assert.equal(await handler(makeRequest('GET', '/_db/schema'), schema), true);
  assert.equal(await handler(makeRequest('GET', '/_db/manifest'), manifest), true);
  assert.equal(await handler(makeRequest('POST', '/_db/batch', [
    { method: 'GET', path: '/users' },
  ]), batch), true);
  assert.equal(await handler(makeRawRequest('POST', '/_db/import', 'id,name\nu_2,Grace\n', {
    'x-db-file-name': 'Imported Users.csv',
  }), imported), true);
  assert.equal(await handler(makeRequest('GET', '/_db/events'), events), true);
  assert.equal(await handler(makeRequest('GET', '/_db/log'), log), true);
  assert.equal(await handler(makeRequest('GET', '/_db/forks/legacy-demo/rest/users'), forkUsers), true);
  assert.equal(await handler(makeRequest('POST', '/_db/forks/legacy-demo/batch', [
    { method: 'GET', path: '/users' },
  ]), forkBatch), true);
  assert.equal(await handler(makeRequest('GET', '/_db/forks/legacy-demo/schema'), forkSchema), true);
  assert.equal(await handler(makeRequest('GET', '/_db/forks/legacy-demo/manifest'), forkManifest), true);
  assert.equal(await handler(makeRequest('GET', '/_db/forks/legacy-demo/manifest.yaml'), forkManifestYaml), true);
  assert.equal(await handler(makeRequest('POST', '/_db/forks/legacy-demo/graphql', {
    query: '{ users { id fullName } }',
  }), forkGraphql), true);
  assert.equal(await handler(makeRequest('GET', '/users'), rootUsers), true);
  assert.equal(await handler(makeRequest('POST', '/graphql', {
    query: '{ users { id } }',
  }), rootGraphql), true);

  assert.equal(viewer.status, 200);
  assert.match(viewer.body, /db viewer/);
  assert.equal(schema.status, 200);
  assert.equal(schema.json().resources.users.routePath, '/users');
  assert.equal(manifest.status, 200);
  assert.equal(manifest.json().api.manifest, '/_db/manifest');
  assert.equal(manifest.json().api.manifestJson, '/_db/manifest.json');
  assert.equal(manifest.json().api.manifestMarkdown, '/_db/manifest.md');
  assert.equal(manifest.json().api.resources.users.list, '/_db/rest/users');
  assert.equal(batch.status, 200);
  assert.equal(batch.json()[0].body[0].id, 'u_main');
  assert.equal(imported.status, 201);
  assert.equal(imported.json().viewerPath, '/_db?resource=importedUsers');
  assert.equal(events.status, 200);
  assert.match(events.body, /event: db/);
  assert.equal(log.status, 200);
  assert.match(log.headers['content-type'], /text\/event-stream/);
  assert.deepEqual(forkUsers.json(), [{ id: 'u_legacy', fullName: 'Legacy Ada' }]);
  assert.equal(forkBatch.json()[0].body[0].id, 'u_legacy');
  assert.equal(forkSchema.json().resources.users.fields.fullName.type, 'string');
  assert.equal(forkManifest.json().api.manifest, '/_db/forks/legacy-demo/manifest');
  assert.equal(forkManifest.json().api.manifestJson, '/_db/forks/legacy-demo/manifest.json');
  assert.equal(forkManifest.json().api.manifestMarkdown, '/_db/forks/legacy-demo/manifest.md');
  assert.equal(forkManifest.json().api.resources.users.list, '/_db/forks/legacy-demo/rest/users');
  assert.equal(forkManifestYaml.status, 200);
  assert.match(forkManifestYaml.headers['content-type'], /application\/yaml/);
  assert.match(forkManifestYaml.body, /db\.viewerManifest/);
  assert.deepEqual(forkGraphql.json().data.users, [{ id: 'u_legacy', fullName: 'Legacy Ada' }]);
  assert.deepEqual(rootUsers.json(), [{ id: 'u_main', name: 'Main Ada' }]);
  assert.deepEqual(rootGraphql.json().data.users, [{ id: 'u_main' }]);
});

test('request handler routes configured fork REST, batch, schema, and GraphQL requests', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_main',
      name: 'Main Ada',
    },
  ]));
  await mkdir(path.join(cwd, 'db.forks/legacy-demo'), { recursive: true });
  await writeFile(path.join(cwd, 'db.forks/legacy-demo/users.json'), `${JSON.stringify([
    {
      id: 'u_legacy',
      fullName: 'Legacy Ada',
    },
  ])}\n`, 'utf8');
  await writeConfig(cwd, `export default {
    forks: ['legacy-demo'],
  };`);

  const db = await openDb({ cwd, allowSourceErrors: true });
  const handler = createDbRequestHandler(db);
  const mainUsers = makeResponse();
  const forkUsers = makeResponse();
  const forkBatch = makeResponse();
  const forkSchema = makeResponse();
  const forkManifest = makeResponse();
  const forkGraphql = makeResponse();

  assert.equal(await handler(makeRequest('GET', '/users'), mainUsers), true);
  assert.equal(await handler(makeRequest('GET', '/__db/forks/legacy-demo/rest/users'), forkUsers), true);
  assert.equal(await handler(makeRequest('POST', '/__db/forks/legacy-demo/batch', [
    { method: 'GET', path: '/users' },
  ]), forkBatch), true);
  assert.equal(await handler(makeRequest('GET', '/__db/forks/legacy-demo/schema'), forkSchema), true);
  assert.equal(await handler(makeRequest('GET', '/__db/forks/legacy-demo/manifest'), forkManifest), true);
  assert.equal(await handler(makeRequest('POST', '/__db/forks/legacy-demo/graphql', {
    query: '{ users { id fullName } }',
  }), forkGraphql), true);

  assert.deepEqual(mainUsers.json(), [{ id: 'u_main', name: 'Main Ada' }]);
  assert.deepEqual(forkUsers.json(), [{ id: 'u_legacy', fullName: 'Legacy Ada' }]);
  assert.equal(forkBatch.json()[0].body[0].id, 'u_legacy');
  assert.equal(forkSchema.json().resources.users.fields.fullName.type, 'string');
  assert.equal(forkManifest.json().api.manifest, '/__db/forks/legacy-demo/manifest');
  assert.equal(forkManifest.json().api.manifestJson, '/__db/forks/legacy-demo/manifest.json');
  assert.equal(forkManifest.json().api.manifestMarkdown, '/__db/forks/legacy-demo/manifest.md');
  assert.equal(forkManifest.json().api.resources.users.list, '/__db/forks/legacy-demo/rest/users');
  assert.deepEqual(forkGraphql.json().data.users, [{ id: 'u_legacy', fullName: 'Legacy Ada' }]);
});

test('request handler returns a structured 404 for unknown forks', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const db = await openDb({ cwd, allowSourceErrors: true });
  const handler = createDbRequestHandler(db);
  const response = makeResponse();

  assert.equal(await handler(makeRequest('GET', '/__db/forks/missing/rest/users'), response), true);
  assert.equal(response.status, 404);
  assert.equal(response.json().error.code, 'FORK_NOT_FOUND');
});

test('request handler streams live runtime log events', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]));

  const db = await openDb({ cwd, allowSourceErrors: true });
  const handler = createDbRequestHandler(db);
  const response = makeResponse();

  assert.equal(await handler(makeRequest('GET', '/__db/log'), response), true);
  await db.collection('users').create({ id: 'u_2', name: 'Grace' });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/event-stream/);
  assert.match(response.body, /event: db-log/);
  assert.match(response.body, /"resource":"users"/);
  assert.match(response.body, /"op":"create"/);
});

function makeRequest(method, requestPath, body) {
  return {
    method,
    url: requestPath,
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
    on() {},
  };
}

function makeRawRequest(method, requestPath, body, headers = {}) {
  return {
    method,
    url: requestPath,
    headers,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body);
    },
    on() {},
  };
}

function makeResponse() {
  return {
    status: null,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk = '') {
      this.body += chunk;
    },
    end(chunk = '') {
      this.body += chunk;
    },
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}
