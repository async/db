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
  await writeFile(path.join(cwd, 'check-package.mjs'), `import { createDbRequestHandler, openDb } from '@async/db';
import { createDbClient } from '@async/db/client';
import { defineConfig } from '@async/db/config';
import { sqliteStore } from '@async/db/sqlite';

if (typeof openDb !== 'function') throw new Error('missing package API');
if (typeof createDbRequestHandler !== 'function') throw new Error('missing request handler API');
if (typeof createDbClient !== 'function') throw new Error('missing client API');
if (typeof defineConfig !== 'function') throw new Error('missing config API');
if (typeof sqliteStore !== 'function') throw new Error('missing sqlite store API');
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
