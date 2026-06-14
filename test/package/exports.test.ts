import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { makeProject } from '../helpers.js';

const execFileAsync = promisify(execFile);
const tscPath = path.resolve('node_modules/typescript/bin/tsc');

async function linkNodeTypes(cwd: string): Promise<void> {
  const source = path.resolve('node_modules/@types/node');
  const targetDir = path.join(cwd, 'node_modules/@types');
  const target = path.join(targetDir, 'node');
  await mkdir(targetDir, { recursive: true });

  try {
    await symlink(source, target, 'dir');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

async function declarationFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await declarationFiles(file));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      files.push(file);
    }
  }

  return files.sort();
}

test('consumer projects can import package APIs through the @async/db package', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'check-package.mjs'), `import { createDbOperationHandler, createDbRequestHandler, createDbRuntime, createIndexedDbCacheStorage, createMemoryFs, inspectSchemaMigration, loadDbSchema, openDb, reloadDb, watchDbSources } from '@async/db';
import { createDbClient, createIndexedDbCacheStorage as createClientIndexedDbCacheStorage } from '@async/db/client';
import { defineConfig } from '@async/db/config';
import { fileStorage, jsonStore, jsonStoreCapabilities, readJsonState, s3Storage, writeJsonState } from '@async/db/json';
import { sqliteStore } from '@async/db/sqlite';
import { compoundKeyId, defineSqliteImportPlan, openLegacySqlite } from '@async/db/sqlite/compat';
import { openPostgresDb, postgresStore } from '@async/db/postgres';
import { adaptPostgresClient, compoundKeyId as postgresCompoundKeyId, definePostgresImportPlan, openLegacyPostgres } from '@async/db/postgres/compat';
import { kvStore } from '@async/db/kv';
import { redisStore } from '@async/db/redis';

const jsonModule = await import('@async/db/json');

if (typeof openDb !== 'function') throw new Error('missing package API');
if (typeof loadDbSchema !== 'function') throw new Error('missing schema API');
if (typeof inspectSchemaMigration !== 'function') throw new Error('missing schema migration API');
if (typeof createDbOperationHandler !== 'function') throw new Error('missing operation handler API');
if (typeof createDbRequestHandler !== 'function') throw new Error('missing request handler API');
if (typeof createMemoryFs !== 'function') throw new Error('missing memory fs helper');
if (typeof createDbRuntime !== 'function') throw new Error('missing runtime API');
if (typeof reloadDb !== 'function') throw new Error('missing runtime reload API');
if (typeof watchDbSources !== 'function') throw new Error('missing runtime watch API');
if (typeof createDbClient !== 'function') throw new Error('missing client API');
if (typeof createIndexedDbCacheStorage !== 'function') throw new Error('missing indexeddb cache API');
if (typeof createClientIndexedDbCacheStorage !== 'function') throw new Error('missing client indexeddb cache API');
if (typeof defineConfig !== 'function') throw new Error('missing config API');
if (jsonStoreCapabilities.persistence !== 'local-file') throw new Error('missing json store capabilities');
if (typeof jsonStore !== 'function') throw new Error('missing json store helper');
if (typeof fileStorage !== 'function') throw new Error('missing json file storage helper');
if (typeof s3Storage !== 'function') throw new Error('missing json s3 storage helper');
if ('recordFiles' in jsonModule) throw new Error('json record files helper should not be exported');
if (typeof readJsonState !== 'function') throw new Error('missing json read helper');
if (typeof writeJsonState !== 'function') throw new Error('missing json write helper');
if (typeof sqliteStore !== 'function') throw new Error('missing sqlite store API');
if (typeof compoundKeyId !== 'function') throw new Error('missing sqlite compat compound key helper');
if (typeof defineSqliteImportPlan !== 'function') throw new Error('missing sqlite compat import plan helper');
if (typeof openLegacySqlite !== 'function') throw new Error('missing sqlite compat legacy opener');
if (typeof postgresStore !== 'function') throw new Error('missing postgres store API');
if (typeof openPostgresDb !== 'function') throw new Error('missing postgres table adapter API');
if (typeof adaptPostgresClient !== 'function') throw new Error('missing postgres compat adapter');
if (typeof postgresCompoundKeyId !== 'function') throw new Error('missing postgres compat compound key helper');
if (typeof definePostgresImportPlan !== 'function') throw new Error('missing postgres compat import plan helper');
if (typeof openLegacyPostgres !== 'function') throw new Error('missing postgres compat legacy opener');
if (typeof kvStore !== 'function') throw new Error('missing kv store API');
if (typeof redisStore !== 'function') throw new Error('missing redis store API');
`);

  await execFileAsync(process.execPath, ['check-package.mjs'], { cwd });
});

