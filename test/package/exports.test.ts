import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
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
  await writeFile(path.join(cwd, 'check-package.mjs'), `import { createDbOperationHandler, createDbRequestHandler, createIndexedDbCacheStorage, loadDbSchema, openDb } from '@async/db';
import { createDbClient, createIndexedDbCacheStorage as createClientIndexedDbCacheStorage } from '@async/db/client';
import { defineConfig } from '@async/db/config';
import { jsonStoreCapabilities, readJsonState, writeJsonState } from '@async/db/json';
import { sqliteStore } from '@async/db/sqlite';
import { postgresStore } from '@async/db/postgres';
import { kvStore } from '@async/db/kv';
import { redisStore } from '@async/db/redis';

if (typeof openDb !== 'function') throw new Error('missing package API');
if (typeof loadDbSchema !== 'function') throw new Error('missing schema API');
if (typeof createDbOperationHandler !== 'function') throw new Error('missing operation handler API');
if (typeof createDbRequestHandler !== 'function') throw new Error('missing request handler API');
if (typeof createDbClient !== 'function') throw new Error('missing client API');
if (typeof createIndexedDbCacheStorage !== 'function') throw new Error('missing indexeddb cache API');
if (typeof createClientIndexedDbCacheStorage !== 'function') throw new Error('missing client indexeddb cache API');
if (typeof defineConfig !== 'function') throw new Error('missing config API');
if (jsonStoreCapabilities.persistence !== 'local-file') throw new Error('missing json store capabilities');
if (typeof readJsonState !== 'function') throw new Error('missing json read helper');
if (typeof writeJsonState !== 'function') throw new Error('missing json write helper');
if (typeof sqliteStore !== 'function') throw new Error('missing sqlite store API');
if (typeof postgresStore !== 'function') throw new Error('missing postgres store API');
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
  createIndexedDbCacheStorage,
  loadDbSchema,
  openDb,
  type Db,
  type DbOptions,
} from '@async/db';
import { createDbClient, type DbClient } from '@async/db/client';
import { defineConfig, type DbConfig } from '@async/db/config';
import {
  atomicWriteJson,
  jsonStatePathForResource,
  jsonStoreCapabilities,
  readJsonState,
  withJsonStateWrite,
  writeJsonState,
  type JsonStoreCapabilities,
} from '@async/db/json';
import { kvStore } from '@async/db/kv';
import { postgresStore } from '@async/db/postgres';
import { redisStore } from '@async/db/redis';
import { collection, field, files, type ResourceDefinition } from '@async/db/schema';
import { sqliteStore } from '@async/db/sqlite';
import type { DbTypes, User } from './generated/db.types.d.ts';

const config = defineConfig({
  cwd: '.',
  outputs: {
    types: './.db/types/index.d.ts',
    committedTypes: './src/generated/db.types.d.ts',
  },
}) satisfies DbConfig;

const options: DbOptions = config;
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

const dbPromise: Promise<Db<DbTypes>> = openDb<DbTypes>(options);
void dbPromise.then(async (db) => {
  const users = await db.collection('users').all();
  const first: User | undefined = users[0];
  const settings = await db.document('settings').get();
  const requestHandler = createDbRequestHandler(db);
  const operationHandler = createDbOperationHandler(db);
  await db.close();
  void requestHandler;
  void operationHandler;
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
void jsonCapabilities;
void sqliteStore({ file: ':memory:' });
void postgresStore({ client: { query: async () => ({ rows: [] }) } });
void kvStore({ client: { get: async () => null, set: async () => undefined } });
void redisStore({ client: { get: async () => null, set: async () => undefined } });
void usersSchema;
void contentSchema;
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
  assert.deepEqual(packageJson.publishConfig, {
    access: 'public',
  });
  assert.equal(packageJson.scripts['release:check'], 'npm run check && npm test && npm pack --dry-run');
  assert.equal(packageJson.scripts['release:pack'], 'npm pack');
  assert.equal(packageJson.scripts['release:publish'], 'npm publish --access public');
  assert.equal(packageJson.scripts.prepack, 'npm run build');
});

test('package file allowlist publishes built JavaScript and declarations without source TypeScript', async () => {
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));

  assert(packageJson.files.includes('dist/**/*.js'));
  assert(packageJson.files.includes('dist/**/*.d.ts'));
  assert(!packageJson.files.some((pattern) => pattern === 'src/**/*.ts' || pattern.endsWith('*.ts')));
  assert(!packageJson.files.includes('src/**/*.js'));
  assert(!packageJson.files.includes('src/**/*.d.ts'));
});

test('npm dry-run tarball excludes source TypeScript files', async () => {
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], {
    cwd: path.resolve('.'),
  });
  const jsonStart = stdout.indexOf('[\n');
  const packages = JSON.parse(stdout.slice(jsonStart));
  const files = packages[0].files.map((file) => file.path);

  assert(files.includes('dist/index.js'));
  assert(files.includes('dist/index.d.ts'));
  assert.equal(files.some((file) => file.startsWith('src/')), false);
  assert.equal(files.some((file) => file.endsWith('.ts') && !file.endsWith('.d.ts')), false);
});

test('published declarations do not include migration suppressions', async () => {
  const files = await declarationFiles(path.resolve('dist'));

  assert(files.length > 0);
  for (const file of files) {
    const declarations = await readFile(file, 'utf8');
    assert.doesNotMatch(declarations, /@ts-nocheck/, path.relative(path.resolve('.'), file));
  }
});

test('release automation creates release PRs and publishes npm from pinned actions', async () => {
  const workflow = await readFile(path.resolve('.github/workflows/release.yml'), 'utf8');
  const releaseConfig = JSON.parse(await readFile(path.resolve('release-please-config.json'), 'utf8'));
  const releaseManifest = JSON.parse(await readFile(path.resolve('.release-please-manifest.json'), 'utf8'));

  assert.match(workflow, /name: Release/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /tags:\n\s+- "v\*\.\*\.\*"/);
  assert.match(workflow, /googleapis\/release-please-action@[0-9a-f]{40} # v4\.[0-9]+\.[0-9]+/);
  assert.match(workflow, /config-file: release-please-config\.json/);
  assert.match(workflow, /manifest-file: \.release-please-manifest\.json/);
  assert.match(workflow, /Publish existing tag/);
  assert.match(workflow, /Validate package version matches tag/);
  assert.match(workflow, /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6\.0\.2/);
  assert.match(workflow, /actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /npm publish --access public/);
  assert.match(workflow, /npm run release:check/);
  assert.deepEqual(releaseConfig.packages['.'], {
    'release-type': 'node',
    'package-name': '@async/db',
    'changelog-path': 'CHANGELOG.md',
    'include-component-in-tag': false,
  });
  assert.deepEqual(releaseManifest, {
    '.': '0.1.0',
  });
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
  assert.match(declarations, /export type DbOperationRequestBody = \{\s+variables\?: Record<string, unknown>;\s+\};/);
  assert.match(declarations, /registry\?: Record<string, DbOperationRegistryValue>;/);
  assert.match(declarations, /execute\(ref: string, variables\?: Record<string, unknown>\): Promise<DbOperationResult>;/);
  assert.match(declarations, /executeRequest\(ref: string, body\?: DbOperationRequestBody \| null\): Promise<DbOperationResult>;/);
  assert.doesNotMatch(declarations, /execute\(ref: string, variables\?: Record<string, unknown>, options\?: unknown\)/);
  assert.doesNotMatch(declarations, /executeRequest\(ref: string, body\?: .*options\?: unknown\)/);
});

test('public JSON declarations expose file database helpers', async () => {
  const declarations = await readFile(path.resolve('dist/json.d.ts'), 'utf8');

  assert.match(declarations, /export type JsonStoreCapabilities = \{/);
  assert.match(declarations, /persistence: 'local-file';/);
  assert.match(declarations, /production: 'small-local';/);
  assert.match(declarations, /export const jsonStoreCapabilities: JsonStoreCapabilities;/);
  assert.match(declarations, /export function jsonStatePathForResource\(config: JsonStateConfig, resource: string \| JsonStateResource\): string;/);
  assert.match(declarations, /export function readJsonState<T>\(filePath: string, fallback: T\): Promise<T>;/);
  assert.match(declarations, /export function writeJsonState\(filePath: string, value: unknown\): Promise<boolean>;/);
  assert.match(declarations, /export function atomicWriteJson\(filePath: string, value: unknown\): Promise<boolean>;/);
  assert.match(declarations, /export function withJsonStateWrite<T>\(filePath: string, operation: \(\) => T \| Promise<T>\): Promise<T>;/);
});

test('public declarations expose schema loader and validator API', async () => {
  const declarations = await readFile(path.resolve('dist/index.d.ts'), 'utf8');

  assert.match(declarations, /export type DbSchemaValidatorMode = 'create' \| 'replace' \| 'patch';/);
  assert.match(declarations, /export type DbSchemaValidatorUnknownFields = 'error' \| 'strip' \| 'allow' \| 'warn' \| 'ignore';/);
  assert.match(declarations, /export type DbSchemaResolverOptions = \{/);
  assert.match(declarations, /export type DbLoadedSchema = \{/);
  assert.match(declarations, /standardSchema\?: boolean;/);
  assert.match(declarations, /validator<TValue = Record<string, unknown>>\(name: string, options\?: DbSchemaValidatorOptions\): DbSchemaValidator<TValue>;/);
  assert.match(declarations, /resolver<TArgs = Record<string, unknown>, TValue = unknown>\(\s+selector: string,\s+options\?: DbSchemaResolverOptions,\s+\): DbSchemaFieldResolver<TArgs, TValue> \| Record<string, DbSchemaFieldResolver<TArgs, TValue>>;/);
  assert.match(declarations, /export type DbOpenOptions = Omit<DbOptions, 'schema'> & \{/);
  assert.match(declarations, /export function openDb<Types extends DbTypeMap = DbTypeMap>\(options\?: DbOpenOptions \| string\): Promise<Db<Types>>;/);
  assert.match(declarations, /export function loadDbSchema\(options\?: DbOptions \| string\): Promise<DbLoadedSchema>;/);
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
  assert.match(schemaDeclarations, /meta\(options\?: FieldMetaOptions\): FieldDefinition;/);
});

test('public Hono declarations keep resource and operation hook contexts distinct', async () => {
  const declarations = await readFile(path.resolve('dist/hono.d.ts'), 'utf8');

  assert.match(declarations, /export type DbHonoRestHookContext = \{\s+c: unknown;\s+db: unknown;\s+resource: Record<string, unknown>;\s+resourceName: string;\s+method: DbHonoRestMethod;/);
  assert.match(declarations, /export type DbHonoOperationHookContext = \{\s+c: unknown;\s+db: unknown;\s+resource: null;\s+resourceName: null;\s+method: 'operation';\s+ref: string;/);
  assert.match(declarations, /export type DbHonoBeforeRequestHookContext = DbHonoRestHookContext \| DbHonoOperationHookContext;/);
  assert.match(declarations, /beforeRequest\?: DbHonoBeforeRequestHook;/);
  assert.match(declarations, /beforeWrite\?: DbHonoRestHook;/);
});
