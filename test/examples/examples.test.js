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
import { executeGraphql } from '../../src/graphql/execute.js';
import { loadConfig, openDb, syncDb } from '../../src/index.js';
import { handleRestRequest } from '../../src/rest/handler.js';

const execFileAsync = promisify(execFile);

test('examples launcher can discover repo examples and render an index page', async () => {
  const examples = await findExamples(path.resolve('examples'));
  const names = examples.map((example) => example.name);

  assert.deepEqual(names, [
    'advanced',
    'basic',
    'computed-fields',
    'content-collections',
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
    viewerUrl: `http://127.0.0.1:${7330 + index}/__db`,
    demoUrl: undefined,
    demoLinks: [],
    starterKind: 'db',
  })));

  assert.match(html, /db examples/);
  assert.match(html, /serve-example\.mjs/);
  assert.match(html, /Open viewer/);
  assert.match(html, /advanced/);
  assert.match(html, /Content Collections/);
  assert.match(html, /Computed Fields/);
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

  const viewer = await fetch(`http://127.0.0.1:${port}/__db`);
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
    'content-collections': ['authors', 'blog', 'docs', 'site'],
    'computed-fields': ['orders', 'posts', 'products', 'users'],
    'rest-client': ['settings', 'users'],
    relations: ['posts', 'users'],
    'schema-manifest': ['projects', 'users'],
    'schema-ui': ['pages', 'users'],
  };

  for (const [name, resources] of Object.entries(expected)) {
    const cwd = await copyExampleProject(name);
    const result = await syncDb(await loadConfig({ cwd }));

    assert.deepEqual(Object.keys(result.schema.resources), resources, `${name} resources`);
  }

  const manifestCwd = await copyExampleProject('schema-manifest');
  await syncDb(await loadConfig({ cwd: manifestCwd }));
  const manifest = JSON.parse(await readFile(path.join(manifestCwd, 'src/generated/db.schema.json'), 'utf8'));
  assert.equal(manifest.collections.projects.fields.status.ui.component, 'segmented-control');
  assert.equal(manifest.collections.users.fields.bio.ui.component, 'markdown');

  const schemaUiCwd = await copyExampleProject('schema-ui');
  await syncDb(await loadConfig({ cwd: schemaUiCwd }));
  const schemaUiManifest = JSON.parse(await readFile(path.join(schemaUiCwd, 'src/generated/db.schema.json'), 'utf8'));
  assert.equal(schemaUiManifest.collections.pages.editor.title, 'Pages');
  assert.equal(schemaUiManifest.collections.pages.fields.status.ui.component, 'segmented-control');
  assert.equal(schemaUiManifest.collections.pages.fields.bodyMarkdown.ui.component, 'markdown');

  const { stdout } = await execFileAsync(process.execPath, ['src/render-admin.mjs'], { cwd: schemaUiCwd });
  assert.match(stdout, /<h1>Schema UI Example<\/h1>/);
  assert.match(stdout, /data-mode="view" data-component="markdown" data-field="bodyMarkdown"/);
  assert.match(stdout, /data-mode="editor" data-component="relationSelect" data-field="authorId"/);

  const schemaUiDb = await openDb({ cwd: schemaUiCwd, syncOnOpen: false });
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

  const contentCwd = await copyExampleProject('content-collections');
  await syncDb(await loadConfig({ cwd: contentCwd }));
  const generatedTypes = await readFile(path.join(contentCwd, 'src/generated/db.types.ts'), 'utf8');
  const contentDb = await openDb({ cwd: contentCwd, syncOnOpen: false });
  await contentDb.runtime.hydrate();

  const docs = await contentDb.collection('docs').all();
  const blog = await contentDb.collection('blog').all();
  assert.equal(docs.find((record) => record.id === 'intro')?.title, 'Intro To Local Content');
  assert.match(docs.find((record) => record.id === 'intro')?.body ?? '', /<Callout tone="info">/);
  assert.equal(blog.find((record) => record.id === 'launch-notes')?.authorId, 'author_ada');
  assert.match(blog.find((record) => record.id === 'launch-notes')?.body ?? '', /## Why local content/);
  assert.match(generatedTypes, /export type Blog =/);
  await assert.rejects(
    () => contentDb.collection('docs').create({ id: 'draft', title: 'Draft', body: 'Draft' }),
    (error) => error.code === 'STORE_RESOURCE_READ_ONLY',
  );

  const defaultRest = makeResponse();
  await handleRestRequest(
    contentDb,
    makeRequest('GET'),
    defaultRest,
    new URL('http://db.local/blog'),
  );
  assert.equal(defaultRest.json().some((record) => 'permalink' in record), false);

  const graphql = await executeGraphql(contentDb, {
    query: `{
      blog {
        id
        permalink
        readingTimeMinutes
      }
    }`,
  });
  const launchNotes = graphql.data.blog.find((record) => record.id === 'launch-notes');
  assert.equal(launchNotes.permalink, '/blog/launch-notes');
  assert.equal(launchNotes.readingTimeMinutes, 1);

  const preview = await execFileAsync(process.execPath, ['src/content-preview.mjs'], { cwd: contentCwd });
  assert.match(preview.stdout, /<article data-kind="blog" data-id="launch-notes" data-href="\/blog\/launch-notes">/);
  assert.match(preview.stdout, /Intro To Local Content/);

  const bundled = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'bundle',
    '--all',
    '--cwd',
    contentCwd,
  ]);
  const rootSchema = await readFile(path.join(contentCwd, 'db.schema.mjs'), 'utf8');
  const siteSeed = JSON.parse(await readFile(path.join(contentCwd, 'db/site.json'), 'utf8'));

  assert.match(bundled.stdout, /Generated db\/site\.json/);
  assert.match(bundled.stdout, /Generated db\.schema\.mjs/);
  assert.match(bundled.stderr, /SCHEMA_BUNDLE_SEED_UNBUNDLED/);
  assert.deepEqual(siteSeed, {
    title: 'Local Content Lab',
    description: 'A small dependency-free content collection workflow.',
    baseUrl: 'https://example.test',
  });
  assert.doesNotMatch(rootSchema, /seed:/);
  assert.match(rootSchema, /source: files\("\.\/db\/blog\/\*\*\/\*\.mdx", \{ read: "frontmatter" \}\)/);
  assert.match(rootSchema, /source: files\("\.\/db\/docs\/\*\*\/\*\.mdx", \{ read: "frontmatter" \}\)/);

  const bundledSync = await syncDb(await loadConfig({ cwd: contentCwd }));
  assert.deepEqual(Object.keys(bundledSync.schema.resources), ['authors', 'blog', 'docs', 'site']);
});

