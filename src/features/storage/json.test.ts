import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atomicWriteJson } from './json.js';

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
