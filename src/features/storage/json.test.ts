import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  atomicWriteJson,
  fileStorage,
  jsonStore,
  readJsonState,
  s3Storage,
  withJsonStateWrite,
} from './json.js';

test('atomicWriteJson writes complete pretty JSON documents', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-atomic-${Date.now()}-`), { recursive: true });
  const filePath = path.join(dir, 'users.json');
  await writeFile(filePath, '[{"id":"old"}]\n', 'utf8');

  await atomicWriteJson(filePath, [{ id: 'new', name: 'Ada' }]);

  assert.equal(await readFile(filePath, 'utf8'), `[
  {
    "id": "new",
    "name": "Ada"
  }
]
`);
});

test('readJsonState reports corrupt JSON state with recovery guidance', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-corrupt-${Date.now()}-`), { recursive: true });
  const filePath = path.join(dir, 'settings.json');
  await writeFile(filePath, '{ not json', 'utf8');

  await assert.rejects(
    () => readJsonState(filePath, {}),
    (error: any) => {
      assert.equal(error.code, 'JSON_STATE_INVALID');
      assert.equal(error.status, 500);
      assert.match(error.message, /JSON state file is not valid JSON/);
      assert.match(error.hint, /known-good snapshot/);
      assert.equal(error.details.filePath, filePath);
      assert.match(error.details.parserMessage, /JSON/);
      return true;
    },
  );
});

test('withJsonStateWrite serializes writes for one JSON state file', async () => {
  const filePath = path.join(tmpdir(), `db-queue-${Date.now()}.json`);
  const events: string[] = [];

  const first = withJsonStateWrite(filePath, async () => {
    events.push('first-start');
    await delay(10);
    events.push('first-end');
    return 'first';
  });
  const second = withJsonStateWrite(filePath, async () => {
    events.push('second');
    return 'second';
  });

  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.deepEqual(events, ['first-start', 'first-end', 'second']);
});

test('withJsonStateWrite continues after a failed queued write', async () => {
  const filePath = path.join(tmpdir(), `db-queue-fail-${Date.now()}.json`);

  await assert.rejects(
    () => withJsonStateWrite(filePath, async () => {
      throw new Error('write failed');
    }),
    /write failed/,
  );

  assert.equal(await withJsonStateWrite(filePath, async () => 'after'), 'after');
});

test('jsonStore file storage writes resources under fork branch storage', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-json-store-${Date.now()}-`), { recursive: true });
  const storeFactory = jsonStore({
    storage: fileStorage(dir),
    durability: 'versioned',
  });
  const store = storeFactory({
    config: {
      cwd: dir,
      stateDir: dir,
      __asyncDbScope: {
        fork: 'tenant_acme',
        branch: 'published',
        rootStateDir: dir,
      },
    },
    resources: [],
    storeName: 'json',
  });
  const resource = { name: 'pages', kind: 'collection' };

  await store.writeResource(resource, [{ id: 'home', slug: 'home', title: 'Home' }]);

  assert.deepEqual(await store.readResource(resource, []), [
    { id: 'home', slug: 'home', title: 'Home' },
  ]);
  assert.equal(
    await readFile(path.join(dir, 'forks/tenant_acme/branches/published/resources/pages.json'), 'utf8'),
    `[
  {
    "id": "home",
    "slug": "home",
    "title": "Home"
  }
]
`,
  );
  assert.equal(store.capabilities.layout, 'resource-files');
});

test('s3Storage returns an object storage descriptor without bundling an SDK', () => {
  assert.deepEqual(s3Storage({
    bucket: 'app-json-db',
    prefix: 'prod',
    encryption: { mode: 'sse-kms', keyId: 'alias/app-json-db' },
  }), {
    kind: 's3',
    bucket: 'app-json-db',
    prefix: 'prod',
    encryption: { mode: 'sse-kms', keyId: 'alias/app-json-db' },
  });
});
