import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { openDb } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

const execFileAsync = promisify(execFile);

test('CLI sync smoke writes runtime and committed type outputs', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeConfig(cwd, `export default {
  types: {
    commitOutFile: './src/generated/db.types.d.ts',
  },
};`);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'sync',
    '--cwd',
    cwd,
  ]);

  const runtimeTypes = await readFile(path.join(cwd, '.db/types/index.d.ts'), 'utf8');
  const committedTypes = await readFile(path.join(cwd, 'src/generated/db.types.d.ts'), 'utf8');

  assert.match(stdout, /Generated \.db\/schema\.generated\.json/);
  assert.match(stdout, /Generated \.db\/types\/index\.d\.ts/);
  assert.match(stdout, /Generated src\/generated\/db\.types\.d\.ts/);
  assert.match(stdout, /Synced runtime store/);
  assert.equal(stderr, '');
  assert.match(runtimeTypes, /export type User =/);
  assert.match(committedTypes, /export type User =/);
});

test('CLI --version prints the package version', async () => {
  const pkg = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    '--version',
  ]);

  assert.equal(stdout.trim(), pkg.version);
  assert.equal(stderr, '');
});

test('CLI init scaffolds a data-first project and syncs', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'package.json'), `${JSON.stringify({
    name: 'init-test',
    private: true,
    type: 'module',
  }, null, 2)}\n`, 'utf8');

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'init',
    '--cwd',
    cwd,
  ]);

  assert.match(stdout, /Initialized data-first project/);
  assert.match(stdout, /npm run db:serve/);
  assert.equal(stderr, '');
  assert.match(await readFile(path.join(cwd, 'db/users.json'), 'utf8'), /Ada Lovelace/);
  assert.match(await readFile(path.join(cwd, '.gitignore'), 'utf8'), /\.db\//);
  assert.match(await readFile(path.join(cwd, 'package.json'), 'utf8'), /"db:serve"/);
  await access(path.join(cwd, '.db/types/index.d.ts'));
});

test('CLI init refuses to overwrite existing db files', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('dist/cli.js'),
      'init',
      '--cwd',
      cwd,
    ]),
    (error: any) => {
      assert.match(error.stderr, /Refusing to overwrite existing file/);
      return true;
    },
  );
});

test('CLI init dry-run emits a json receipt', async () => {
  const cwd = await makeProject();
  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'init',
    '--dry-run',
    '--cwd',
    cwd,
    '--json',
  ]);
  const receipt = JSON.parse(stdout);

  assert.equal(receipt.kind, 'db.initReceipt');
  assert.equal(receipt.dryRun, true);
  assert.equal(receipt.template, 'data-first');
  assert.equal(receipt.files.some((file) => file.relativePath === 'db/users.json'), true);
});

test('CLI schema validate smoke reports valid fixtures', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
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
    path.resolve('dist/cli.js'),
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
    path.resolve('dist/cli.js'),
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

test('CLI schema migrate inspect writes and checks source-only schema migration reports', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src/generated'), { recursive: true });
  await writeFile(path.join(cwd, 'src/models.ts'), `
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
});
`, 'utf8');

  const written = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'migrate',
    'inspect',
    './src',
    '--cwd',
    cwd,
    '--out',
    './src/generated/db.schema-migration.json',
  ]);
  const report = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.schema-migration.json'), 'utf8'));
  const checked = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'migrate',
    'inspect',
    './src',
    '--cwd',
    cwd,
    '--check',
    './src/generated/db.schema-migration.json',
  ]);

  assert.match(written.stdout, /Generated src\/generated\/db\.schema-migration\.json/);
  assert.equal(report.kind, 'db.schemaMigrationReport');
  assert.equal(report.resources[0].name, 'users');
  assert.match(checked.stdout, /Schema migration report matches src\/generated\/db\.schema-migration\.json/);
});

test('CLI schema migrate generate writes JSONC drafts and refuses overwrites without force', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src/generated'), { recursive: true });
  await writeFile(path.join(cwd, 'src/schema.ts'), `
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
});
`, 'utf8');
  await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'migrate',
    'inspect',
    './src',
    '--cwd',
    cwd,
    '--format',
    'jsonc',
    '--out',
    './src/generated/db.schema-migration.json',
  ]);

  const generated = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'migrate',
    'generate',
    '--cwd',
    cwd,
    '--plan',
    './src/generated/db.schema-migration.json',
    '--schema-dir',
    './db',
  ]);
  const schema = JSON.parse(await readFile(path.join(cwd, 'db/users.schema.jsonc'), 'utf8'));

  assert.match(generated.stdout, /Generated db\/users\.schema\.jsonc/);
  assert.equal(schema.fields.id.type, 'string');
  assert.equal(schema.fields.email.required, false);

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('dist/cli.js'),
      'schema',
      'migrate',
      'generate',
      '--cwd',
      cwd,
      '--plan',
      './src/generated/db.schema-migration.json',
      '--schema-dir',
      './db',
    ]),
    /SCHEMA_MIGRATION_OUTPUT_EXISTS/,
  );
});

test('CLI viewer manifest --out writes relative to --cwd', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', email: 'ada@example.com' }]));

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
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

test('CLI usage scan prints JSON for a file target', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await writeFile(path.join(cwd, 'src/app.ts'), `
import { createDbClient } from '@async/db/client';
const db = createDbClient({ apiBase: '/api/db' });
await db.query('users.get', { id: 'u_1' });
`, 'utf8');

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'usage',
    'scan',
    './src/app.ts',
    '--json',
    '--production',
    '--cwd',
    cwd,
  ]);
  const manifest = JSON.parse(stdout);

  assert.equal(stderr, '');
  assert.equal(manifest.kind, 'db.usageManifest');
  assert.equal(manifest.target.path, 'src/app.ts');
  assert.equal(manifest.surfaces.operations.count, 1);
  assert.equal(manifest.recommendations.some((recommendation) => recommendation.code === 'USAGE_RECOMMEND_REST_REGISTERED_ONLY'), true);
});

