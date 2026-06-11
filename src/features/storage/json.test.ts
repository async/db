import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createMemoryFs } from '../fs/index.js';
import {
  atomicWriteJson,
  atomicWriteJsonVersioned,
  fileStorage,
  jsonStore,
  listJsonStateVersions,
  readJsonState,
  recoverJsonStateDir,
  restoreJsonStateVersion,
  s3Storage,
  statePathForResource,
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

test('jsonStore default storage uses the scoped JSON state path', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-json-store-default-${Date.now()}-`), { recursive: true });
  const config = {
    cwd: dir,
    stateDir: path.join(dir, 'forks/tenant_acme/branches/main'),
    __asyncDbScope: {
      fork: 'tenant_acme',
      branch: 'main',
      rootStateDir: dir,
    },
  };
  const storeFactory = jsonStore();
  const store = storeFactory({
    config,
    resources: [],
    storeName: 'json',
  }) as ReturnType<typeof storeFactory> & { statePath(resource: { name: string }): string };
  const resource = { name: 'pages', kind: 'collection' };

  assert.equal(
    store.statePath(resource),
    statePathForResource(config, resource),
  );
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

test('withJsonStateWrite holds an on-disk lock during the operation and releases it after', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-json-lock-${Date.now()}-`), { recursive: true });
  const filePath = path.join(dir, 'users.json');
  const lockPath = `${filePath}.lock`;

  await withJsonStateWrite(filePath, async () => {
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(lock.pid, process.pid);
    assert.equal(typeof lock.createdAt, 'number');
  }, { crossProcessLock: true });

  await assert.rejects(() => readFile(lockPath, 'utf8'), (error: any) => error.code === 'ENOENT');
});

test('withJsonStateWrite reclaims locks left behind by dead processes', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-json-lock-dead-${Date.now()}-`), { recursive: true });
  const filePath = path.join(dir, 'users.json');
  const lockPath = `${filePath}.lock`;
  const deadChild = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  await writeFile(lockPath, JSON.stringify({
    pid: deadChild.pid,
    host: hostname(),
    createdAt: Date.now(),
  }), 'utf8');

  const result = await withJsonStateWrite(filePath, async () => 'ran', {
    crossProcessLock: true,
    lockTimeoutMs: 2000,
  });

  assert.equal(result, 'ran');
  await assert.rejects(() => readFile(lockPath, 'utf8'), (error: any) => error.code === 'ENOENT');
});

test('withJsonStateWrite reclaims stale unreadable locks by age', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-json-lock-stale-${Date.now()}-`), { recursive: true });
  const filePath = path.join(dir, 'users.json');
  const lockPath = `${filePath}.lock`;
  await writeFile(lockPath, 'not json', 'utf8');
  const past = new Date(Date.now() - 60_000);
  await utimes(lockPath, past, past);

  const result = await withJsonStateWrite(filePath, async () => 'ran', {
    crossProcessLock: true,
    lockTimeoutMs: 2000,
    lockStaleMs: 1000,
  });

  assert.equal(result, 'ran');
});

test('withJsonStateWrite fails with JSON_STATE_LOCKED while another live process holds the lock', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-json-lock-live-${Date.now()}-`), { recursive: true });
  const filePath = path.join(dir, 'users.json');
  const lockPath = `${filePath}.lock`;
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore' });
  try {
    await writeFile(lockPath, JSON.stringify({
      pid: child.pid,
      host: hostname(),
      createdAt: Date.now(),
    }), 'utf8');

    await assert.rejects(
      () => withJsonStateWrite(filePath, async () => 'should not run', {
        crossProcessLock: true,
        lockTimeoutMs: 150,
      }),
      (error: any) => {
        assert.equal(error.code, 'JSON_STATE_LOCKED');
        assert.equal(error.status, 503);
        assert.match(error.hint, /lock file/);
        assert.equal(error.details.lockPath, lockPath);
        assert.equal(error.details.holder.pid, child.pid);
        return true;
      },
    );
  } finally {
    child.kill('SIGKILL');
  }
});

test('atomicWriteJson works with custom file systems that omit fsync', async () => {
  const fs = createMemoryFs({ cwd: '/' });
  await atomicWriteJson('/state/users.json', [{ id: 'u_1' }], fs);

  assert.deepEqual(JSON.parse(await fs.readFile('/state/users.json', 'utf8') as string), [{ id: 'u_1' }]);
});

test('atomicWriteJsonVersioned snapshots previous contents and prunes history', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-json-versions-${Date.now()}-`), { recursive: true });
  const filePath = path.join(dir, 'flags.json');

  await atomicWriteJsonVersioned(filePath, [{ id: 'a', enabled: false }]);
  assert.deepEqual(await listJsonStateVersions(filePath), []);

  for (let index = 0; index < 4; index += 1) {
    await delay(2);
    await atomicWriteJsonVersioned(filePath, [{ id: 'a', enabled: index % 2 === 0 }], { maxVersions: 2 });
  }

  const versions = await listJsonStateVersions(filePath);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].at >= versions[1].at, true);

  // Unchanged writes neither rewrite the file nor add version churn.
  const before = await listJsonStateVersions(filePath);
  const changed = await atomicWriteJsonVersioned(filePath, JSON.parse(await readFile(filePath, 'utf8')), { maxVersions: 2 });
  assert.equal(changed, false);
  assert.deepEqual(await listJsonStateVersions(filePath), before);
});

