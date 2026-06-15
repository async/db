import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { openDb } from '../../index.js';
import { makeProject, writeConfig, writeFixture } from '../../../tests/helpers.js';
import { appendWalEntry, readWal, replayWal, rotateWal, walContentHash, walPathFor } from './wal.js';

test('wal append/read/rotate round-trips entries and tolerates a torn tail', async () => {
  const dir = String(await mkdir(path.join(tmpdir(), `db-wal-${Date.now()}-`), { recursive: true }));
  const walPath = walPathFor(dir, 'users');

  await rotateWal(walPath, 'hash-a', 0);
  await appendWalEntry(walPath, { op: 'put-record', idField: 'id', record: { id: 'u_1', name: 'Ada' }, seq: 1, at: 't' }, { fsync: 'no' });
  await appendWalEntry(walPath, { op: 'delete-record', idField: 'id', id: 'u_0', seq: 2, at: 't' }, { fsync: 'no' });
  // Simulate a crash mid-append: a torn, unparseable final line.
  await writeFile(walPath, `${await readFile(walPath, 'utf8')}{"op":"put-rec`, 'utf8');

  const log = await readWal(walPath);
  assert.equal(log.baseHash, 'hash-a');
  assert.equal(log.entries.length, 2);
  assert.equal(log.entries[1].seq, 2);
});

test('replayWal applies put/delete/replace idempotently', () => {
  const entries = [
    { op: 'put-record', idField: 'id', record: { id: 'u_1', name: 'Ada' }, seq: 1, at: 't' },
    { op: 'put-record', idField: 'id', record: { id: 'u_1', name: 'Ada King' }, seq: 2, at: 't' },
    { op: 'put-record', idField: 'id', record: { id: 'u_2', name: 'Grace' }, seq: 3, at: 't' },
    { op: 'delete-record', idField: 'id', id: 'u_2', seq: 4, at: 't' },
  ] as never[];

  const once = replayWal([], entries);
  const twice = replayWal(once, entries);
  assert.deepEqual(once, [{ id: 'u_1', name: 'Ada King' }]);
  assert.deepEqual(twice, once);
  assert.deepEqual(replayWal([], [{ op: 'replace-all', value: [{ id: 'x' }], seq: 1, at: 't' } as never]), [{ id: 'x' }]);
});

test('wal store acknowledges before checkpoint and survives a simulated crash', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'flags.json', JSON.stringify([{ id: 'beta', enabled: false }]));
  await writeConfig(cwd, `export default {
  stores: {
    json: { driver: 'json', durability: 'wal', fsync: 'no', checkpointMs: 5000 },
  },
};`);

  const db = await openDb({ cwd });
  await db.collection('flags').create({ id: 'gamma', enabled: true });

  // Before any checkpoint lands, the API already reads its own write...
  const viaApi = await db.collection('flags').get('gamma');
  assert.equal(viaApi.enabled, true);

  // ...and the acknowledged delta is durable in the log even though the
  // pretty checkpoint has not happened yet (checkpointMs is far away).
  const walText = await readFile(path.join(cwd, '.db/state/.wal/flags.jsonl'), 'utf8');
  assert.match(walText, /"op":"put-record"/);
  assert.match(walText, /"gamma"/);

  // Simulated crash: abandon this runtime without close(), reopen fresh.
  const reopened = await openDb({ cwd });
  const recovered = await reopened.collection('flags').all();
  assert.equal(recovered.some((record) => record.id === 'gamma'), true);

  // Boot recovery checkpointed the log into the canonical file and rotated.
  const checkpoint = JSON.parse(await readFile(path.join(cwd, '.db/state/flags.json'), 'utf8'));
  assert.equal(checkpoint.some((record) => record.id === 'gamma'), true);
  const rotated = await readWal(path.join(cwd, '.db/state/.wal/flags.jsonl'));
  assert.equal(rotated.entries.length, 0);
  await reopened.close();
  await db.close();
});

test('wal checkpoint debounce publishes the pretty file shortly after writes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({ theme: 'dark' }));
  await writeConfig(cwd, `export default {
  stores: {
    json: { driver: 'json', durability: 'wal', fsync: 'no', checkpointMs: 25 },
  },
};`);

  const db = await openDb({ cwd });
  await db.document('settings').update({ theme: 'light' });
  await delay(150);

  const checkpoint = JSON.parse(await readFile(path.join(cwd, '.db/state/settings.json'), 'utf8'));
  assert.equal(checkpoint.theme, 'light');
  const log = await readWal(path.join(cwd, '.db/state/.wal/settings.jsonl'));
  assert.equal(log.entries.length, 0);
  await db.close();
});

test('a hand-edited canonical file supersedes a stale wal generation', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'flags.json', JSON.stringify([{ id: 'beta', enabled: false }]));
  await writeConfig(cwd, `export default {
  stores: {
    json: { driver: 'json', durability: 'wal', fsync: 'no', checkpointMs: 5000 },
  },
};`);

  const db = await openDb({ cwd });
  await db.collection('flags').create({ id: 'gamma', enabled: true });
  await db.close(); // close checkpoints; write again into a fresh log without checkpoint

  const db2 = await openDb({ cwd });
  await db2.collection('flags').patch('gamma', { enabled: false });

  // A human edits the canonical state file directly while the log holds the
  // un-checkpointed patch: the visible file wins.
  const statePath = path.join(cwd, '.db/state/flags.json');
  await writeFile(statePath, `${JSON.stringify([{ id: 'human', enabled: true }], null, 2)}\n`, 'utf8');

  const db3 = await openDb({ cwd });
  const records = await db3.collection('flags').all();
  assert.deepEqual(records.map((record) => record.id), ['human']);
  await db3.close();
  await db2.close();
});

test('sourceFile store with wal keeps the db/ file as live canonical', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'notes.json', JSON.stringify([{ id: 'n_1', text: 'first' }]));
  await writeConfig(cwd, `export default {
  stores: {
    default: 'sourceFile',
    sourceFile: { driver: 'sourceFile', durability: 'wal', fsync: 'no', checkpointMs: 25 },
  },
};`);

  const db = await openDb({ cwd });
  await db.collection('notes').create({ id: 'n_2', text: 'second' });
  assert.equal((await db.collection('notes').all()).length, 2);
  await delay(150);

  // The draft file the human looks at received the checkpoint.
  const sourceText = await readFile(path.join(cwd, 'db/notes.json'), 'utf8');
  assert.match(sourceText, /n_2/);
  assert.equal(walContentHash(sourceText) !== null, true);
  await db.close();
});