test('CLI usage scan writes and checks manifests relative to cwd', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src/generated'), { recursive: true });
  await writeFile(path.join(cwd, 'src/app.ts'), `
import { createDbClient } from '@async/db/client';
const db = createDbClient();
await db.rest('GET', '/users');
`, 'utf8');

  const written = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'usage',
    'scan',
    './src',
    '--cwd',
    cwd,
    '--out',
    './src/generated/db.usage.json',
  ]);
  const manifest = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.usage.json'), 'utf8'));
  const checked = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'usage',
    'scan',
    './src',
    '--cwd',
    cwd,
    '--check',
    './src/generated/db.usage.json',
  ]);

  assert.match(written.stdout, /Generated src\/generated\/db\.usage\.json/);
  assert.equal(manifest.kind, 'db.usageManifest');
  assert.match(checked.stdout, /Usage manifest matches src\/generated\/db\.usage\.json/);
});

test('CLI usage scan defaults to the full project target', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    graphql: {
      enabled: false,
    },
  };`);

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'usage',
    'scan',
    '--cwd',
    cwd,
    '--json',
  ]);
  const manifest = JSON.parse(stdout);

  assert.equal(manifest.target.path, '.');
  assert.equal(manifest.files.some((file) => file.path === 'db.config.mjs'), true);
});

test('CLI integrate inspect prints JSON for a SQLite-backed project', async (t) => {
  const sqliteFile = await createSqliteIntegrationFixture(t);
  if (!sqliteFile) return;
  const cwd = path.dirname(path.dirname(sqliteFile));

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'integrate',
    'inspect',
    './src',
    '--sqlite',
    './data/app.sqlite',
    '--json',
    '--cwd',
    cwd,
  ]);
  const report = JSON.parse(stdout);

  assert.equal(stderr, '');
  assert.equal(report.kind, 'db.integrationReport');
  assert.equal(report.sqlite.path, 'data/app.sqlite');
  assert.equal(report.target.path, 'src');
  assert.equal(report.sqlite.tables.some((table) => table.name === 'users'), true);
  assert.equal(report.source.matches.some((match) => match.kind === 'node-sqlite-import'), true);
  assert.equal(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_KEEP_EXISTING_SQLITE_SOURCE'), true);
});

test('CLI integrate inspect prints wrapper-first SQLite guidance', async (t) => {
  const sqliteFile = await createSqliteIntegrationFixture(t);
  if (!sqliteFile) return;
  const cwd = path.dirname(path.dirname(sqliteFile));

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'integrate',
    'inspect',
    './src',
    '--sqlite',
    './data/app.sqlite',
    '--cwd',
    cwd,
  ]);

  assert.equal(stderr, '');
  assert.match(stdout, /Existing SQLite remains the write source of truth/);
  assert.match(stdout, /suggestions:/);
  assert.match(stdout, /INTEGRATE_KEEP_EXISTING_SQLITE_SOURCE/);
  assert.match(stdout, /path: table-backed-adapter via table-adapter/);
});

test('CLI integrate inspect writes and checks reports relative to cwd', async (t) => {
  const sqliteFile = await createSqliteIntegrationFixture(t);
  if (!sqliteFile) return;
  const cwd = path.dirname(path.dirname(sqliteFile));
  await mkdir(path.join(cwd, 'src/generated'), { recursive: true });

  const written = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'integrate',
    'inspect',
    './src',
    '--sqlite',
    './data/app.sqlite',
    '--cwd',
    cwd,
    '--out',
    './src/generated/db.integration.json',
  ]);
  const report = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.integration.json'), 'utf8'));
  const checked = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'integrate',
    'inspect',
    './src',
    '--sqlite',
    './data/app.sqlite',
    '--cwd',
    cwd,
    '--check',
    './src/generated/db.integration.json',
  ]);

  assert.match(written.stdout, /Generated src\/generated\/db\.integration\.json/);
  assert.equal(report.kind, 'db.integrationReport');
  assert.match(checked.stdout, /Integration report matches src\/generated\/db\.integration\.json/);
});

test('CLI integrate inspect target-state writes import plans and generated importers', async (t) => {
  const sqliteFile = await createSqliteIntegrationFixture(t);
  if (!sqliteFile) return;
  const cwd = path.dirname(path.dirname(sqliteFile));
  await mkdir(path.join(cwd, 'src/generated'), { recursive: true });
  await mkdir(path.join(cwd, 'scripts'), { recursive: true });

  const written = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'integrate',
    'inspect',
    './src',
    '--sqlite',
    './data/app.sqlite',
    '--target-state',
    './data/local-registry.asyncdb',
    '--cwd',
    cwd,
    '--out',
    './src/generated/db.integration.json',
  ]);
  const report = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.integration.json'), 'utf8'));
  const generated = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'integrate',
    'generate',
    'importer',
    '--plan',
    './src/generated/db.integration.json',
    '--out',
    './scripts/import-legacy-sqlite.js',
    '--cwd',
    cwd,
  ]);
  const importer = await readFile(path.join(cwd, 'scripts/import-legacy-sqlite.js'), 'utf8');

  assert.match(written.stdout, /Generated src\/generated\/db\.integration\.json/);
  assert.equal(report.importPlan.kind, 'sqlite.importPlan');
  assert.equal(report.importPlan.target.stateFile, 'data/local-registry.asyncdb');
  assert.equal(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_IMPORT_TO_ASYNC_DB_STATE'), true);
  assert.match(generated.stdout, /Generated scripts\/import-legacy-sqlite\.js/);
  assert.match(importer, /from '@async\/db'/);
  assert.match(importer, /from '@async\/db\/sqlite'/);
  assert.match(importer, /from '@async\/db\/sqlite\/compat'/);
  assert.doesNotMatch(importer, /from ['"]node:sqlite['"]|from ['"]better-sqlite3['"]|from ['"]sqlite3['"]/);
  assert.doesNotMatch(importer, /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  assert.match(importer, /--apply/);
});

test('CLI integrate inspect prints source-only Postgres guidance', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await writeFile(path.join(cwd, 'src/db.ts'), `
import { Pool } from 'pg';
import postgres from 'postgres';
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export async function listUsers() {
  return pool.query('SELECT * FROM users WHERE active = $1', [true]);
}
`, 'utf8');

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'integrate',
    'inspect',
    './src',
    '--postgres',
    '--json',
    '--cwd',
    cwd,
  ]);
  const report = JSON.parse(stdout);

  assert.equal(stderr, '');
  assert.equal(report.kind, 'db.integrationReport');
  assert.equal(report.postgres.mode, 'source-only');
  assert.deepEqual(report.postgres.drivers.detected, ['pg', 'postgres']);
  assert.equal(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_KEEP_EXISTING_POSTGRES_SOURCE'), true);
  assert.equal(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_USE_POSTGRES_COMPAT_DRIVER'), true);
});

test('CLI integrate inspect prints wrapper-first Postgres guidance', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await writeFile(path.join(cwd, 'src/db.ts'), `
import { Pool } from 'pg';
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
`, 'utf8');

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'integrate',
    'inspect',
    './src',
    '--postgres',
    '--cwd',
    cwd,
  ]);

  assert.equal(stderr, '');
  assert.match(stdout, /Existing Postgres remains the write source of truth/);
  assert.match(stdout, /source-only/);
  assert.match(stdout, /INTEGRATE_KEEP_EXISTING_POSTGRES_SOURCE/);
});

test('CLI integrate generate importer supports Postgres import plans', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src/generated'), { recursive: true });
  await mkdir(path.join(cwd, 'scripts'), { recursive: true });
  await writeFile(path.join(cwd, 'src/generated/db.integration.json'), JSON.stringify({
    version: 1,
    kind: 'db.integrationReport',
    generatedAt: '2026-06-07T00:00:00.000Z',
    target: { path: 'src', kind: 'directory' },
    postgres: {
      mode: 'catalog',
      connectionStringEnv: 'DATABASE_URL',
      schemas: ['public'],
      drivers: { detected: ['pg'], recommended: 'pg', ormDetected: [] },
      catalog: { schemas: ['public'], tables: [], exactRowCounts: false },
      errors: [],
    },
    source: { filesScanned: 0, filesWithMatches: 0, matches: [] },
    recommendations: [],
    suggestions: [],
    importPlan: {
      version: 1,
      kind: 'postgres.importPlan',
      source: { connectionStringEnv: 'DATABASE_URL', driver: 'pg', schemas: ['public'] },
      target: {
        kind: 'postgres-envelope',
        connectionStringEnv: 'DATABASE_URL',
        driver: 'pg',
        schema: 'public',
        table: '_async_db_resources',
      },
      resources: [],
      batchSize: 500,
      warnings: [],
    },
    suggestedFiles: [],
    agentInstructions: [],
  }, null, 2), 'utf8');

  const generated = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'integrate',
    'generate',
    'importer',
    '--plan',
    './src/generated/db.integration.json',
    '--out',
    './scripts/import-legacy-postgres.js',
    '--cwd',
    cwd,
  ]);
  const importer = await readFile(path.join(cwd, 'scripts/import-legacy-postgres.js'), 'utf8');

  assert.match(generated.stdout, /Generated scripts\/import-legacy-postgres\.js/);
  assert.match(importer, /from '@async\/db\/postgres\/compat'/);
  assert.doesNotMatch(importer, /from ['"]pg['"]|from ['"]postgres['"]|from ['"]@neondatabase\/serverless['"]|from ['"]@vercel\/postgres['"]|from ['"]pg-promise['"]/);
  assert.doesNotMatch(importer, /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  assert.match(importer, /--apply/);
});

test('CLI contracts infer from tags and write contract refs', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "fields": {
      "id": { "type": "string", "tags": ["public"] },
      "name": { "type": "string", "tags": ["public"] },
      "email": { "type": "string", "tags": ["internal"] }
    },
    "seed": []
  }`);
  await mkdir(path.join(cwd, 'db/operations'), { recursive: true });
  await writeFile(path.join(cwd, 'db/operations/get-user.jsonc'), `{
    "name": "GetUser",
    "ref": "users.get",
    "method": "GET",
    "path": "/users/{id}.json",
    "query": { "select": "id,name" }
  }`, 'utf8');
  await writeConfig(cwd, `export default {
    outputs: {
      contractRefs: './src/generated/db.contract-refs.json',
    },
    contracts: {
      public: {
        resources: {
          users: {
            fields: ['id', 'name'],
            read: true,
            write: false,
          },
        },
        operations: ['GetUser'],
      },
    },
  };`);

  const inferred = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'contracts',
    'infer',
    '--from-tags',
    '--cwd',
    cwd,
  ]);
  const refs = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'contracts',
    'refs',
    '--cwd',
    cwd,
  ]);
  const check = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'contracts',
    'check',
    '--cwd',
    cwd,
  ]);
  const inferredJson = JSON.parse(inferred.stdout);
  const refsJson = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.contract-refs.json'), 'utf8'));

  assert.equal(inferredJson.contracts.public.resources.users.fields.includes('name'), true);
  assert.match(refs.stdout, /Generated src\/generated\/db\.contract-refs\.json/);
  assert.equal(refsJson.contracts.public.operations.GetUser.ref, 'users.get');
  assert.match(check.stdout, /Contract check passed/);
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
    path.resolve('dist/cli.js'),
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
    path.resolve('dist/cli.js'),
    'schema',
    'infer',
    'pages',
    '--cwd',
    cwd,
  ]);
  const resource = JSON.parse(single.stdout);

  assert.equal(resource.fields.blocks.items.discriminator, 'type');

  const written = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
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
    path.resolve('dist/cli.js'),
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
    path.resolve('dist/cli.js'),
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
      path.resolve('dist/cli.js'),
      'schema',
      'unbundle',
      'users',
      '--cwd',
      cwd,
      '--seed-out',
      './artifacts/users.json',
    ]),
    (error: any) => {
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
    path.resolve('dist/cli.js'),
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
    path.resolve('dist/cli.js'),
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
    path.resolve('dist/cli.js'),
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
    path.resolve('dist/cli.js'),
    'schema',
    'unbundle',
    'users',
    '--cwd',
    cwd,
  ]);

  await assert.rejects(() => readFile(path.join(cwd, 'db/users.json'), 'utf8'), /ENOENT/);

  await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
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
      path.resolve('dist/cli.js'),
      'schema',
      'unbundle',
      'users',
      '--cwd',
      cwd,
    ]),
    (error: any) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_UNBUNDLE_SCHEMA_MODULE_REQUIRES_OUT/);
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
    path.resolve('dist/cli.js'),
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
      path.resolve('dist/cli.js'),
      'schema',
      'bundle',
      'users',
      '--cwd',
      cwd,
      '--out',
      './db/users.bundle.schema.json',
    ]),
    (error: any) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_BUNDLE_LIVE_OUTPUT_REQUIRES_FORCE/);
      return true;
    },
  );
});

