import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

const execFileAsync = promisify(execFile);

test('CLI sync smoke writes runtime and committed type outputs', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeConfig(cwd, `export default {
  types: {
    commitOutFile: './src/generated/db.types.ts',
  },
};`);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'sync',
    '--cwd',
    cwd,
  ]);

  const runtimeTypes = await readFile(path.join(cwd, '.db/types/index.ts'), 'utf8');
  const committedTypes = await readFile(path.join(cwd, 'src/generated/db.types.ts'), 'utf8');

  assert.match(stdout, /Generated \.db\/schema\.generated\.json/);
  assert.match(stdout, /Generated \.db\/types\/index\.ts/);
  assert.match(stdout, /Generated src\/generated\/db\.types\.ts/);
  assert.match(stdout, /Synced runtime store/);
  assert.equal(stderr, '');
  assert.match(runtimeTypes, /export type User =/);
  assert.match(committedTypes, /export type User =/);
});

test('CLI schema validate smoke reports valid fixtures', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'validate',
    '--cwd',
    cwd,
  ]);

  assert.equal(stdout.trim(), 'Schema valid');
  assert.equal(stderr, '');
});

test('CLI serve smoke exposes dataPath and scoped REST routes', async (t) => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const server = spawn(process.execPath, [
    path.resolve('src/cli.js'),
    'serve',
    '--cwd',
    cwd,
    '--host',
    '127.0.0.1',
    '--port',
    '0',
  ], {
    cwd: path.resolve('.'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    await stopChild(server);
  });

  const url = await waitForServeUrl(server);
  const dataPathResponse = await fetchJson(`${url}/db/users.json?id=u_1`);
  const scopedRestResponse = await fetchJson(`${url}/__db/rest/users/u_1`);

  assert.deepEqual(dataPathResponse, { id: 'u_1', name: 'Ada' });
  assert.deepEqual(scopedRestResponse, { id: 'u_1', name: 'Ada' });
});

test('CLI schema manifest --out writes relative to --cwd', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', email: 'ada@example.com' }]));

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'manifest',
    '--cwd',
    cwd,
    '--out',
    './src/generated/db.schema.json',
  ]);

  const manifest = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.schema.json'), 'utf8'));

  assert.match(stdout, /Generated src\/generated\/db\.schema\.json/);
  assert.equal(manifest.collections.users.fields.email.ui.component, 'email');
});

test('CLI viewer manifest --out writes relative to --cwd', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', email: 'ada@example.com' }]));

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'viewer',
    'manifest',
    '--cwd',
    cwd,
    '--out',
    './src/generated/db.viewer.json',
  ]);

  const manifest = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.viewer.json'), 'utf8'));

  assert.match(stdout, /Generated src\/generated\/db\.viewer\.json/);
  assert.equal(manifest.kind, 'db.viewerManifest');
  assert.equal(manifest.api.manifest, '/__db/manifest');
  assert.equal(manifest.api.manifestJson, '/__db/manifest.json');
  assert.equal(manifest.api.manifestMarkdown, '/__db/manifest.md');
  assert.equal(manifest.collections.users.fields.email.ui.component, 'email');
});

test('CLI schema infer prints data-inferred resources while ignoring explicit schemas', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true }
    },
    "seed": []
  }`);

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'infer',
    '--cwd',
    cwd,
  ]);
  const schema = JSON.parse(stdout);

  assert.equal(schema.resources.users.fields.name.type, 'string');
  assert.equal(schema.resources.users.fields.email, undefined);
});

test('CLI schema infer can print and write a single inferred resource', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    {
      id: 'home',
      blocks: [
        { type: 'chart', chartId: 'chart_1' },
        { type: 'metric', title: 'Revenue', source: 'orders', aggregate: 'sum' },
      ],
    },
  ]));

  const single = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'infer',
    'pages',
    '--cwd',
    cwd,
  ]);
  const resource = JSON.parse(single.stdout);

  assert.equal(resource.fields.blocks.items.discriminator, 'type');

  const written = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'infer',
    'pages',
    '--cwd',
    cwd,
    '--out',
    './db/pages.schema.jsonc',
  ]);
  const schema = JSON.parse(await readFile(path.join(cwd, 'db/pages.schema.jsonc'), 'utf8'));

  assert.match(written.stdout, /Generated db\/pages\.schema\.jsonc/);
  assert.equal(schema.kind, 'collection');
  assert.equal(schema.fields.blocks.items.variants.chart.fields.chartId.type, 'string');
  assert.equal(schema.seed, undefined);
});

test('CLI schema validate warns when mixed mode schema embeds ignored seed', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [{ "id": "u_schema", "name": "Schema Seed" }]
  }`);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'validate',
    '--cwd',
    cwd,
  ]);

  assert.match(stdout, /Schema valid with warnings/);
  assert.match(stderr, /db\/users\.schema\.jsonc includes seed records, but db\/users\.json provides seed data/);
});

