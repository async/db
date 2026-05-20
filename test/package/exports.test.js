import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { openJsonFixtureDb } from '../../src/index.js';
import { makeProject } from '../helpers.js';

const execFileAsync = promisify(execFile);

test('consumer projects can import package APIs through the jsondb alias', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'check-alias.mjs'), `import { createJsonDbRequestHandler, openJsonFixtureDb } from 'jsondb';
import { createJsonDbClient } from 'jsondb/client';
import { defineConfig } from 'jsondb/config';
import { sqliteStore } from 'jsondb/sqlite';

if (typeof openJsonFixtureDb !== 'function') throw new Error('missing package API');
if (typeof createJsonDbRequestHandler !== 'function') throw new Error('missing request handler API');
if (typeof createJsonDbClient !== 'function') throw new Error('missing client API');
if (typeof defineConfig !== 'function') throw new Error('missing config API');
if (typeof sqliteStore !== 'function') throw new Error('missing sqlite store API');
`);

  await execFileAsync(process.execPath, ['check-alias.mjs'], { cwd });
});