test('CLI schema bundle without target keeps non-TTY error and suggests --all', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true }
    }
  }`);

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('dist/cli.js'),
      'schema',
      'bundle',
      '--cwd',
      cwd,
    ]),
    (error: any) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_BUNDLE_REQUIRES_RESOURCE/);
      assert.match(error.stderr, /--all/);
      assert.match(error.stderr, /users/);
      return true;
    },
  );
});

test('CLI schema unbundle without target keeps non-TTY error and suggests --all', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true }
    }
  }`);

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('dist/cli.js'),
      'schema',
      'unbundle',
      '--cwd',
      cwd,
    ]),
    (error: any) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_UNBUNDLE_REQUIRES_RESOURCE/);
      assert.match(error.stderr, /--all/);
      assert.match(error.stderr, /users/);
      return true;
    },
  );
});

test('CLI schema bundle --all writes root schema with inline resolver wrappers', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.mjs', `import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    firstName: field.string(),
    lastName: field.string(),
    fullName: field.computed(field.string(), ({ record }) => {
      return \`\${record.firstName} \${record.lastName}\`;
    }),
  },
  seed: [
    { id: 'u_1', firstName: 'Ada', lastName: 'Lovelace' },
  ],
});
`);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'bundle',
    '--all',
    '--cwd',
    cwd,
    '--out',
    './db.schema.mjs',
  ]);
  const rootSchema = await readFile(path.join(cwd, 'db.schema.mjs'), 'utf8');

  assert.match(stdout, /Generated db\.schema\.mjs/);
  assert.match(stderr, /SCHEMA_BUNDLE_IMPORTED_RESOLVER/);
  assert.match(stderr, /SCHEMA_BUNDLE_ARROW_RESOLVER_WRAPPED/);
  assert.match(rootSchema, /import usersSource from '\.\/db\/users\.schema\.mjs';/);
  assert.match(rootSchema, /function users_fullName_resolver\(context\)/);
  assert.match(rootSchema, /usersSource\.fields\.fullName\.resolve\.call\(this, context\)/);
  assert.match(rootSchema, /firstName: field\.string\(\)/);
  assert.match(rootSchema, /id: field\.string\(\{ required: true \}\)/);
  assert.doesNotMatch(rootSchema, /field\.string\(\{\}\)/);
  assert.doesNotMatch(rootSchema, /seed:/);
});