test('TypeScript consumer projects can compile package APIs and generated types', async () => {
  const cwd = await makeProject();
  await linkNodeTypes(cwd);
  await mkdir(path.join(cwd, 'src/generated'), { recursive: true });
  await writeFile(path.join(cwd, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(cwd, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2022', 'DOM'],
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: ['node'],
      allowImportingTsExtensions: true,
    },
    include: ['src/**/*.ts', 'src/**/*.d.ts'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(cwd, 'src/generated/db.types.d.ts'), `export type User = {
  id: string;
  name: string;
  email?: string;
};

export type Settings = {
  theme?: string;
};

export type DbTypes = {
  collections: {
    users: User;
  };
  documents: {
    settings: Settings;
  };
};
`, 'utf8');
  await writeFile(path.join(cwd, 'src/check-package.ts'), `import {
  createDbOperationHandler,
  createDbRequestHandler,
  createDbRuntime,
  createIndexedDbCacheStorage,
  createMemoryFs,
  inspectSchemaMigration,
  loadDbSchema,
  openDb,
  recordEtag,
  type Db,
  type DbDocumentPath,
  type DbFileSystem,
  type DbSchemaMigrationReport,
  type DbOptions,
  type DbRuntime,
  type DbRuntimeLifecycleEvent,
  type DbRuntimeOptions,
  type DbSourceWatcher,
  type DbWatchOptions,
} from '@async/db';
import { createDbClient, type DbClient } from '@async/db/client';
import { defineConfig, type DbConfig } from '@async/db/config';
import {
  atomicWriteJson,
  atomicWriteJsonVersioned,
  fileStorage,
  jsonStateVersionsDir,
  jsonStore,
  jsonStatePathForResource,
  jsonStoreCapabilities,
  listJsonStateVersions,
  readJsonState,
  recoverJsonStateDir,
  restoreJsonStateVersion,
  s3Storage,
  withJsonStateWrite,
  writeJsonState,
  type JsonStoreCapabilities,
} from '@async/db/json';
import { kvStore } from '@async/db/kv';
import { openPostgresDb, postgresStore, type PostgresTableMapping } from '@async/db/postgres';
import { adaptPostgresClient, compoundKeyId as postgresCompoundKeyId, definePostgresImportPlan, type PostgresCompatDriver, type PostgresImportPlan } from '@async/db/postgres/compat';
import { redisStore } from '@async/db/redis';
import { collection, field, files, type DerivedFieldDefinition, type ResourceDefinition } from '@async/db/schema';
import { sqliteStore } from '@async/db/sqlite';
import { compoundKeyId, defineSqliteImportPlan, type SqliteCompatDriver, type SqliteImportPlan } from '@async/db/sqlite/compat';
import type { DbTypes, User } from './generated/db.types.d.ts';

const config = defineConfig({
  cwd: '.',
  outputs: {
    types: './.db/types/index.d.ts',
    committedTypes: './src/generated/db.types.d.ts',
  },
  stores: {
    json: jsonStore({
      storage: fileStorage('./.db/state'),
      durability: 'versioned',
    }),
  },
}) satisfies DbConfig;

const options: DbOptions = config;
const memoryFs: DbFileSystem = createMemoryFs({
  cwd: '.',
  files: {
    'db/users.json': '[]',
  },
});
const memoryOptions: DbOptions = {
  cwd: '.',
  fs: memoryFs,
};
const documentPath: DbDocumentPath = ['ui', 'theme'];
const usersSchema = collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    name: field.string({ required: true }),
    email: field.string(),
  },
}) satisfies ResourceDefinition & { kind: 'collection' };

const contentSchema = collection({
  source: files('./**/*.mdx', { read: 'frontmatter' }),
  fields: {
    id: field.string({ required: true }),
    body: field.string(),
  },
});
const derivedOptions: DerivedFieldDefinition = { source: 'database', kind: 'trigger' };
const derivedSchema = collection({
  fields: {
    id: field.string({ required: true }),
    updatedAt: field.derived(field.datetime(), derivedOptions),
  },
});

const dbPromise: Promise<Db<DbTypes>> = openDb<DbTypes>(options);
const runtimeOptions: DbRuntimeOptions = {
  cwd: '.',
  watch: false,
  handler: {
    rootRoutes: false,
  },
};
const runtimePromise: Promise<DbRuntime> = createDbRuntime(runtimeOptions);
const migrationReportPromise: Promise<DbSchemaMigrationReport> = inspectSchemaMigration({ cwd: '.', target: './src' });
const watchOptions: DbWatchOptions = { debounceMs: 20 };
let watcher: DbSourceWatcher | null = null;
let runtimeEvent: DbRuntimeLifecycleEvent | null = null;
void runtimePromise.then((runtime) => {
  runtime.events.subscribe((event) => {
    runtimeEvent = event;
  });
  watcher = runtime.watcher;
  void runtime.close();
});
void dbPromise.then(async (db) => {
  await db.forks.create('tenant_acme', { from: 'main', metadata: { purpose: 'tenant' } });
  const tenant = await db.forks.open('tenant_acme');
  await tenant.branches.ensure('preview', { from: 'main', metadata: { purpose: 'preview' } });
  const preview = await tenant.branches.open('preview');
  const branchList = await tenant.branches.list();
  await preview.snapshots.create({ resources: ['users'] });
  await preview.migrations.start('users-to-json', { resources: ['users'], mode: 'read-only' });
  await preview.migrations.finish('users-to-json');
  const users = await db.collection('users').all();
  const first: User | undefined = users[0];
  await db.collection('users').replaceAll(users);
  await db.collection('users').patch('u_1', {}, { ifMatch: recordEtag(first) });
  await db.collection('users').delete('u_1', { ifMatch: '*' });
  await db.document('settings').update({}, { ifMatch: recordEtag({}) });
  const settings = await db.document('settings').get();
  await db.document('settings').set(documentPath, 'dark');
  await db.document('settings').set('theme', 'dark');
  const requestHandler = createDbRequestHandler(db);
  const operationHandler = createDbOperationHandler(db);
  void tenant.query('users.get', { id: 'u_1' });
  void db.forks.ensure('tenant_acme', { from: 'main' });
  void tenant.branches.delete('preview');
  void db.resources.migrate('users', { from: 'json', to: 'json' });
  await db.close();
  void requestHandler;
  void operationHandler;
  void branchList;
  return { first, settings };
});

const client: DbClient = createDbClient({
  baseUrl: 'http://127.0.0.1:0',
  cache: false,
});

void client.rest.get('/users');
void client.graphql('{ users { id } }');
void loadDbSchema({ from: './db.schema.mjs' });
void createIndexedDbCacheStorage({ name: 'async-db-test' });
const jsonCapabilities: JsonStoreCapabilities = jsonStoreCapabilities;
const jsonStatePath = jsonStatePathForResource({ stateDir: './.db' }, { name: 'settings' });
void readJsonState(jsonStatePath, {});
void writeJsonState(jsonStatePath, {});
void atomicWriteJson(jsonStatePath, {});
void withJsonStateWrite(jsonStatePath, async () => undefined);
void withJsonStateWrite(jsonStatePath, async () => undefined, { crossProcessLock: false, lockTimeoutMs: 100, lockStaleMs: 100 });
void atomicWriteJsonVersioned(jsonStatePath, {}, { maxVersions: 5 });
void listJsonStateVersions(jsonStatePath);
void restoreJsonStateVersion(jsonStatePath, 'latest');
void recoverJsonStateDir('.db/state');
void jsonStateVersionsDir(jsonStatePath);
void jsonStore({ durability: 'versioned', maxVersions: 5, encryption: { key: () => 'k' } });
void jsonStore();
void s3Storage({
  bucket: 'app-json-db',
  prefix: 'prod',
  encryption: { mode: 'sse-kms', keyId: 'alias/app-json-db' },
});
void jsonCapabilities;
void sqliteStore({ file: ':memory:' });
const sqliteCompatDriver: SqliteCompatDriver = 'node:sqlite';
const sqliteImportPlan: SqliteImportPlan = defineSqliteImportPlan({
  version: 1,
  kind: 'sqlite.importPlan',
  source: { sqliteFile: './data/app.sqlite', driver: sqliteCompatDriver },
  target: { stateFile: './data/app.asyncdb' },
  resources: [],
});
compoundKeyId(['name', 'version'], { name: '@async/db', version: '0.4.2' });
void sqliteImportPlan;
const postgresCompatDriver: PostgresCompatDriver = 'pg';
const postgresImportPlan: PostgresImportPlan = definePostgresImportPlan({
  version: 1,
  kind: 'postgres.importPlan',
  source: { connectionStringEnv: 'DATABASE_URL', driver: postgresCompatDriver, schemas: ['public'] },
  target: {
    kind: 'postgres-envelope',
    connectionStringEnv: 'DATABASE_URL',
    driver: postgresCompatDriver,
    schema: 'public',
    table: '_async_db_resources',
  },
  resources: [],
  batchSize: 500,
});
const postgresTableMapping: PostgresTableMapping = {
  schema: 'public',
  table: 'users',
  primaryKey: 'id',
};
adaptPostgresClient({ query: async () => ({ rows: [] }) }, { driver: postgresCompatDriver });
postgresCompoundKeyId(['tenantId', 'slug'], { tenantId: 'acme', slug: 'core' });
void postgresImportPlan;
void postgresTableMapping;
void openPostgresDb({ client: { query: async () => ({ rows: [] }) }, project: { resources: [] }, migrate: false });
void postgresStore({ client: { query: async () => ({ rows: [] }) } });
void kvStore({ client: { get: async () => null, set: async () => undefined } });
void redisStore({ client: { get: async () => null, set: async () => undefined } });
void usersSchema;
void contentSchema;
void memoryFs.readFile('db/users.json', 'utf8');
void memoryOptions;
void documentPath;
void watchOptions;
void watcher;
void runtimeEvent;
`, 'utf8');

  await execFileAsync(process.execPath, [tscPath, '-p', 'tsconfig.json'], {
    cwd,
  });
});

test('package metadata exposes @async/db with the async-db CLI', async () => {
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));

  assert.equal(packageJson.name, '@async/db');
  assert.deepEqual(packageJson.bin, {
    'async-db': './dist/cli.js',
  });
  assert.equal(packageJson.exports['.'].default, './dist/index.js');
  assert.equal(packageJson.exports['.'].types, './dist/index.d.ts');
  assert.equal(packageJson.exports['./schema'].default, './dist/schema-builders.js');
  assert.equal(packageJson.exports['./schema'].types, './dist/schema.d.ts');
  assert.equal(packageJson.exports['./json'].default, './dist/json.js');
  assert.equal(packageJson.exports['./json'].types, './dist/json.d.ts');
  assert.equal(packageJson.exports['./sqlite/compat'].default, './dist/sqlite-compat.js');
  assert.equal(packageJson.exports['./sqlite/compat'].types, './dist/sqlite-compat.d.ts');
  assert.equal(packageJson.exports['./postgres'].default, './dist/postgres.js');
  assert.equal(packageJson.exports['./postgres'].types, './dist/postgres.d.ts');
  assert.equal(packageJson.exports['./postgres/compat'].default, './dist/postgres-compat.js');
  assert.equal(packageJson.exports['./postgres/compat'].types, './dist/postgres-compat.d.ts');
  assert.deepEqual(packageJson.repository, {
    type: 'git',
    url: 'https://github.com/async/db',
  });
  assert.deepEqual(packageJson.publishConfig, {
    access: 'public',
  });
  assert.equal(packageJson.scripts['pipeline:verify:force'], 'async-pipeline run verify --force');
  assert.equal(packageJson.scripts['release:check'], 'pnpm run pipeline:verify:force');
  assert.equal(packageJson.scripts['pipeline:release:ensure'], 'async-pipeline release ensure --package .');
  assert.equal(packageJson.scripts['release:doctor'], 'pnpm run pipeline:release-doctor');
  assert.equal(packageJson.scripts['release:pack'], 'npm pack');
  assert.equal(packageJson.scripts['release:publish'], 'pnpm run pipeline:publish');
  assert.equal(packageJson.scripts.verify, 'pnpm run pipeline:verify');
  assert.equal(packageJson.scripts.prepack, 'pnpm run build');
  assert.equal(packageJson.devDependencies['@async/pipeline'], '0.4.3');
  assert.equal(packageJson.devDependencies['@async/api-contract'], '0.1.0');
  assert.equal(packageJson.engines.node, '>=24');
});

