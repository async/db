import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { loadConfig, loadProjectSchema, runJsonDbDoctor } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

const execFileAsync = promisify(execFile);

test('doctor suggests likely relations without changing schema shape', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: '1', name: 'Ada Lovelace' },
  ]));
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', title: 'Ship prototype', userId: '1' },
  ]));

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);
  const project = await loadProjectSchema(config);
  const suggestion = result.findings.find((finding) => finding.code === 'DOCTOR_RELATION_SUGGESTION');

  assert.equal(suggestion.severity, 'info');
  assert.equal(suggestion.resource, 'todos');
  assert.equal(suggestion.field, 'userId');
  assert.match(suggestion.message, /todos\.userId -> users\.id/);
  assert.deepEqual(suggestion.details.suggestedRelation, {
    name: 'user',
    to: 'users',
    toField: 'id',
    cardinality: 'one',
  });
  assert.deepEqual(project.schema.resources.todos.relations, []);
});

test('doctor does not suggest missing relation targets when every duplicated value is missing', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', title: 'First', userId: 'missing' },
    { id: 't_2', title: 'Second', userId: 'missing' },
  ]));

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);

  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_RELATION_MISSING_TARGET_VALUES'), false);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_RELATION_SUGGESTION'), false);
});

test('doctor reports duplicate ids and inconsistent field types', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', title: 'One', done: true },
    { id: 't_1', title: 'Two', done: 'yes' },
    { id: 3, title: 'Three', done: false },
  ]));

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);

  assert.equal(result.summary.warn, 3);
  assert.equal(result.summary.error, 0);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_DUPLICATE_ID'), true);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_MIXED_ID_TYPES'), true);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_INCONSISTENT_FIELD_TYPES' && finding.field === 'done'), true);
});

test('doctor suggests schema when polymorphic data cannot be inferred confidently', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    {
      id: 'home',
      blocks: [
        {
          chartId: 'chart_1',
        },
        {
          title: 'Revenue',
          source: 'orders',
        },
      ],
    },
  ]));

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);
  const finding = result.findings.find((candidate) => candidate.code === 'DOCTOR_SCHEMA_RECOMMENDED');

  assert.equal(finding.severity, 'info');
  assert.equal(finding.resource, 'pages');
  assert.equal(finding.field, 'blocks');
  assert.match(finding.message, /pages\.blocks/);
  assert.match(finding.hint, /jsondb schema infer pages --out db\/pages\.schema\.jsonc/);
});

test('doctor reports explicit schemas that match data inference', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    }
  }`);

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);
  const finding = result.findings.find((candidate) => candidate.code === 'DOCTOR_SCHEMA_MATCHES_INFERENCE');

  assert.equal(finding.severity, 'info');
  assert.equal(finding.resource, 'users');
  assert.match(finding.message, /users schema matches inferred data/);
});

test('doctor keeps schema removal quiet when schema contains non-inferable contract value', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": {
        "type": "string",
        "required": true,
        "description": "Stable user id."
      },
      "name": { "type": "string", "required": true }
    }
  }`);

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);

  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_SCHEMA_MATCHES_INFERENCE'), false);
});

test('doctor suggests unbundling ignored schema seed in mixed mode', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [{ "id": "u_schema", "name": "Ignored" }]
  }`);

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);
  const finding = result.findings.find((candidate) => candidate.code === 'SCHEMA_SEED_IGNORED_IN_MIXED_MODE');

  assert.equal(finding.severity, 'warn');
  assert.equal(finding.resource, 'users');
  assert.match(finding.hint, /jsondb schema unbundle users/);
});

test('doctor validates configured fork folders', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeConfig(cwd, `export default {
    forks: ['legacy-demo', '../unsafe'],
  };`);

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);

  assert.equal(result.summary.error, 2);
  assert.equal(result.findings.some((finding) => finding.code === 'FORK_SOURCE_MISSING' && finding.details?.fork === 'legacy-demo'), true);
  assert.equal(result.findings.some((finding) => finding.code === 'FORK_NAME_INVALID' && finding.details?.fork === '../unsafe'), true);
});

test('doctor reports missing store names and large json stores without indexes', async () => {
  const cwd = await makeProject();
  const activityEvents = Array.from({ length: 1001 }, (_, index) => ({
    id: `event_${index + 1}`,
    observedAt: `2026-05-19T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
    domain: index % 2 === 0 ? 'example.com' : 'docs.example.com',
  }));
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeFixture(cwd, 'activityEvents.json', JSON.stringify(activityEvents));
  await writeConfig(cwd, `export default {
    stores: {
      default: 'json',
    },
    resources: {
      users: { store: 'missing' },
      activityEvents: { store: 'json' },
    },
  };`);

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);
  const missingStore = result.findings.find((finding) => finding.code === 'DOCTOR_STORE_NOT_FOUND');
  const largeJsonStore = result.findings.find((finding) => finding.code === 'DOCTOR_LARGE_JSON_STORE_WITHOUT_INDEXES');

  assert.equal(missingStore.severity, 'error');
  assert.equal(missingStore.resource, 'users');
  assert.equal(missingStore.details.store, 'missing');
  assert.deepEqual(missingStore.details.availableStores, ['json', 'memory', 'sourceFile', 'static']);
  assert.equal(largeJsonStore.severity, 'warn');
  assert.equal(largeJsonStore.resource, 'activityEvents');
  assert.equal(largeJsonStore.details.store, 'json');
  assert.equal(largeJsonStore.details.recordCount, 1001);
  assert.match(largeJsonStore.hint, /resources\.activityEvents\.indexes/);
});

test('doctor accepts index metadata for large json-backed collections', async () => {
  const cwd = await makeProject();
  const activityEvents = Array.from({ length: 1001 }, (_, index) => ({
    id: `event_${index + 1}`,
    observedAt: `2026-05-19T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
  }));
  await writeFixture(cwd, 'activityEvents.json', JSON.stringify(activityEvents));
  await writeConfig(cwd, `export default {
    resources: {
      activityEvents: {
        store: 'json',
        indexes: [
          { fields: ['observedAt'] },
        ],
      },
    },
  };`);

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);

  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_LARGE_JSON_STORE_WITHOUT_INDEXES'), false);
});

test('doctor CLI supports json output and strict check alias', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', done: true },
    { id: 't_1', done: 'yes' },
  ]));

  const { stdout } = await execFileAsync(process.execPath, ['./src/cli.js', 'doctor', '--json', '--cwd', cwd], {
    cwd: path.resolve('.'),
  });
  const result = JSON.parse(stdout);

  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_DUPLICATE_ID'), true);
  await assert.rejects(
    () => execFileAsync(process.execPath, ['./src/cli.js', 'check', '--strict', '--cwd', cwd], {
      cwd: path.resolve('.'),
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /DOCTOR_DUPLICATE_ID/);
      return true;
    },
  );
});