test('restoreJsonStateVersion rolls back and is itself undoable', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-json-restore-${Date.now()}-`), { recursive: true });
  const filePath = path.join(dir, 'settings.json');

  await atomicWriteJsonVersioned(filePath, { theme: 'dark' });
  await delay(2);
  await atomicWriteJsonVersioned(filePath, { theme: 'light' });

  const restored = await restoreJsonStateVersion(filePath, 'latest');
  assert.match(restored.file, /\.json$/);
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), { theme: 'dark' });

  // The pre-restore contents were snapshotted, so restoring again can return.
  const versions = await listJsonStateVersions(filePath);
  assert.equal(versions.some((version) => version.file !== restored.file), true);

  await assert.rejects(
    () => restoreJsonStateVersion(filePath, 'no-such-version'),
    (error: any) => {
      assert.equal(error.code, 'JSON_STATE_VERSION_NOT_FOUND');
      assert.equal(error.status, 404);
      assert.match(error.hint, /--list/);
      return true;
    },
  );
});

test('recoverJsonStateDir removes orphan temp files and dead locks only', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-json-recover-${Date.now()}-`), { recursive: true });
  const oldTemp = path.join(dir, '.users.json.123.456.abc.tmp');
  await writeFile(oldTemp, 'partial', 'utf8');
  const past = new Date(Date.now() - 120_000);
  await utimes(oldTemp, past, past);

  const freshTemp = path.join(dir, '.users.json.789.999.def.tmp');
  await writeFile(freshTemp, 'partial', 'utf8');

  const deadChild = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  await writeFile(path.join(dir, 'users.json.lock'), JSON.stringify({
    pid: deadChild.pid,
    host: hostname(),
    createdAt: Date.now() - 120_000,
  }), 'utf8');

  const report = await recoverJsonStateDir(dir);
  assert.deepEqual(report.removedTempFiles, ['.users.json.123.456.abc.tmp']);
  assert.deepEqual(report.removedLocks, ['users.json.lock']);
  await readFile(freshTemp, 'utf8');
});

test('jsonStore encryption seals state files with AES-256-GCM', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-json-encrypted-${Date.now()}-`), { recursive: true });
  const config = { cwd: String(dir), stateDir: String(dir) };
  const resource = { name: 'secrets', kind: 'document' };
  const store = jsonStore({ encryption: { key: 'correct horse battery staple' } })({
    config: config as never,
    resources: [],
    storeName: 'sealed',
  }) as any;

  await store.writeResource(resource, { apiToken: 'tok_12345' });

  const raw = JSON.parse(await readFile(path.join(String(dir), 'state', 'secrets.json'), 'utf8'));
  assert.equal(raw.__asyncDbEncrypted, 'aes-256-gcm');
  assert.equal(JSON.stringify(raw).includes('tok_12345'), false);

  assert.deepEqual(await store.readResource(resource, null), { apiToken: 'tok_12345' });

  // Identical values skip the write entirely despite random IVs.
  const cipherBefore = await readFile(path.join(String(dir), 'state', 'secrets.json'), 'utf8');
  assert.equal(await store.writeResource(resource, { apiToken: 'tok_12345' }), false);
  assert.equal(await readFile(path.join(String(dir), 'state', 'secrets.json'), 'utf8'), cipherBefore);

  const wrongKeyStore = jsonStore({ encryption: { key: 'wrong key' } })({
    config: config as never,
    resources: [],
    storeName: 'sealed',
  }) as any;
  await assert.rejects(
    () => wrongKeyStore.readResource(resource, null),
    (error: any) => {
      assert.equal(error.code, 'JSON_ENCRYPTION_FAILED');
      assert.match(error.hint, /key/);
      return true;
    },
  );

  assert.throws(
    () => jsonStore({ encryption: {} as never })({ config: config as never, resources: [], storeName: 'sealed' }),
    (error: any) => error.code === 'JSON_ENCRYPTION_KEY_REQUIRED',
  );
});

test('jsonStore plaintext files migrate transparently into an encrypted store', async () => {
  const dir = await mkdir(path.join(tmpdir(), `db-json-migrate-${Date.now()}-`), { recursive: true });
  const config = { cwd: String(dir), stateDir: String(dir) };
  const resource = { name: 'settings', kind: 'document' };
  await mkdir(path.join(String(dir), 'state'), { recursive: true });
  await writeFile(path.join(String(dir), 'state', 'settings.json'), JSON.stringify({ theme: 'dark' }), 'utf8');

  const store = jsonStore({ encryption: { key: 'migration key' } })({
    config: config as never,
    resources: [],
    storeName: 'sealed',
  }) as any;

  assert.deepEqual(await store.readResource(resource, null), { theme: 'dark' });
  await store.writeResource(resource, { theme: 'light' });
  const raw = JSON.parse(await readFile(path.join(String(dir), 'state', 'settings.json'), 'utf8'));
  assert.equal(raw.__asyncDbEncrypted, 'aes-256-gcm');
});