test('CLI schema unbundle migrates embedded schema seed into a separate data fixture and warns before rewriting JSONC', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    // Local demo users.
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [{ "id": "u_1", "name": "Ada" }]
  }`);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'unbundle',
    'users',
    '--cwd',
    cwd,
  ]);
  const schema = JSON.parse(await readFile(path.join(cwd, 'db/users.schema.jsonc'), 'utf8'));
  const seed = JSON.parse(await readFile(path.join(cwd, 'db/users.json'), 'utf8'));

  assert.match(stdout, /Generated db\/users\.json/);
  assert.match(stdout, /Generated db\/users\.schema\.jsonc/);
  assert.match(stderr, /rewrites db\/users\.schema\.jsonc without preserving JSONC comments/);
  assert.equal(schema.seed, undefined);
  assert.deepEqual(seed, [{ id: 'u_1', name: 'Ada' }]);
});

test('CLI schema unbundle refuses to overwrite a different seed output without force', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [{ "id": "u_1", "name": "Ada" }]
  }`);
  await mkdir(path.join(cwd, 'artifacts'), { recursive: true });
  await writeFile(path.join(cwd, 'artifacts/users.json'), '[{ "id": "u_2", "name": "Grace" }]\n', 'utf8');

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('src/cli.js'),
      'schema',
      'unbundle',
      'users',
      '--cwd',
      cwd,
      '--seed-out',
      './artifacts/users.json',
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_OUTPUT_EXISTS/);
      return true;
    },
  );
});

test('CLI schema unbundle accepts semantically matching seed output', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [{ "id": "u_1", "name": "Ada" }]
  }`);
  await mkdir(path.join(cwd, 'artifacts'), { recursive: true });
  await writeFile(path.join(cwd, 'artifacts/users.json'), '[{"name":"Ada","id":"u_1"}]\n', 'utf8');

  await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'unbundle',
    'users',
    '--cwd',
    cwd,
    '--seed-out',
    './artifacts/users.json',
  ]);
});

test('CLI schema unbundle --schema-out and --seed-out write relative to --cwd', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [{ "id": "u_1", "name": "Ada" }]
  }`);

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'unbundle',
    'users',
    '--cwd',
    cwd,
    '--schema-out',
    './generated/users.schema.json',
    '--seed-out',
    './fixtures/users.json',
  ]);
  const schema = JSON.parse(await readFile(path.join(cwd, 'generated/users.schema.json'), 'utf8'));
  const seed = JSON.parse(await readFile(path.join(cwd, 'fixtures/users.json'), 'utf8'));

  assert.match(stdout, /Generated fixtures\/users\.json/);
  assert.match(stdout, /Generated generated\/users\.schema\.json/);
  assert.equal(schema.seed, undefined);
  assert.deepEqual(seed, [{ id: 'u_1', name: 'Ada' }]);
});

test('CLI schema unbundle force overwrites a different seed output', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [{ "id": "u_1", "name": "Ada" }]
  }`);
  await mkdir(path.join(cwd, 'artifacts'), { recursive: true });
  await writeFile(path.join(cwd, 'artifacts/users.json'), '[{ "id": "u_2", "name": "Grace" }]\n', 'utf8');

  await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'unbundle',
    'users',
    '--cwd',
    cwd,
    '--seed-out',
    './artifacts/users.json',
    '--force',
  ]);
  const seed = JSON.parse(await readFile(path.join(cwd, 'artifacts/users.json'), 'utf8'));

  assert.deepEqual(seed, [{ id: 'u_1', name: 'Ada' }]);
});

test('CLI schema unbundle skips empty schema-only seed unless requested', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true }
    },
    "seed": []
  }`);

  await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'unbundle',
    'users',
    '--cwd',
    cwd,
  ]);

  await assert.rejects(() => readFile(path.join(cwd, 'db/users.json'), 'utf8'), /ENOENT/);

  await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'unbundle',
    'users',
    '--cwd',
    cwd,
    '--empty-seed',
  ]);
  const seed = JSON.parse(await readFile(path.join(cwd, 'db/users.json'), 'utf8'));

  assert.deepEqual(seed, []);
});

test('CLI schema unbundle requires --schema-out for executable schema sources', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.mjs', `import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    name: field.string({ required: true }),
  },
  seed: [{ id: 'u_1', name: 'Ada' }],
});
`);

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('src/cli.js'),
      'schema',
      'unbundle',
      'users',
      '--cwd',
      cwd,
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_UNBUNDLE_SCHEMA_MJS_REQUIRES_OUT/);
      return true;
    },
  );
});

test('CLI schema bundle writes a schema source with seed from a separate data fixture', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    }
  }`);

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'bundle',
    'users',
    '--cwd',
    cwd,
    '--out',
    './artifacts/users.bundle.schema.json',
  ]);
  const bundled = JSON.parse(await readFile(path.join(cwd, 'artifacts/users.bundle.schema.json'), 'utf8'));

  assert.match(stdout, /Generated artifacts\/users\.bundle\.schema\.json/);
  assert.deepEqual(bundled.seed, [{ id: 'u_1', name: 'Ada' }]);
  assert.equal(bundled.fields.name.type, 'string');
});