test('CLI schema bundle --all preserves Standard Schema validators by importing source modules', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', '[]');
  await writeFixture(cwd, 'users.schema.mjs', `import { collection, field } from '@async/db/schema';

const UserSchema = {
  '~standard': {
    version: 1,
    vendor: 'bundle-validator-fixture',
    validate(value) {
      if (!value || typeof value !== 'object' || typeof value.email !== 'string' || !value.email.includes('@')) {
        return { issues: [{ message: 'Email must include @', path: ['email'] }] };
      }
      return {
        value: {
          ...value,
          email: value.email.trim().toLowerCase(),
        },
      };
    },
  },
};

export default collection({
  idField: 'id',
  validator: UserSchema,
  fields: {
    id: field.string({ required: true }),
    email: field.string({ required: true }),
  },
});
`);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'bundle',
    '--all',
    '--cwd',
    cwd,
    '--out',
    './db.schema.mjs',
  ]);
  const rootSchema = await readFile(path.join(cwd, 'db.schema.mjs'), 'utf8');
  const db = await openDb({ cwd });
  const user = await db.collection('users').create({
    id: 'u_1',
    email: ' ADA@EXAMPLE.COM ',
  });

  assert.match(stdout, /Generated db\.schema\.mjs/);
  assert.match(stderr, /SCHEMA_BUNDLE_IMPORTED_VALIDATOR/);
  assert.match(rootSchema, /import usersSource from '\.\/db\/users\.schema\.mjs';/);
  assert.match(rootSchema, /validator: usersSource\.validator,/);
  assert.doesNotMatch(rootSchema, /standardSchema/);
  assert.equal(user.email, 'ada@example.com');
});

