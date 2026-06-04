import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { openDb as typedOpenDb } from './db.js';
import { createDbRuntime as typedCreateDbRuntime, createDbRuntimeEvents, reloadDb as typedReloadDb, watchDbSources as typedWatchDbSources } from './runtime.js';
import { loadConfig as typedLoadConfig, syncDb as typedSyncDb } from './index.js';
import { makeProject, writeFixture } from '../test/helpers.js';

const openDb = async (options: unknown): Promise<any> => typedOpenDb(options as never) as Promise<any>;
const createDbRuntime = async (...args: any[]): Promise<any> => typedCreateDbRuntime(args[0] as never) as Promise<any>;
const reloadDb = async (...args: any[]): Promise<any> => typedReloadDb(args[0] as never, args[1] as never) as Promise<any>;
const watchDbSources = async (...args: any[]): Promise<any> => typedWatchDbSources(args[0] as never, args[1] as never) as Promise<any>;
const loadConfig = async (options: unknown): Promise<any> => typedLoadConfig(options as never) as Promise<any>;
const syncDb = async (...args: any[]): Promise<any> => typedSyncDb(args[0] as never, args[1] as never) as Promise<any>;

test('createDbRuntime opens db, serves requests, publishes events, and closes idempotently', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const runtime = await createDbRuntime({ cwd, watch: false });
  const response = makeResponse();
  let received: unknown = null;
  const unsubscribe = runtime.events.subscribe((event) => {
    received = event;
  });

  await runtime.handleRequest(makeRequest('GET', '/db/users.json'), response);
  runtime.events.publish({ type: 'synced', version: 1, diagnostics: [] });
  unsubscribe();

  assert.equal(runtime.watcher, null);
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), [{ id: 'u_1', name: 'Ada' }]);
  assert.deepEqual(received, { type: 'synced', version: 1, diagnostics: [] });

  await runtime.close();
  await runtime.close();
});

test('runtime module does not import the server module', async () => {
  const source = await readFile(new URL('./runtime.js', import.meta.url), 'utf8');

  assert.equal(source.includes('./server.js'), false);
});

test('createDbRuntime hydrates existing state when syncOnOpen is false', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await syncDb(await loadConfig({ cwd }));

  const runtime = await createDbRuntime({ cwd, syncOnOpen: false, watch: false });
  const response = makeResponse();

  await runtime.handleRequest(makeRequest('GET', '/db/users.json'), response);

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), [{ id: 'u_1', name: 'Ada' }]);
  await runtime.close();
});

test('createDbRuntime reload updates resources and publishes synced events', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const runtime = await createDbRuntime({ cwd, watch: false });
  const events: unknown[] = [];
  runtime.events.subscribe((event) => {
    events.push(event);
  });

  await writeFixture(cwd, 'posts.json', JSON.stringify([{ id: 'p_1', title: 'Hello' }]));
  const project = await runtime.reload();

  assert.equal(Boolean(runtime.db.resources.get('posts')), true);
  assert.equal(typeof runtime.db.resources.migrate, 'function');
  assert.equal(project.schema.resources.posts.routePath, '/posts');
  assert.equal((events[0] as { type?: string }).type, 'synced');
  await runtime.close();
});

test('reloadDb keeps valid resources available when another source file fails', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const db = await openDb({ cwd, allowSourceErrors: true });
  await writeFixture(cwd, 'broken.json', '{"id": ');

  const project = await reloadDb(db);

  assert.equal(Boolean(project.schema.resources.users), true);
  assert.equal(project.diagnostics[0].code, 'SOURCE_LOAD_FAILED');
  assert.equal(Boolean(db.resources.get('users')), true);
  assert.equal(typeof db.resources.migrate, 'function');
  await db.close();
});

test('watchDbSources reloads changed source files and publishes events', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const db = await openDb({ cwd, allowSourceErrors: true });
  const events = createDbRuntimeEvents();
  const published: unknown[] = [];
  events.subscribe((event) => {
    published.push(event);
  });
  const fsWatcher: any = new EventEmitter();
  fsWatcher.close = () => {};

  const watcher = await watchDbSources(db, {
    events,
    debounceMs: 1,
    watch(_directory: string, _options: unknown, listener: (event: string, filename: string) => void) {
      fsWatcher.listener = listener;
      return fsWatcher;
    },
  });

  await writeFixture(cwd, 'posts.json', JSON.stringify([{ id: 'p_1', title: 'Hello' }]));
  fsWatcher.listener('change', 'posts.json');
  await wait(25);

  assert.equal(watcher.enabled, true);
  assert.equal(Boolean(db.resources.get('posts')), true);
  assert.equal((published[0] as { type?: string }).type, 'synced');
  watcher.close();
  events.close();
  await db.close();
});

test('watchDbSources reports unavailable file watchers without crashing', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const db = await openDb({ cwd, allowSourceErrors: true });
  const events = createDbRuntimeEvents();
  const published: unknown[] = [];
  const warnings: string[] = [];
  events.subscribe((event) => {
    published.push(event);
  });
  const error: any = new Error('too many open files, watch');
  error.code = 'EMFILE';

  const watcher = await watchDbSources(db, {
    events,
    watch() {
      throw error;
    },
    warn(message: string) {
      warnings.push(message);
    },
  });

  assert.equal(watcher.enabled, false);
  assert.equal(db.diagnostics.at(-1).code, 'SERVER_WATCH_UNAVAILABLE');
  assert.equal((published[0] as { type?: string }).type, 'watch-disabled');
  assert.match(warnings[0], /disabled.*too many open files/i);
  watcher.close();
  events.close();
  await db.close();
});

function makeRequest(method: string, requestPath: string, body: unknown = undefined) {
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

function makeResponse() {
  return {
    status: null as number | null,
    headers: {} as Record<string, unknown>,
    body: '',
    writeHead(status: number, headers: Record<string, unknown> = {}) {
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
