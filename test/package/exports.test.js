import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { makeProject } from '../helpers.js';

const execFileAsync = promisify(execFile);

test('consumer projects can import package APIs through the @async/db package', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'check-package.mjs'), `import { createDbOperationHandler, createDbRequestHandler, createIndexedDbCacheStorage, loadDbSchema, openDb } from '@async/db';
import { createDbClient, createIndexedDbCacheStorage as createClientIndexedDbCacheStorage } from '@async/db/client';
import { defineConfig } from '@async/db/config';
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
if (typeof sqliteStore !== 'function') throw new Error('missing sqlite store API');
if (typeof postgresStore !== 'function') throw new Error('missing postgres store API');
if (typeof kvStore !== 'function') throw new Error('missing kv store API');
if (typeof redisStore !== 'function') throw new Error('missing redis store API');
`);

  await execFileAsync(process.execPath, ['check-package.mjs'], { cwd });
});

test('package metadata exposes @async/db with the async-db CLI', async () => {
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));

  assert.equal(packageJson.name, '@async/db');
  assert.deepEqual(packageJson.bin, {
    'async-db': './src/cli.js',
  });
});

test('public GraphQL declarations expose operation names and structured errors', async () => {
  const declarations = await readFile(path.resolve('src/index.d.ts'), 'utf8');

  assert.match(declarations, /export type GraphqlRequest = \{\s+query: string;\s+variables\?: Record<string, unknown>;\s+operationName\?: string \| null;\s+\};/);
  assert.match(declarations, /export type GraphqlError = \{\s+message: string;\s+extensions\?: \{\s+code\?: string;\s+hint\?: string;\s+details\?: unknown;\s+\};\s+\};/);
  assert.match(declarations, /export type GraphqlResult = \{\s+data: unknown;\s+errors\?: GraphqlError\[\];\s+\};/);
});

test('public declarations expose request tracing options and events', async () => {
  const declarations = await readFile(path.resolve('src/index.d.ts'), 'utf8');
  const viteDeclarations = await readFile(path.resolve('src/vite.d.ts'), 'utf8');
  const honoDeclarations = await readFile(path.resolve('src/hono.d.ts'), 'utf8');

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
  const declarations = await readFile(path.resolve('src/index.d.ts'), 'utf8');
  const viteDeclarations = await readFile(path.resolve('src/vite.d.ts'), 'utf8');

  assert.match(declarations, /export type DbCacheReadPolicy = 'cache-first' \| 'cache-and-network' \| 'network-first' \| 'network-only' \| 'cache-only';/);
  assert.match(declarations, /export type DbCacheWritePolicy = 'merge-and-invalidate' \| 'invalidate' \| 'refetch';/);
  assert.match(declarations, /export type DbCacheEventPolicy = 'invalidate' \| 'refetch' \| false;/);
  assert.match(declarations, /cache\?: DbClientCacheOptions;/);
  assert.match(declarations, /export function createIndexedDbCacheStorage/);
  assert.match(viteDeclarations, /clientCache\?: DbViteClientCacheOptions;/);
});

test('public declarations expose stable operation handler API', async () => {
  const declarations = await readFile(path.resolve('src/index.d.ts'), 'utf8');

  assert.match(declarations, /export type DbOperationRegistryValue = DbOperationTemplate \| DbRegisteredOperation;/);
  assert.match(declarations, /export type DbOperationRequestBody = \{\s+variables\?: Record<string, unknown>;\s+\};/);
  assert.match(declarations, /registry\?: Record<string, DbOperationRegistryValue>;/);
  assert.match(declarations, /execute\(ref: string, variables\?: Record<string, unknown>\): Promise<DbOperationResult>;/);
  assert.match(declarations, /executeRequest\(ref: string, body\?: DbOperationRequestBody \| null\): Promise<DbOperationResult>;/);
  assert.doesNotMatch(declarations, /execute\(ref: string, variables\?: Record<string, unknown>, options\?: unknown\)/);
  assert.doesNotMatch(declarations, /executeRequest\(ref: string, body\?: .*options\?: unknown\)/);
});

test('public declarations expose schema loader and validator API', async () => {
  const declarations = await readFile(path.resolve('src/index.d.ts'), 'utf8');

  assert.match(declarations, /export type DbSchemaValidatorMode = 'create' \| 'replace' \| 'patch';/);
  assert.match(declarations, /export type DbSchemaValidatorUnknownFields = 'error' \| 'strip' \| 'allow' \| 'warn' \| 'ignore';/);
  assert.match(declarations, /export type DbSchemaResolverOptions = \{/);
  assert.match(declarations, /export type DbLoadedSchema = \{/);
  assert.match(declarations, /validator<TValue = Record<string, unknown>>\(name: string, options\?: DbSchemaValidatorOptions\): DbSchemaValidator<TValue>;/);
  assert.match(declarations, /resolver<TArgs = Record<string, unknown>, TValue = unknown>\(\s+selector: string,\s+options\?: DbSchemaResolverOptions,\s+\): DbSchemaFieldResolver<TArgs, TValue> \| Record<string, DbSchemaFieldResolver<TArgs, TValue>>;/);
  assert.match(declarations, /export type DbOpenOptions = Omit<DbOptions, 'schema'> & \{/);
  assert.match(declarations, /export function openDb<Types extends DbTypeMap = DbTypeMap>\(options\?: DbOpenOptions \| string\): Promise<Db<Types>>;/);
  assert.match(declarations, /export function loadDbSchema\(options\?: DbOptions \| string\): Promise<DbLoadedSchema>;/);
});

test('public Hono declarations keep resource and operation hook contexts distinct', async () => {
  const declarations = await readFile(path.resolve('src/hono.d.ts'), 'utf8');

  assert.match(declarations, /export type DbHonoRestHookContext = \{\s+c: unknown;\s+db: unknown;\s+resource: Record<string, unknown>;\s+resourceName: string;\s+method: DbHonoRestMethod;/);
  assert.match(declarations, /export type DbHonoOperationHookContext = \{\s+c: unknown;\s+db: unknown;\s+resource: null;\s+resourceName: null;\s+method: 'operation';\s+ref: string;/);
  assert.match(declarations, /export type DbHonoBeforeRequestHookContext = DbHonoRestHookContext \| DbHonoOperationHookContext;/);
  assert.match(declarations, /beforeRequest\?: DbHonoBeforeRequestHook;/);
  assert.match(declarations, /beforeWrite\?: DbHonoRestHook;/);
});