test('CLI schema bundle --all can emit Standard Schema-first resources when configured', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
  schema: {
    standardSchema: true,
  },
};
`);
  await writeFixture(cwd, 'users.json', '[]');
  await writeFixture(cwd, 'users.schema.mjs', `import { collection, field } from '@async/db/schema';

const UserSchema = {
  '~standard': {
    version: 1,
    vendor: 'bundle-standard-first-fixture',
    validate(value) {
      return {
        value: {
          ...value,
          email: value.email.trim().toLowerCase(),
        },
      };
    },
  },
};

export default collection({
  idField: 'id',
  validator: UserSchema,
  fields: {
    id: field.string({ required: true }),
    email: field.string({ required: true }),
  },
});
`);

  await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'bundle',
    '--all',
    '--cwd',
    cwd,
    '--out',
    './db.schema.mjs',
  ]);
  const rootSchema = await readFile(path.join(cwd, 'db.schema.mjs'), 'utf8');
  const db = await openDb({ cwd });
  const user = await db.collection('users').create({
    id: 'u_1',
    email: ' ADA@EXAMPLE.COM ',
  });

  assert.match(rootSchema, /users: collection\(usersSource\.validator, \{/);
  assert.doesNotMatch(rootSchema, /validator: usersSource\.validator,/);
  assert.doesNotMatch(rootSchema, /standardSchema/);
  assert.equal(user.email, 'ada@example.com');
});

test('CLI schema bundle --all defaults to db.schema.js in ESM projects', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8');
  await writeFixture(cwd, 'users.schema.js', `import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    name: field.string({ required: true }),
    label: field.computed(field.string(), ({ record }) => record.name),
  },
});
`);

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'bundle',
    '--all',
    '--cwd',
    cwd,
  ]);
  const rootSchema = await readFile(path.join(cwd, 'db.schema.js'), 'utf8');

  assert.match(stdout, /Generated db\.schema\.js/);
  assert.match(rootSchema, /import usersSource from '\.\/db\/users\.schema\.js';/);
  await assert.rejects(() => readFile(path.join(cwd, 'db.schema.mjs'), 'utf8'), /ENOENT/);
  await assert.rejects(() => readFile(path.join(cwd, 'db/package.json'), 'utf8'), /ENOENT/);
});

test('CLI schema bundle --all rebases folder collection source globs for root schema', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeConfig(cwd, `export default {
  resources: {
    docs: {
      store: 'static',
    },
  },
};
`);
  await writeFile(path.join(cwd, 'db/docs/index.schema.mjs'), `import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'frontmatter' }),
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true }),
  },
});
`, 'utf8');
  await writeFile(path.join(cwd, 'db/docs/intro.mdx'), `---
title: Intro
---
# Hello
`, 'utf8');

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'bundle',
    '--all',
    '--cwd',
    cwd,
  ]);
  const rootSchema = await readFile(path.join(cwd, 'db.schema.mjs'), 'utf8');

  assert.match(stdout, /Generated db\.schema\.mjs/);
  assert.match(rootSchema, /source: files\("\.\/db\/docs\/\*\*\/\*\.mdx", \{ read: "frontmatter" \}\)/);
  assert.doesNotMatch(rootSchema, /source: files\("\.\/\*\*\/\*\.mdx"/);

  const synced = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'sync',
    '--cwd',
    cwd,
  ]);
  assert.match(synced.stdout, /Synced runtime store/);
});

test('CLI schema bundle --all unbundles embedded schema seed before writing root schema', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "u_1", "name": "Ada" }
    ]
  }`);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'bundle',
    '--all',
    '--cwd',
    cwd,
  ]);
  const seed = JSON.parse(await readFile(path.join(cwd, 'db/users.json'), 'utf8'));
  const rootSchema = await readFile(path.join(cwd, 'db.schema.mjs'), 'utf8');

  assert.match(stdout, /Generated db\/users\.json/);
  assert.match(stdout, /Generated db\.schema\.mjs/);
  assert.match(stderr, /SCHEMA_BUNDLE_SEED_UNBUNDLED/);
  assert.deepEqual(seed, [{ id: 'u_1', name: 'Ada' }]);
  assert.doesNotMatch(rootSchema, /seed:/);
});

test('CLI schema bundle --all accepts an existing matching unbundled seed fixture', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schema: {
      source: 'schema',
    },
  };`);
  await writeFixture(cwd, 'users.json', '[{"name":"Ada","id":"u_1"}]\n');
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "u_1", "name": "Ada" }
    ]
  }`);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'bundle',
    '--all',
    '--cwd',
    cwd,
  ]);
  const seed = JSON.parse(await readFile(path.join(cwd, 'db/users.json'), 'utf8'));

  assert.match(stdout, /Generated db\.schema\.mjs/);
  assert.doesNotMatch(stderr, /SCHEMA_BUNDLE_SEED_UNBUNDLED/);
  assert.deepEqual(seed, [{ name: 'Ada', id: 'u_1' }]);
});