test('package file allowlist publishes built JavaScript and declarations without source TypeScript', async () => {
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));

  assert(packageJson.files.includes('dist/**/*.js'));
  assert(packageJson.files.includes('dist/**/*.d.ts'));
  assert(packageJson.files.includes('API_SURFACE.md'));
  assert(packageJson.files.includes('api-contract.json'));
  assert(!packageJson.files.some((pattern) => pattern === 'src/**/*.ts' || pattern.endsWith('*.ts')));
  assert(!packageJson.files.includes('src/**/*.js'));
  assert(!packageJson.files.includes('src/**/*.d.ts'));
});

test('npm dry-run tarball excludes source TypeScript files', async () => {
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      npm_config_cache: path.join(tmpdir(), 'async-db-npm-cache'),
    },
  });
  const jsonStart = stdout.indexOf('[\n');
  const packages = JSON.parse(stdout.slice(jsonStart));
  const files = packages[0].files.map((file) => file.path);

  assert(files.includes('dist/index.js'));
  assert(files.includes('dist/index.d.ts'));
  assert.equal(files.some((file) => file.startsWith('src/')), false);
  assert.equal(files.some((file) => file.endsWith('.ts') && !file.endsWith('.d.ts')), false);
  assert.equal(files.some((file) => file.startsWith('dist/features/config/forks.')), false);
});

