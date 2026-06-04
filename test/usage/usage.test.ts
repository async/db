import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { scanDbUsage as typedScanDbUsage } from '../../src/features/usage/scanner.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

const scanDbUsage = async (options: unknown): Promise<any> => typedScanDbUsage(options as never) as Promise<any>;

test('usage scanner scans one file and recommends least-exposed operation config', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await writeFile(path.join(cwd, 'src/app.ts'), `
import { createDbClient } from '@async/db/client';
import { operationRefs } from './generated/db.operation-refs.js';

const db = createDbClient({ apiBase: '/api/db' });
await db.query(operationRefs.operations.GetUser.ref, { id: 'u_1' });
`, 'utf8');

  const manifest = await scanDbUsage({
    cwd,
    target: './src/app.ts',
    generatedAt: '2026-06-03T00:00:00.000Z',
    production: true,
  });

  assert.equal(manifest.kind, 'db.usageManifest');
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.target, {
    path: 'src/app.ts',
    kind: 'file',
  });
  assert.equal(manifest.summary.filesScanned, 1);
  assert.equal(manifest.surfaces.operations.count, 1);
  assert.equal(manifest.surfaces.rest.count, 0);
  assert.equal(manifest.files[0].path, 'src/app.ts');
  assert.equal(manifest.files[0].matches[0].surface, 'client');
  assert.equal(
    manifest.recommendations.some((recommendation) => recommendation.code === 'USAGE_RECOMMEND_REST_REGISTERED_ONLY'),
    true,
  );
  assert.equal(
    manifest.recommendations.some((recommendation) => recommendation.code === 'USAGE_RECOMMEND_GRAPHQL_DISABLED'),
    true,
  );
  assert.equal(
    manifest.recommendations.some((recommendation) => recommendation.code === 'USAGE_RECOMMEND_FALCOR_DISABLED'),
    true,
  );
  assert.equal(
    manifest.recommendations.some((recommendation) => recommendation.code === 'USAGE_RECOMMEND_DEV_SURFACES_PRIVATE'),
    true,
  );
});

test('usage scanner scans folders and ignores generated output folders', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await mkdir(path.join(cwd, 'dist'), { recursive: true });
  await mkdir(path.join(cwd, '.db/state'), { recursive: true });
  await writeFile(path.join(cwd, 'src/server.ts'), `
import { registerDbRoutes } from '@async/db/hono';
import { dbPlugin } from '@async/db/vite';

registerDbRoutes(app, db, { prefix: '/api/db', operations: true });
dbPlugin({ graphqlPath: '/graphql', falcorPath: '/model.json' });
await db.graphql('{ users { id } }');
await fetch('/model.json');
`, 'utf8');
  await writeFile(path.join(cwd, 'dist/ignored.js'), `
await fetch('/db/users.json');
`, 'utf8');
  await writeFile(path.join(cwd, '.db/state/ignored.json'), `
"/graphql"
`, 'utf8');

  const manifest = await scanDbUsage({
    cwd,
    target: './src',
    generatedAt: '2026-06-03T00:00:00.000Z',
    production: true,
  });

  assert.deepEqual(manifest.files.map((file) => file.path), ['src/server.ts']);
  assert.equal(manifest.surfaces.hono.count, 2);
  assert.equal(manifest.surfaces.vite.count, 2);
  assert.equal(manifest.surfaces.graphql.count > 0, true);
  assert.equal(manifest.surfaces.falcor.count > 0, true);
  assert.equal(
    manifest.recommendations.some((recommendation) => recommendation.code === 'USAGE_RECOMMEND_GRAPHQL_DISABLED'),
    false,
  );
  assert.equal(
    manifest.recommendations.some((recommendation) => recommendation.code === 'USAGE_RECOMMEND_FALCOR_DISABLED'),
    false,
  );
});

test('usage scanner defaults to the full project and detects config toggles', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeConfig(cwd, `export default {
    rest: {
      enabled: false,
    },
    graphql: {
      enabled: false,
    },
    falcor: {
      enabled: false,
    },
    server: {
      dataPath: '/api/db',
      expose: {
        manifest: 'dev',
      },
    },
    operations: {
      enabled: true,
      strict: true,
    },
  };`);

  const manifest = await scanDbUsage({
    cwd,
    generatedAt: '2026-06-03T00:00:00.000Z',
  });

  assert.equal(manifest.target.path, '.');
  assert.equal(manifest.target.kind, 'directory');
  assert.equal(manifest.files.some((file) => file.path === 'db.config.mjs'), true);
  assert.equal(manifest.surfaces.config.count >= 6, true);
  assert.equal(manifest.summary.matches >= 6, true);
});