test('CLI schema bundle --all refuses conflicting unbundled seed without force', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schema: {
      source: 'schema',
    },
  };`);
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "u_1", "name": "Ada" }
    ]
  }`);
  await writeFixture(cwd, 'users.json', '[{ "id": "u_2", "name": "Grace" }]\n');

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('dist/cli.js'),
      'schema',
      'bundle',
      '--all',
      '--cwd',
      cwd,
    ]),
    (error: any) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_BUNDLE_SEED_OUTPUT_EXISTS/);
      return true;
    },
  );
});

test('CLI schema bundle --all force overwrites conflicting unbundled seed', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schema: {
      source: 'schema',
    },
  };`);
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "u_1", "name": "Ada" }
    ]
  }`);
  await writeFixture(cwd, 'users.json', '[{ "id": "u_2", "name": "Grace" }]\n');

  await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'bundle',
    '--all',
    '--cwd',
    cwd,
    '--force',
  ]);
  const seed = JSON.parse(await readFile(path.join(cwd, 'db/users.json'), 'utf8'));

  assert.deepEqual(seed, [{ id: 'u_1', name: 'Ada' }]);
});

test('CLI schema bundle --all does not write seed when root output conflicts', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "u_1", "name": "Ada" }
    ]
  }`);
  await writeFile(path.join(cwd, 'db.schema.mjs'), 'export default {};\n', 'utf8');

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('dist/cli.js'),
      'schema',
      'bundle',
      '--all',
      '--cwd',
      cwd,
    ]),
    (error: any) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_BUNDLE_ROOT_EXISTS/);
      return true;
    },
  );

  await assert.rejects(() => readFile(path.join(cwd, 'db/users.json'), 'utf8'), /ENOENT/);
});

test('CLI schema bundle --all does not write empty embedded schema seed fixtures', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true }
    },
    "seed": []
  }`);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'bundle',
    '--all',
    '--cwd',
    cwd,
  ]);

  assert.match(stdout, /Generated db\.schema\.mjs/);
  assert.doesNotMatch(stdout, /Generated db\/users\.json/);
  assert.doesNotMatch(stderr, /SCHEMA_BUNDLE_SEED_UNBUNDLED/);
  await assert.rejects(() => readFile(path.join(cwd, 'db/users.json'), 'utf8'), /ENOENT/);
});

test('CLI schema bundle --all refuses to replace an existing root schema without force', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true }
    }
  }`);
  await writeFile(path.join(cwd, 'db.schema.mjs'), 'export default {};\n', 'utf8');

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('dist/cli.js'),
      'schema',
      'bundle',
      '--all',
      '--cwd',
      cwd,
    ]),
    (error: any) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_BUNDLE_ROOT_EXISTS/);
      return true;
    },
  );
});

test('CLI schema unbundle --all requires a root schema', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true }
    }
  }`);

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('dist/cli.js'),
      'schema',
      'unbundle',
      '--all',
      '--cwd',
      cwd,
    ]),
    (error: any) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /SCHEMA_UNBUNDLE_ROOT_REQUIRED/);
      return true;
    },
  );
});

test('CLI schema unbundle --all writes per-resource schema files from root schema', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'db.schema.mjs'), `
import { collection, field } from '@async/db/schema';

export default {
  users: collection({
    idField: 'id',
    fields: {
      id: field.string({ required: true }),
      name: field.string({ required: true }),
    },
  }),
};
`, 'utf8');

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'unbundle',
    '--all',
    '--cwd',
    cwd,
    '--schema-dir',
    './db',
  ]);
  const usersSchema = JSON.parse(await readFile(path.join(cwd, 'db/users.schema.jsonc'), 'utf8'));

  assert.match(stdout, /Generated db\/users\.schema\.jsonc/);
  assert.match(stderr, /SCHEMA_UNBUNDLE_SEED_NOT_MOVED/);
  assert.equal(usersSchema.seed, undefined);
  assert.equal(usersSchema.fields.name.type, 'string');
});

test('CLI schema unbundle --all keeps executable resolvers in per-resource js files when db can be ESM', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'db.schema.mjs'), `
import { collection, field } from '@async/db/schema';

export default {
  users: collection({
    idField: 'id',
    fields: {
      id: field.string({ required: true }),
      firstName: field.string(),
      fullName: field.computed(field.string(), function users_fullName_resolver({ record }) {
        return record.firstName;
      }),
    },
  }),
};
`, 'utf8');

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'unbundle',
    '--all',
    '--cwd',
    cwd,
    '--schema-dir',
    './db',
  ]);
  const packageMarker = JSON.parse(await readFile(path.join(cwd, 'db/package.json'), 'utf8'));
  const usersSchema = await readFile(path.join(cwd, 'db/users.schema.js'), 'utf8');

  assert.match(stdout, /Generated db\/package\.json/);
  assert.match(stdout, /Generated db\/users\.schema\.js/);
  assert.match(stderr, /SCHEMA_UNBUNDLE_EXECUTABLE_REQUIRES_MODULE/);
  assert.equal(packageMarker.type, 'module');
  assert.match(usersSchema, /import rootSchema from '\.\.\/db\.schema\.mjs';/);
  assert.match(usersSchema, /function users_fullName_resolver\(context\)/);
  assert.match(usersSchema, /rootSchema\.users\.fields\.fullName\.resolve\.call\(this, context\)/);
});

