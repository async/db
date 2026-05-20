import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { loadConfig } from '../config.js';
import { generateHonoStarter } from './hono.js';
import { makeProject, writeConfig, writeFixture } from '../../test/helpers.js';

const execFileAsync = promisify(execFile);

test('generate hono creates a REST standalone SQLite starter from schema fixtures', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      },
      "profile": {
        "type": "object",
        "fields": {
          "title": { "type": "string" }
        }
      }
    },
    "seed": []
  }`);

  const config = await loadConfig({ cwd });
  const result = await generateHonoStarter(config, {
    outDir: './server',
  });

  const relativeFiles = result.files.map((file) => path.relative(cwd, file)).sort();
  assert.deepEqual(relativeFiles, [
    'server/README.md',
    'server/migrations/0001_initial.sql',
    'server/package.json',
    'server/src/app.ts',
    'server/src/repository.ts',
    'server/src/rest.ts',
    'server/src/schema.ts',
    'server/src/server.ts',
    'server/src/sqlite.ts',
    'server/src/validators.ts',
    'server/tsconfig.json',
  ]);

  assert.match(await readFile(path.join(cwd, 'server/package.json'), 'utf8'), /"hono"/);
  assert.match(await readFile(path.join(cwd, 'server/package.json'), 'utf8'), /">=22\.13"/);
  assert.match(await readFile(path.join(cwd, 'server/src/rest.ts'), 'utf8'), /registerRestRoutes/);
  const sqliteSource = await readFile(path.join(cwd, 'server/src/sqlite.ts'), 'utf8');
  assert.match(sqliteSource, /node:sqlite/);
  assert.match(sqliteSource.slice(
    sqliteSource.indexOf('async create(record)'),
    sqliteSource.indexOf('async patch(id, patch)'),
  ), /const next = applyDefaults\(resourceName, stripUnknownFields/);
  assert.match(sqliteSource.slice(
    sqliteSource.indexOf('async patch(id, patch)'),
    sqliteSource.indexOf('async delete(id)'),
  ), /const next = stripUnknownFields\(resourceName,/);
  assert.doesNotMatch(sqliteSource.slice(
    sqliteSource.indexOf('async patch(id, patch)'),
    sqliteSource.indexOf('async delete(id)'),
  ), /applyDefaults/);
  assert.doesNotMatch(sqliteSource.slice(
    sqliteSource.indexOf('async put(value)'),
    sqliteSource.indexOf('async patch(value)'),
  ), /applyDefaults/);
  assert.match(await readFile(path.join(cwd, 'server/migrations/0001_initial.sql'), 'utf8'), /CREATE TABLE IF NOT EXISTS "users"/);
  assert.match(await readFile(path.join(cwd, 'server/migrations/0001_initial.sql'), 'utf8'), /"id" TEXT PRIMARY KEY/);
  assert.match(await readFile(path.join(cwd, 'server/migrations/0001_initial.sql'), 'utf8'), /"profile" TEXT/);
});

test('generate hono can emit REST plus GraphQL and fixture seeding', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      email: 'ada@example.com',
    },
  ]));
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'dark',
  }));

  const config = await loadConfig({ cwd });
  await generateHonoStarter(config, {
    outDir: './api',
    api: 'rest,graphql',
    seed: 'fixtures',
  });

  assert.match(await readFile(path.join(cwd, 'api/src/graphql.ts'), 'utf8'), /executeGraphql/);
  assert.match(await readFile(path.join(cwd, 'api/src/app.ts'), 'utf8'), /registerRestRoutes/);
  assert.match(await readFile(path.join(cwd, 'api/src/app.ts'), 'utf8'), /registerGraphqlRoutes/);
  assert.match(await readFile(path.join(cwd, 'api/src/sqlite.ts'), 'utf8'), /seedFixtures/);
  assert.match(await readFile(path.join(cwd, 'api/package.json'), 'utf8'), /"jsondb": "\^0\.1\.0"/);
});

test('generate hono can emit SQLite-only module output', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const config = await loadConfig({ cwd });
  const result = await generateHonoStarter(config, {
    outDir: './db-core',
    api: 'none',
    app: 'module',
  });
  const relativeFiles = result.files.map((file) => path.relative(cwd, file)).sort();

  assert.equal(relativeFiles.includes('db-core/src/app.ts'), false);
  assert.equal(relativeFiles.includes('db-core/src/rest.ts'), false);
  assert.equal(relativeFiles.includes('db-core/package.json'), false);
  assert.equal(relativeFiles.includes('db-core/src/sqlite.ts'), true);
  assert.equal(relativeFiles.includes('db-core/src/repository.ts'), true);
});

test('generate hono blocks schema warnings unless explicitly allowed', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      email: 'ada@example.com',
      twitterHandle: '@ada',
    },
  ]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true }
    }
  }`);

  const config = await loadConfig({ cwd });
  await assert.rejects(
    () => generateHonoStarter(config, { outDir: './blocked' }),
    /schema diagnostics are present/,
  );

  const result = await generateHonoStarter(config, {
    outDir: './allowed',
    allowWarnings: true,
  });
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === 'SCHEMA_UNKNOWN_FIELD'), true);
});

test('jsondb generate hono CLI writes generated files', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    generate: {
      hono: {
        outDir: './generated-api',
        api: ['rest'],
        app: 'standalone'
      }
    }
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'generate',
    'hono',
    '--cwd',
    cwd,
  ]);

  assert.match(stdout, /Generated generated-api\/src\/sqlite\.ts/);
  assert.match(await readFile(path.join(cwd, 'generated-api/src/rest.ts'), 'utf8'), /registerRestRoutes/);
});
