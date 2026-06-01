import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicWriteJson, readJsonState, withJsonStateWrite } from './json.js';

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
