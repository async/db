import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import path from 'node:path';
import { promisify } from 'node:util';
import { renderRecordDetailPage } from '../../examples/schema-ui/src/cms-ssr.mjs';
import { launchExampleHttpStack } from '../../scripts/example-launcher.js';
import { findExamples, renderExamplesIndex } from '../../scripts/serve-examples.js';
import { loadConfig, openJsonFixtureDb, syncJsonFixtureDb } from '../../src/index.js';

const execFileAsync = promisify(execFile);

test('examples launcher can discover repo examples and render an index page', async () => {
  const examples = await findExamples(path.resolve('examples'));
  const names = examples.map((example) => example.name);

  assert.deepEqual(names, [
    'advanced',
    'basic',
    'csv',
    'data-first',
    'diagnostics',
    'hono-auth',
    'relations',
    'rest-client',
    'schema-first',
    'schema-manifest',
    'schema-ui',
  ]);
  assert.equal(examples.find((example) => example.name === 'relations').title, 'Relations');
  assert.deepEqual(examples.find((example) => example.name === 'rest-client').tags, ['client', 'rest', 'batching']);

  const html = renderExamplesIndex(examples.map((example, index) => ({
    ...example,
    port: 7330 + index,
    url: `http://127.0.0.1:${7330 + index}`,
    viewerUrl: `http://127.0.0.1:${7330 + index}/__jsondb`,
    demoUrl: undefined,
    demoLinks: [],
    starterKind: 'jsondb',
  })));

  assert.match(html, /jsondb examples/);
  assert.match(html, /serve-example\.mjs/);
  assert.match(html, /Open viewer/);
  assert.match(html, /advanced/);
  assert.match(html, /csv/);
  assert.match(html, /diagnostics/);
  assert.match(html, /Hono Auth/);
  assert.match(html, /REST Client/);
  assert.match(html, /client/);
  assert.match(html, /relations/);
  assert.match(html, /schema-first/);
  assert.match(html, /Schema Manifest/);
  assert.match(html, /Schema UI/);

  const schemaUiHook = await readFile(path.resolve('examples/schema-ui/serve-example.mjs'), 'utf8');
  assert.match(schemaUiHook, /startExampleServer/);
});

test('example launcher resolves schema-ui serve-example hook', async () => {
  const cwd = path.resolve('examples/schema-ui');
  const launched = await launchExampleHttpStack({
    cwd,
    host: '127.0.0.1',
    port: 0,
    repoRoot: path.resolve('.'),
  });

  assert.equal(launched.starterKind, 'custom');
  assert.ok(launched.demoUrl);
  assert.match(launched.demoUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/u);

  const address = launched.server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;

  const templates = await fetch(`http://127.0.0.1:${port}/templates`);
  assert.equal(templates.status, 200);

  const viewer = await fetch(`http://127.0.0.1:${port}/__jsondb`);
  assert.ok(viewer.ok);

  await new Promise((resolve, reject) => {
    launched.server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(undefined);
    });
  });
});

test('new onboarding examples sync expected resources', async () => {
  const expected = {
    'hono-auth': ['pages', 'users'],
    'rest-client': ['settings', 'users'],
    relations: ['posts', 'users'],
    'schema-manifest': ['projects', 'users'],
    'schema-ui': ['pages', 'users'],
  };

  for (const [name, resources] of Object.entries(expected)) {
    const cwd = await copyExampleProject(name);
    const result = await syncJsonFixtureDb(await loadConfig({ cwd }));

    assert.deepEqual(Object.keys(result.schema.resources), resources, `${name} resources`);
  }

  const manifestCwd = await copyExampleProject('schema-manifest');
  await syncJsonFixtureDb(await loadConfig({ cwd: manifestCwd }));
  const manifest = JSON.parse(await readFile(path.join(manifestCwd, 'src/generated/jsondb.schema.json'), 'utf8'));
  assert.equal(manifest.collections.projects.fields.status.ui.component, 'segmented-control');
  assert.equal(manifest.collections.users.fields.bio.ui.component, 'markdown');

  const schemaUiCwd = await copyExampleProject('schema-ui');
  await syncJsonFixtureDb(await loadConfig({ cwd: schemaUiCwd }));
  const schemaUiManifest = JSON.parse(await readFile(path.join(schemaUiCwd, 'src/generated/jsondb.schema.json'), 'utf8'));
  assert.equal(schemaUiManifest.collections.pages.editor.title, 'Pages');
  assert.equal(schemaUiManifest.collections.pages.fields.status.ui.component, 'segmented-control');
  assert.equal(schemaUiManifest.collections.pages.fields.bodyMarkdown.ui.component, 'markdown');

  const { stdout } = await execFileAsync(process.execPath, ['src/render-admin.mjs'], { cwd: schemaUiCwd });
  assert.match(stdout, /<h1>Schema UI Example<\/h1>/);
  assert.match(stdout, /data-mode="view" data-component="markdown" data-field="bodyMarkdown"/);
  assert.match(stdout, /data-mode="editor" data-component="relationSelect" data-field="authorId"/);

  const schemaUiDb = await openJsonFixtureDb({ cwd: schemaUiCwd, syncOnOpen: false });
  await schemaUiDb.runtime.hydrate();
  const schemaUiPages = await schemaUiDb.collection('pages').all();
  const schemaUiUsers = await schemaUiDb.collection('users').all();
  const homePage = schemaUiPages.find((row) => row.id === 'page_home');
  assert.ok(homePage);
  const ssrHtml = renderRecordDetailPage(schemaUiManifest, 'pages', homePage, {
    pages: schemaUiPages,
    users: schemaUiUsers,
  });
  assert.match(ssrHtml, /Ada Lovelace/);
  assert.match(ssrHtml, /# Welcome/);
});

test('hono auth example shows lifecycle hook integration code', async () => {
  const source = await readFile(path.resolve('examples/hono-auth/src/app.mjs'), 'utf8');

  assert.match(source, /registerRestRoutes/);
  assert.match(source, /lifecycleHooks/);
  assert.match(source, /beforeRequest/);
  assert.match(source, /beforeWrite/);
  assert.match(source, /Bearer admin-token/);
  assert.match(source, /Bearer user-token/);
});

async function copyExampleProject(name) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'jsondb-example-test-'));
  const cwd = path.join(tempRoot, name);
  await cp(path.resolve('examples', name), cwd, {
    recursive: true,
    filter(source) {
      return !source.split(path.sep).includes('.jsondb');
    },
  });
  await mkdir(path.join(cwd, 'node_modules'), { recursive: true });
  await symlink(path.resolve('.'), path.join(cwd, 'node_modules', 'jsondb'), 'dir');
  return cwd;
}