test('CLI schema unbundle --all keeps Standard Schema validators in per-resource js files when db can be ESM', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'db.schema.mjs'), `
import { collection, field } from '@async/db/schema';

const UserSchema = {
  '~standard': {
    version: 1,
    vendor: 'unbundle-validator-fixture',
    validate(value) {
      if (!value || typeof value !== 'object' || typeof value.email !== 'string' || !value.email.includes('@')) {
        return { issues: [{ message: 'Email must include @', path: ['email'] }] };
      }
      return {
        value: {
          ...value,
          email: value.email.trim().toLowerCase(),
        },
      };
    },
  },
};

export default {
  users: collection({
    idField: 'id',
    validator: UserSchema,
    fields: {
      id: field.string({ required: true }),
      email: field.string({ required: true }),
    },
  }),
};
`, 'utf8');

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'unbundle',
    '--all',
    '--cwd',
    cwd,
    '--schema-dir',
    './db',
  ]);
  const usersSchemaPath = path.join(cwd, 'db/users.schema.js');
  const usersSchema = await readFile(usersSchemaPath, 'utf8');
  const url = pathToFileURL(usersSchemaPath);
  url.searchParams.set('cacheBust', String(Date.now()));
  const module = await import(url.href);
  const valid = module.default.validator['~standard'].validate({
    id: 'u_1',
    email: ' ADA@EXAMPLE.COM ',
  });

  assert.match(stdout, /Generated db\/package\.json/);
  assert.match(stdout, /Generated db\/users\.schema\.js/);
  assert.match(stderr, /SCHEMA_UNBUNDLE_EXECUTABLE_REQUIRES_MODULE/);
  assert.match(usersSchema, /import rootSchema from '\.\.\/db\.schema\.mjs';/);
  assert.match(usersSchema, /validator: rootSchema\.users\.validator,/);
  assert.doesNotMatch(usersSchema, /standardSchema/);
  assert.deepEqual(valid.value, {
    id: 'u_1',
    email: 'ada@example.com',
  });
});

test('CLI schema unbundle --all can emit Standard Schema-first resources when configured', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
  schema: {
    standardSchema: true,
  },
};
`);
  await writeFile(path.join(cwd, 'db.schema.mjs'), `
import { collection, field } from '@async/db/schema';

const UserSchema = {
  '~standard': {
    version: 1,
    vendor: 'unbundle-standard-first-fixture',
    validate(value) {
      return {
        value: {
          ...value,
          email: value.email.trim().toLowerCase(),
        },
      };
    },
  },
};

export default {
  users: collection({
    idField: 'id',
    validator: UserSchema,
    fields: {
      id: field.string({ required: true }),
      email: field.string({ required: true }),
    },
  }),
};
`, 'utf8');

  await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'unbundle',
    '--all',
    '--cwd',
    cwd,
    '--schema-dir',
    './db',
  ]);
  const usersSchemaPath = path.join(cwd, 'db/users.schema.js');
  const usersSchema = await readFile(usersSchemaPath, 'utf8');
  const url = pathToFileURL(usersSchemaPath);
  url.searchParams.set('cacheBust', String(Date.now()));
  const module = await import(url.href);
  const valid = module.default.validator['~standard'].validate({
    id: 'u_1',
    email: ' ADA@EXAMPLE.COM ',
  });

  assert.match(usersSchema, /export default collection\(rootSchema\.users\.validator, \{/);
  assert.doesNotMatch(usersSchema, /validator: rootSchema\.users\.validator,/);
  assert.doesNotMatch(usersSchema, /standardSchema/);
  assert.deepEqual(valid.value, {
    id: 'u_1',
    email: 'ada@example.com',
  });
});

test('CLI schema unbundle --all preserves db.schema.js imports in ESM projects', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(cwd, 'db.schema.js'), `
import { collection, field } from '@async/db/schema';

export default {
  users: collection({
    idField: 'id',
    fields: {
      id: field.string({ required: true }),
      fullName: field.computed(field.string(), function users_fullName_resolver({ record }) {
        return record.id;
      }),
    },
  }),
};
`, 'utf8');

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'unbundle',
    '--all',
    '--cwd',
    cwd,
    '--schema-dir',
    './db',
  ]);
  const usersSchema = await readFile(path.join(cwd, 'db/users.schema.js'), 'utf8');

  assert.match(stdout, /Generated db\/users\.schema\.js/);
  assert.doesNotMatch(stdout, /Generated db\/package\.json/);
  assert.match(usersSchema, /import rootSchema from '\.\.\/db\.schema\.js';/);
});

test('CLI schema unbundle --all falls back to mjs outside an ESM package boundary', async () => {
  const cwd = await makeProject();
  const schemaDir = path.join(path.dirname(cwd), `${path.basename(cwd)}-schema-out`);
  await writeFile(path.join(cwd, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(cwd, 'db.schema.js'), `
import { collection, field } from '@async/db/schema';