test('CLI schema bundle refuses active db output without force', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    }
  }`);

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('src/cli.js'),
      'schema',
      'bundle',
      'users',
      '--cwd',
      cwd,
      '--out',
      './db/users.bundle.schema.json',
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_BUNDLE_LIVE_OUTPUT_REQUIRES_FORCE/);
      return true;
    },
  );
});

test('CLI schema infer --out requires a single resource', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('src/cli.js'),
      'schema',
      'infer',
      '--cwd',
      cwd,
      '--out',
      './db/users.schema.jsonc',
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_INFER_OUT_REQUIRES_RESOURCE/);
      return true;
    },
  );
});

test('CLI types --out writes relative to --cwd', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'types',
    '--cwd',
    cwd,
    '--out',
    './src/generated/db.types.ts',
  ]);

  const generated = await readFile(path.join(cwd, 'src/generated/db.types.ts'), 'utf8');

  assert.match(stdout, /Generated src\/generated\/db\.types\.ts/);
  assert.match(generated, /export type User =/);
});

test('CLI operations build writes registry and client refs outputs', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/operations'), { recursive: true });
  await writeFile(path.join(cwd, 'db/operations/get-user.jsonc'), `{
    "name": "GetUser",
    "path": "/users/{id}.json",
    "query": {
      "select": "id,name"
    }
  }`, 'utf8');
  await writeConfig(cwd, `export default {
    operations: {
      sourceDir: './db/operations',
      outFile: './src/generated/db.operations.json',
      refsOutFile: './src/generated/db.operation-refs.json',
    },
  };`);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'operations',
    'build',
    '--cwd',
    cwd,
  ]);
  const registry = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.operations.json'), 'utf8'));
  const refs = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.operation-refs.json'), 'utf8'));
  const [ref] = Object.keys(registry.operations);

  assert.match(stdout, /Generated src\/generated\/db\.operations\.json/);
  assert.match(stdout, /Generated src\/generated\/db\.operation-refs\.json/);
  assert.equal(stderr, '');
  assert.equal(refs.operations.GetUser.ref, ref);
  assert.equal(refs.operations.GetUser.hash, undefined);
  assert.equal(refs.operations.GetUser.path, undefined);
  assert.equal(registry.operations[ref].path, '/users/{id}.json');
});

test('CLI operations contract prints and checks the client-exposed operation refs', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/operations'), { recursive: true });
  const operationPath = path.join(cwd, 'db/operations/get-user.jsonc');
  await writeFile(operationPath, `{
    "name": "GetUser",
    "path": "/users/{id}.json",
    "query": {
      "select": "id,name"
    }
  }`, 'utf8');
  await writeConfig(cwd, `export default {
    outputs: {
      operationRefs: './src/generated/db.operation-refs.json',
    },
    operations: {
      sourceDir: './db/operations',
    },
  };`);

  const printed = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'operations',
    'contract',
    '--cwd',
    cwd,
  ]);
  const contract = JSON.parse(printed.stdout);
  assert.equal(contract.kind, 'db.operationContract');
  assert.equal(contract.generatedAt, undefined);
  assert.equal(contract.operations.GetUser.name, 'GetUser');
  assert.match(contract.operations.GetUser.ref, /^sha256:[a-f0-9]{64}$/);
  assert.equal(contract.operations.GetUser.path, undefined);
  assert.equal(contract.operations.GetUser.query, undefined);

  await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'operations',
    'build',
    '--cwd',
    cwd,
  ]);

  const checked = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'operations',
    'contract',
    '--cwd',
    cwd,
    '--check',
  ]);
  assert.match(checked.stdout, /Operation client contract matches src\/generated\/db\.operation-refs\.json/);

  await writeFile(operationPath, `{
    "name": "GetUser",
    "path": "/profiles/{id}.json",
    "query": {
      "select": "id,name"
    }
  }`, 'utf8');

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('src/cli.js'),
      'operations',
      'contract',
      '--cwd',
      cwd,
      '--check',
    ]),
    (error) => error.stderr.includes('Operation client contract changed'),
  );
});

test('CLI operations contract --out writes a deterministic sorted contract file', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/operations'), { recursive: true });
  await writeFile(path.join(cwd, 'db/operations/01-zulu-user.jsonc'), `{
    "name": "ZuluUser",
    "ref": "users.zulu",
    "path": "/users/{id}.json"
  }`, 'utf8');
  await writeFile(path.join(cwd, 'db/operations/02-alpha-user.jsonc'), `{
    "name": "AlphaUser",
    "ref": "users.alpha",
    "path": "/profiles/{id}.json"
  }`, 'utf8');
  await writeConfig(cwd, `export default {
    operations: {
      sourceDir: './db/operations',
    },
  };`);

  const args = [
    path.resolve('src/cli.js'),
    'operations',
    'contract',
    '--cwd',
    cwd,
    '--out',
    './src/generated/db.operation-contract.json',
  ];
  const first = await execFileAsync(process.execPath, args);
  const firstContent = await readFile(path.join(cwd, 'src/generated/db.operation-contract.json'), 'utf8');
  const second = await execFileAsync(process.execPath, args);
  const secondContent = await readFile(path.join(cwd, 'src/generated/db.operation-contract.json'), 'utf8');
  const contract = JSON.parse(firstContent);

  assert.match(first.stdout, /Generated src\/generated\/db\.operation-contract\.json/);
  assert.match(second.stdout, /Generated src\/generated\/db\.operation-contract\.json/);
  assert.equal(firstContent, secondContent);
  assert.deepEqual(Object.keys(contract.operations), ['AlphaUser', 'ZuluUser']);
  assert.equal(contract.generatedAt, undefined);
  assert.deepEqual(contract.operations.AlphaUser, {
    name: 'AlphaUser',
    ref: 'users.alpha',
  });
  assert.equal(contract.operations.AlphaUser.path, undefined);
});

test('CLI operations contract --check requires an approved contract target', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/operations'), { recursive: true });
  await writeFile(path.join(cwd, 'db/operations/get-user.jsonc'), `{
    "name": "GetUser",
    "ref": "users.get",
    "path": "/users/{id}.json"
  }`, 'utf8');
  await writeConfig(cwd, `export default {
    operations: {
      sourceDir: './db/operations',
    },
  };`);

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('src/cli.js'),
      'operations',
      'contract',
      '--cwd',
      cwd,
      '--check',
    ]),
    (error) => error.stderr.includes('Operation contract check needs --out <file> or outputs.operationRefs in db.config.mjs.'),
  );
});

test('CLI subcommands print focused help without running the command', async () => {
  await assertCliHelp(['schema', '--help'], /async-db schema infer \[resource\] \[--out <file>\]/);
  await assertCliHelp(['types', '--help'], /Usage:\n  async-db types \[--watch\] \[--out <file>\]/);
  await assertCliHelp(['doctor', '--help'], /Usage:\n  async-db doctor \[--strict\] \[--json\]/);
  await assertCliHelp(['viewer', '--help'], /Usage:\n  async-db viewer manifest \[--out <file>\]/);
  await assertCliHelp(['serve', '--help'], /Usage:\n  async-db serve \[--host <host>\] \[--port <port>\]/);
  await assertCliHelp(['operations', '--help'], /async-db operations contract \[--out <file>\] \[--check\]/);
  await assertCliHelp(['generate', 'hono', '--help'], /Usage:\n  async-db generate hono/);
});

test('CLI subcommand help does not load project config', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeConfig(cwd, 'throw new Error("broken config should not load for help");');

  await assertCliHelp(['schema', '--help'], /async-db schema infer \[resource\] \[--out <file>\]/, cwd);
  await assertCliHelp(['types', '--help'], /Usage:\n  async-db types \[--watch\] \[--out <file>\]/, cwd);
  await assertCliHelp(['doctor', '--help'], /Usage:\n  async-db doctor \[--strict\] \[--json\]/, cwd);
  await assertCliHelp(['viewer', '--help'], /Usage:\n  async-db viewer manifest \[--out <file>\]/, cwd);
  await assertCliHelp(['serve', '--help'], /Usage:\n  async-db serve \[--host <host>\] \[--port <port>\]/, cwd);
  await assertCliHelp(['operations', '--help'], /async-db operations contract \[--out <file>\] \[--check\]/, cwd);
  await assertCliHelp(['generate', 'hono', '--help'], /Usage:\n  async-db generate hono/, cwd);
});

async function assertCliHelp(args, pattern, cwd) {
  cwd ??= await makeProject();
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    ...args,
    '--cwd',
    cwd,
  ], {
    timeout: 1000,
  });

  assert.match(stdout, pattern);
  assert.equal(stderr, '');
}

async function waitForServeUrl(child) {
  let stdout = '';
  let stderr = '';

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for async-db serve to start.\n${stdout}${stderr}`));
    }, 5000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/db server listening at (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`async-db serve exited before listening: ${code ?? signal}\n${stdout}${stderr}`));
    });
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return await response.json();
}

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 1000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