test('published declarations do not include migration suppressions', async () => {
  const files = await declarationFiles(path.resolve('dist'));

  assert(files.length > 0);
  for (const file of files) {
    const declarations = await readFile(file, 'utf8');
    assert.doesNotMatch(declarations, /@ts-nocheck/, path.relative(path.resolve('.'), file));
  }
});

test('generated async-pipeline workflow owns release, preview, snapshot, and Pages lifecycle jobs', async () => {
  const workflow = await readFile(path.resolve('.github/workflows/async-pipeline.yml'), 'utf8');
  const lock = JSON.parse(await readFile(path.resolve('.github/async-pipeline.lock.json'), 'utf8'));
  const taskLock = JSON.parse(await readFile(path.resolve('.async-pipeline/tasks.lock.json'), 'utf8'));
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  const releaseConfig = JSON.parse(await readFile(path.resolve('release-please-config.json'), 'utf8'));
  const releaseManifest = JSON.parse(await readFile(path.resolve('.release-please-manifest.json'), 'utf8'));

  assert.match(workflow, /# Generated by async-pipeline\. Do not edit by hand\./);
  assert.match(workflow, /name: Async Pipeline/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release:/);
  assert.match(workflow, /name: pages/);
  assert.match(workflow, /name: pages-deploy/);
  assert.match(workflow, /path: "\.async\/pages"/);
  assert.match(workflow, /name: preview/);
  assert.match(workflow, /name: snapshot/);
  assert.match(workflow, /name: publish-github/);
  assert.match(workflow, /name: publish/);
  assert.match(workflow, /name: release-doctor/);
  assert.match(workflow, /pnpm async-pipeline run verify/);
  assert.match(workflow, /pnpm async-pipeline run preview/);
  assert.match(workflow, /pnpm async-pipeline run snapshot/);
  assert.match(workflow, /pnpm async-pipeline run publish-github/);
  assert.match(workflow, /pnpm async-pipeline run publish/);
  assert.match(workflow, /pnpm async-pipeline run release-doctor/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6\.0\.2/);
  assert.match(workflow, /actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6/);
  assert.match(workflow, /actions\/configure-pages@v5/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  const releaseDoctorJob = workflow.match(/  release-doctor:[\s\S]*?\n\n  snapshot:/)?.[0] ?? '';
  assert.match(releaseDoctorJob, /contents: read/);
  assert.match(releaseDoctorJob, /packages: read/);
  assert.doesNotMatch(releaseDoctorJob, /contents: write/);
  assert.doesNotMatch(releaseDoctorJob, /packages: write/);
  assert.doesNotMatch(releaseDoctorJob, /id-token: write/);
  assert.equal(lock.generator, '@async/pipeline');
  assert(lock.jobs.some((job: { id: string }) => job.id === 'pages'));
  assert(lock.jobs.some((job: { id: string }) => job.id === 'preview'));
  assert(lock.jobs.some((job: { id: string }) => job.id === 'snapshot'));
  assert(lock.jobs.some((job: { id: string }) => job.id === 'publish'));
  assert(lock.jobs.some((job: { id: string }) => job.id === 'release-doctor'));
  assert(taskLock.commands.some((command: { name: string }) => command.name === 'pipeline:release:ensure'));
  assert(taskLock.commands.some((command: { name: string }) => command.name === 'pipeline:task:docs.site'));
  assert.deepEqual(releaseConfig.packages['.'], {
    'release-type': 'node',
    'package-name': '@async/db',
    'changelog-path': 'CHANGELOG.md',
    'include-component-in-tag': false,
  });
  assert.deepEqual(releaseManifest, {
    '.': packageJson.version,
  });
});

test('CI runs Fallow PR review without adding a package dependency', async () => {
  const workflow = await readFile(path.resolve('.github/workflows/fallow.yml'), 'utf8');
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  const expectedWorkflowSnippets = [
    'name: Fallow',
    'pull_request:',
    'Fallow PR review',
    'FALLOW_VERSION: 2.84.0',
    'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6',
    'fetch-depth: 0',
    'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6',
    'github.event.pull_request.base.sha',
    'FALLOW_BASE=HEAD~1',
    'npm exec --yes --package "fallow@${FALLOW_VERSION}" -- fallow audit',
    '--diff-file -',
    '--gate new-only',
    '--no-cache',
    '--fail-on-issues',
  ];

  for (const snippet of expectedWorkflowSnippets) {
    assert(workflow.includes(snippet), snippet);
  }

  for (const dependencyKey of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    assert.equal(Object.hasOwn(packageJson[dependencyKey] ?? {}, 'fallow'), false);
  }
});

test('public GraphQL declarations expose operation names and structured errors', async () => {
  const declarations = await readFile(path.resolve('dist/index.d.ts'), 'utf8');

  assert.match(declarations, /export type GraphqlRequest = \{\s+query: string;\s+variables\?: Record<string, unknown>;\s+operationName\?: string \| null;\s+\};/);
  assert.match(declarations, /export type GraphqlError = \{\s+message: string;\s+extensions\?: \{\s+code\?: string;\s+hint\?: string;\s+details\?: unknown;\s+\};\s+\};/);
  assert.match(declarations, /export type GraphqlResult = \{\s+data: unknown;\s+errors\?: GraphqlError\[\];\s+\};/);
});

test('public declarations expose request tracing options and events', async () => {
  const declarations = await readFile(path.resolve('dist/index.d.ts'), 'utf8');
  const viteDeclarations = await readFile(path.resolve('dist/vite.d.ts'), 'utf8');
  const honoDeclarations = await readFile(path.resolve('dist/hono.d.ts'), 'utf8');

  assert.match(declarations, /export type DbTraceConfig = \{/);
  assert.match(declarations, /export type DbTraceOptions = boolean \| DbTraceConfig;/);
  assert.match(declarations, /export type DbRequestTraceEvent = \{/);
  assert.match(declarations, /type: 'request-trace';/);
  assert.match(declarations, /trace\?: DbTraceOptions;/);
  assert.match(declarations, /export type DbRuntimeEvent = DbResourceChangeEvent \| DbRequestTraceEvent;/);
  assert.match(viteDeclarations, /trace\?: DbTraceOptions;/);
  assert.match(honoDeclarations, /trace\?: DbTraceOptions;/);
});

test('public declarations expose browser cache options', async () => {
  const declarations = await readFile(path.resolve('dist/index.d.ts'), 'utf8');
  const viteDeclarations = await readFile(path.resolve('dist/vite.d.ts'), 'utf8');

  assert.match(declarations, /export type DbCacheReadPolicy = 'cache-first' \| 'cache-and-network' \| 'network-first' \| 'network-only' \| 'cache-only';/);
  assert.match(declarations, /export type DbCacheWritePolicy = 'merge-and-invalidate' \| 'invalidate' \| 'refetch';/);
  assert.match(declarations, /export type DbCacheEventPolicy = 'invalidate' \| 'refetch' \| false;/);
  assert.match(declarations, /cache\?: DbClientCacheOptions;/);
  assert.match(declarations, /export function createIndexedDbCacheStorage/);
  assert.match(viteDeclarations, /clientCache\?: DbViteClientCacheOptions;/);
});

test('public declarations expose stable operation handler API', async () => {
  const declarations = await readFile(path.resolve('dist/index.d.ts'), 'utf8');

  assert.match(declarations, /export type DbOperationRegistryValue = DbOperationTemplate \| DbRegisteredOperation;/);
  assert.match(declarations, /export type DbOperationManifest = \{/);
  assert.match(declarations, /kind: 'db\.operations';/);
  assert.match(declarations, /export type DbOperationRefsManifest = \{/);
  assert.match(declarations, /kind: 'db\.operationRefs';/);
  assert.match(declarations, /export type DbOperationContract = \{/);
  assert.match(declarations, /kind: 'db\.operationContract';/);
  assert.match(declarations, /export type DbRegisteredOperation = DbNormalizedOperationTemplate & \{\s+name: string;\s+ref: string;\s+\};/);
  assert.match(declarations, /export type DbOperationRequestBody = \{\s+variables\?: Record<string, unknown>;\s+contract\?: string;\s+\};/);
  assert.match(declarations, /export type DbOperationExecutionOptions = \{\s+contract\?: string;\s+\};/);
  assert.match(declarations, /strict\?: boolean;/);
  assert.match(declarations, /registry\?: Record<string, DbOperationRegistryValue>;/);
  assert.match(declarations, /execute\(ref: string, variables\?: Record<string, unknown>, options\?: DbOperationExecutionOptions\): Promise<DbOperationResult>;/);
  assert.match(declarations, /executeRequest\(ref: string, body\?: DbOperationRequestBody \| null, options\?: DbOperationExecutionOptions\): Promise<DbOperationResult>;/);
  assert.match(declarations, /manifest: DbOperationManifest;\s+refs: DbOperationRefsManifest;/);
  assert.doesNotMatch(declarations, /execute\(ref: string, variables\?: Record<string, unknown>, options\?: unknown\)/);
  assert.doesNotMatch(declarations, /executeRequest\(ref: string, body\?: .*options\?: unknown\)/);
});

test('public declarations expose doctor usage manifest result', async () => {
  const declarations = await readFile(path.resolve('dist/index.d.ts'), 'utf8');

  assert.match(declarations, /usage\?: boolean \| \{/);
  assert.match(declarations, /export type DbUsageManifest = \{/);
  assert.match(declarations, /kind: 'db\.usageManifest';/);
  assert.match(declarations, /surfaces: Record<DbUsageSurface,/);
  assert.match(declarations, /usage\?: DbUsageManifest;/);
});

test('public declarations keep fork and branch purpose in metadata', async () => {
  const declarations = await readFile(path.resolve('dist/index.d.ts'), 'utf8');

  assert.match(declarations, /export type DbForkCreateOptions = \{\s+from\?: DbForkSource;\s+metadata\?: Record<string, unknown>;\s+\};/);
  assert.match(declarations, /export type DbBranchCreateOptions = \{\s+from\?: string;\s+metadata\?: Record<string, unknown>;\s+\};/);
  assert.doesNotMatch(declarations, /DbForkCreateOptions = \{[\s\S]*?kind\?: string;/);
  assert.doesNotMatch(declarations, /DbBranchCreateOptions = \{[\s\S]*?kind\?: string;/);
});

test('public JSON declarations expose file database helpers', async () => {
  const declarations = await readFile(path.resolve('dist/json.d.ts'), 'utf8');

  assert.match(declarations, /export type JsonStoreCapabilities = \{/);
  assert.match(declarations, /persistence: 'local-file';/);
  assert.match(declarations, /production: 'small-local';/);
  assert.match(declarations, /export const jsonStoreCapabilities: JsonStoreCapabilities;/);
  assert.match(declarations, /export function jsonStatePathForResource\(config: JsonStateConfig, resource: string \| JsonStateResource\): string;/);
  assert.match(declarations, /export function readJsonState<T>\(filePath: string, fallback: T, fs\?: DbFileSystem\): Promise<T>;/);
  assert.match(declarations, /export function writeJsonState\(filePath: string, value: unknown, fs\?: DbFileSystem\): Promise<boolean>;/);
  assert.match(declarations, /export function atomicWriteJson\(filePath: string, value: unknown, fs\?: DbFileSystem\): Promise<boolean>;/);
  assert.match(declarations, /export function withJsonStateWrite<T>\(filePath: string, operation: \(\) => T \| Promise<T>, options\?: JsonStateWriteOptions\): Promise<T>;/);
  assert.match(declarations, /export function restoreJsonStateVersion\(/);
  assert.match(declarations, /export function listJsonStateVersions\(/);
  assert.match(declarations, /export function recoverJsonStateDir\(/);
  assert.match(declarations, /export type JsonStoreEncryptionOptions = \{/);
  assert.match(declarations, /export type JsonStateWriteOptions = \{/);
  assert.match(declarations, /crossProcessLock\?: boolean;/);
  assert.match(declarations, /lockTimeoutMs\?: number;/);
  assert.match(declarations, /lockStaleMs\?: number;/);
});

test('public declarations expose schema loader and validator API', async () => {
  const declarations = await readFile(path.resolve('dist/index.d.ts'), 'utf8');

  assert.match(declarations, /export type DbSchemaValidatorMode = 'create' \| 'replace' \| 'patch';/);
  assert.match(declarations, /export type DbSchemaValidatorUnknownFields = 'error' \| 'strip' \| 'allow' \| 'warn' \| 'ignore';/);
  assert.match(declarations, /export type DbSchemaResolverOptions = \{/);
  assert.match(declarations, /export type DbLoadedSchema = \{/);
  assert.match(declarations, /export type DbFileSystem = \{/);
  assert.match(declarations, /fs\?: DbFileSystem;/);
  assert.match(declarations, /export function createMemoryFs\(options\?: DbMemoryFileSystemOptions \| Record<string, string \| Buffer \| Uint8Array>\): DbFileSystem;/);
  assert.match(declarations, /export type DbDocumentPath = string \| Array<string \| number>;/);
  assert.match(declarations, /set\(path: DbDocumentPath, value: unknown\): Promise<unknown>;/);
  assert.match(declarations, /standardSchema\?: boolean;/);
  assert.match(declarations, /validator<TValue = Record<string, unknown>>\(name: string, options\?: DbSchemaValidatorOptions\): DbSchemaValidator<TValue>;/);
  assert.match(declarations, /resolver<TArgs = Record<string, unknown>, TValue = unknown>\(\s+selector: string,\s+options\?: DbSchemaResolverOptions,\s+\): DbSchemaFieldResolver<TArgs, TValue> \| Record<string, DbSchemaFieldResolver<TArgs, TValue>>;/);
  assert.match(declarations, /export type DbOpenOptions = Omit<DbOptions, 'schema'> & \{/);
  assert.match(declarations, /export function openDb<Types extends DbTypeMap = DbTypeMap>\(options\?: DbOpenOptions \| string\): Promise<Db<Types>>;/);
  assert.match(declarations, /export function loadDbSchema\(options\?: DbOptions \| string\): Promise<DbLoadedSchema>;/);
  assert.match(declarations, /export type DbSchemaMigrationReport = \{/);
  assert.match(declarations, /kind: 'db\.schemaMigrationReport';/);
  assert.match(declarations, /export function inspectSchemaMigration\(options: DbInspectSchemaMigrationOptions\): Promise<DbSchemaMigrationReport>;/);
});

test('public declarations expose standard schema authoring helpers', async () => {
  const declarations = await readFile(path.resolve('dist/index.d.ts'), 'utf8');
  const schemaDeclarations = await readFile(path.resolve('dist/schema.d.ts'), 'utf8');

  assert.match(declarations, /validateAsync\(value: unknown, options\?: DbSchemaValidatorOptions\): Promise<DbSchemaValidationResult<TValue>>;/);
  assert.match(declarations, /assertAsync\(value: unknown, options\?: DbSchemaValidatorOptions\): Promise<TValue>;/);
  assert.match(declarations, /validateAsync<TValue = Record<string, unknown>>\(name: string, value: unknown, options\?: DbSchemaValidatorOptions\): Promise<DbSchemaValidationResult<TValue>>;/);
  assert.match(schemaDeclarations, /export type StandardSchemaV1<Input = unknown, Output = unknown> = \{/);
  assert.match(schemaDeclarations, /export type StandardSchemaMixedResourceDefinition<Input = unknown, Output = unknown> =/);
  assert.match(schemaDeclarations, /validator: StandardSchemaV1<Input, Output>;/);
  assert.match(schemaDeclarations, /export type StandardSchemaLegacyMixedResourceDefinition<Input = unknown, Output = unknown> =/);
  assert.match(schemaDeclarations, /definition: StandardSchemaV1<Input, Output>,\s+options\?: StandardSchemaResourceOptions,/);
  assert.match(schemaDeclarations, /validator: StandardSchemaV1<Input, Output>/);
  assert.match(schemaDeclarations, /definition: StandardSchemaMixedResourceDefinition<Input, Output>,/);
  assert.match(schemaDeclarations, /export type SchemaFieldTag = 'public' \| 'internal' \| 'private' \| string;/);
  assert.match(schemaDeclarations, /export type FieldBuilderDefinition = FieldDefinition & \{\s+tag\(tag: SchemaFieldTag\): FieldBuilderDefinition;\s+\};/);
  assert.match(schemaDeclarations, /string\(options\?: FieldOptions<string>\): FieldBuilderDefinition;/);
  assert.match(schemaDeclarations, /meta\(options\?: FieldMetaOptions\): FieldBuilderDefinition;/);
  assert.match(schemaDeclarations, /export type DerivedFieldDefinition = \{/);
  assert.match(schemaDeclarations, /derived\(definition: FieldDefinition, options: DerivedFieldDefinition\): FieldBuilderDefinition;/);
});

test('public Hono declarations keep resource and operation hook contexts distinct', async () => {
  const declarations = await readFile(path.resolve('dist/hono.d.ts'), 'utf8');

  assert.match(declarations, /export type DbHonoRestHookContext = \{\s+c: unknown;\s+db: unknown;\s+resource: Record<string, unknown>;\s+resourceName: string;\s+method: DbHonoRestMethod;/);
  assert.match(declarations, /export type DbHonoOperationHookContext = \{\s+c: unknown;\s+db: unknown;\s+resource: null;\s+resourceName: null;\s+method: 'operation';\s+ref: string;/);
  assert.match(declarations, /export type DbHonoBeforeRequestHookContext = DbHonoRestHookContext \| DbHonoOperationHookContext;/);
  assert.match(declarations, /beforeRequest\?: DbHonoBeforeRequestHook;/);
  assert.match(declarations, /beforeWrite\?: DbHonoRestHook;/);
});