export default {
  users: collection({
    idField: 'id',
    fields: {
      id: field.string({ required: true }),
      fullName: field.computed(field.string(), function users_fullName_resolver({ record }) {
        return record.id;
      }),
    },
  }),
};
`, 'utf8');

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'unbundle',
    '--all',
    '--cwd',
    cwd,
    '--schema-dir',
    schemaDir,
  ]);
  const usersSchema = await readFile(path.join(schemaDir, 'users.schema.mjs'), 'utf8');

  assert.match(stdout, /Generated \.\.\/async-db-test-.*-schema-out\/users\.schema\.mjs/);
  assert.match(usersSchema, /import rootSchema from '\.\.\/.*\/db\.schema\.js';/);
  await assert.rejects(() => readFile(path.join(schemaDir, 'users.schema.js'), 'utf8'), /ENOENT/);
});

test('CLI schema unbundle --all falls back to mjs when db package marker is disabled', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
  schema: {
    autoModulePackageJson: false,
  },
};
`);
  await writeFile(path.join(cwd, 'db.schema.mjs'), `
import { collection, field } from '@async/db/schema';

export default {
  users: collection({
    idField: 'id',
    fields: {
      id: field.string({ required: true }),
      fullName: field.computed(field.string(), function users_fullName_resolver({ record }) {
        return record.id;
      }),
    },
  }),
};
`, 'utf8');

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'unbundle',
    '--all',
    '--cwd',
    cwd,
    '--schema-dir',
    './db',
  ]);
  const usersSchema = await readFile(path.join(cwd, 'db/users.schema.mjs'), 'utf8');

  assert.match(stdout, /Generated db\/users\.schema\.mjs/);
  assert.doesNotMatch(stdout, /Generated db\/package\.json/);
  assert.match(usersSchema, /import rootSchema from '\.\.\/db\.schema\.mjs';/);
  await assert.rejects(() => readFile(path.join(cwd, 'db/users.schema.js'), 'utf8'), /ENOENT/);
});

test('CLI schema infer --out requires a single resource', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve('dist/cli.js'),
      'schema',
      'infer',
      '--cwd',
      cwd,
      '--out',
      './db/users.schema.jsonc',
    ]),
    (error: any) => {
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
    path.resolve('dist/cli.js'),
    'types',
    '--cwd',
    cwd,
    '--out',
    './src/generated/db.types.d.ts',
  ]);

  const generated = await readFile(path.join(cwd, 'src/generated/db.types.d.ts'), 'utf8');

  assert.match(stdout, /Generated src\/generated\/db\.types\.d\.ts/);
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
    path.resolve('dist/cli.js'),
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
    path.resolve('dist/cli.js'),
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
    path.resolve('dist/cli.js'),
    'operations',
    'build',
    '--cwd',
    cwd,
  ]);

  const checked = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
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
      path.resolve('dist/cli.js'),
      'operations',
      'contract',
      '--cwd',
      cwd,
      '--check',
    ]),
    (error: any) => error.stderr.includes('Operation client contract changed'),
  );
});

test('CLI operations contract does not create the default operation source folder', async () => {
  const cwd = await makeProject();

  const printed = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'operations',
    'contract',
    '--cwd',
    cwd,
  ]);
  const contract = JSON.parse(printed.stdout);

  assert.deepEqual(contract.operations, {});
  await assert.rejects(
    () => access(path.join(cwd, 'db/operations')),
    (error: any) => error.code === 'ENOENT',
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
    path.resolve('dist/cli.js'),
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
      path.resolve('dist/cli.js'),
      'operations',
      'contract',
      '--cwd',
      cwd,
      '--check',
    ]),
    (error: any) => error.stderr.includes('Operation contract check needs --out <file> or outputs.operationRefs in db.config.js.'),
  );
});

test('CLI subcommands print focused help without running the command', async () => {
  await assertCliHelp(['schema', '--help'], /async-db schema infer \[resource\] \[--out <file>\]/);
  await assertCliHelp(['types', '--help'], /Usage:\n  async-db types \[--watch\] \[--out <file>\]/);
  await assertCliHelp(['doctor', '--help'], /Usage:\n  async-db doctor \[--strict\] \[--json\]/);
  await assertCliHelp(['viewer', '--help'], /Usage:\n  async-db viewer manifest \[--out <file>\]/);
  await assertCliHelp(['usage', '--help'], /Usage:\n  async-db usage scan \[target\]/);
  await assertCliHelp(['integrate', '--help'], /Usage:\n  async-db integrate inspect \[target\] --sqlite <file>/);
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
  await assertCliHelp(['usage', '--help'], /Usage:\n  async-db usage scan \[target\]/, cwd);
  await assertCliHelp(['integrate', '--help'], /Usage:\n  async-db integrate inspect \[target\] --sqlite <file>/, cwd);
  await assertCliHelp(['serve', '--help'], /Usage:\n  async-db serve \[--host <host>\] \[--port <port>\]/, cwd);
  await assertCliHelp(['operations', '--help'], /async-db operations contract \[--out <file>\] \[--check\]/, cwd);
  await assertCliHelp(['generate', 'hono', '--help'], /Usage:\n  async-db generate hono/, cwd);
});

async function assertCliHelp(args: string[], pattern: RegExp, cwd?: string) {
  cwd ??= await makeProject();
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    ...args,
    '--cwd',
    cwd,
  ], {
    timeout: 1000,
  });

  assert.match(stdout, pattern);
  assert.equal(stderr, '');
}

async function createSqliteIntegrationFixture(t): Promise<string | null> {
  let DatabaseSync;
  try {
    DatabaseSync = ((await import('node:sqlite')) as any).DatabaseSync;
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return null;
  }

  const cwd = await makeProject();
  const sqliteFile = path.join(cwd, 'data/app.sqlite');
  await mkdir(path.dirname(sqliteFile), { recursive: true });
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  const database = new DatabaseSync(sqliteFile);
  try {
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      ) STRICT;
      INSERT INTO users (id, name) VALUES ('u_1', 'Ada');
    `);
  } finally {
    database.close();
  }
  await writeFile(path.join(cwd, 'src/db.ts'), `
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('./data/app.sqlite');
db.prepare('SELECT * FROM users WHERE id = ?');
`, 'utf8');
  return sqliteFile;
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

async function stopChild(child: any) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
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