test('computed fields example resolves different computed field patterns', async () => {
  const cwd = await copyExampleProject('computed-fields');
  await syncDb(await loadConfig({ cwd }));
  const generatedTypes = await readFile(path.join(cwd, 'src/generated/db.types.ts'), 'utf8');
  const db = await openDb({ cwd, syncOnOpen: false });
  await db.runtime.hydrate();

  assert.match(generatedTypes, /fullName\?: string;/);
  assert.match(generatedTypes, /readingTimeMinutes\?: number;/);
  assert.match(generatedTypes, /priceLabel\?: string;/);
  assert.match(generatedTypes, /totalCents\?: number;/);

  const defaultOrders = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('GET'),
    defaultOrders,
    new URL('http://db.local/orders'),
  );
  assert.equal(defaultOrders.json().some((record) => 'totalCents' in record), false);

  const usersRest = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('GET'),
    usersRest,
    new URL('http://db.local/users?select=id,fullName'),
  );
  assert.deepEqual(usersRest.json(), [
    { id: 'u_1', fullName: 'Ada Lovelace' },
    { id: 'u_2', fullName: 'Grace Hopper' },
  ]);

  const ordersRest = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('GET'),
    ordersRest,
    new URL('http://db.local/orders?select=id,itemCount,totalCents'),
  );
  assert.deepEqual(ordersRest.json(), [
    { id: 'ord_1', itemCount: 5, totalCents: 5500 },
  ]);

  const graphql = await executeGraphql(db, {
    query: `{
      posts {
        id
        readingTimeMinutes
      }
      products {
        id
        priceLabel
      }
      orders {
        id
        receiptLine
      }
    }`,
  });

  assert.deepEqual(graphql.data.posts, [
    { id: 'post_intro', readingTimeMinutes: 1 },
    { id: 'post_release', readingTimeMinutes: 1 },
  ]);
  assert.deepEqual(graphql.data.products, [
    { id: 'prod_sticker', priceLabel: '$5.00' },
    { id: 'prod_mug', priceLabel: '$20.00' },
  ]);
  assert.deepEqual(graphql.data.orders, [
    { id: 'ord_1', receiptLine: 'Ada Lovelace - 5 items - $55.00' },
  ]);
});

test('hono auth example shows lifecycle hook integration code', async () => {
  const source = await readFile(path.resolve('examples/hono-auth/src/app.mjs'), 'utf8');

  assert.match(source, /registerDbRoutes/);
  assert.match(source, /lifecycleHooks/);
  assert.match(source, /beforeRequest/);
  assert.match(source, /beforeWrite/);
  assert.match(source, /Bearer admin-token/);
  assert.match(source, /Bearer user-token/);
});

async function copyExampleProject(name) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'db-example-test-'));
  const cwd = path.join(tempRoot, name);
  await cp(path.resolve('examples', name), cwd, {
    recursive: true,
    filter(source) {
      return !source.split(path.sep).includes('.db');
    },
  });
  await mkdir(path.join(cwd, 'node_modules/@async'), { recursive: true });
  await symlink(path.resolve('.'), path.join(cwd, 'node_modules/@async/db'), 'dir');
  return cwd;
}

function makeRequest(method, body) {
  return {
    method,
    headers: {},
    [Symbol.asyncIterator]: async function* readBody() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
  };
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = {
        ...this.headers,
        ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])),
      };
    },
    end(chunk = '') {
      this.body += chunk;
    },
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}
