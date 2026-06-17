import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createExampleRuntime } from '../../scripts/example-launcher.js';
import {
  findExamples,
  describeHostedExamples,
  formatExamplesConsoleSummary,
  parseArgs,
  renderExamplesIndex,
  resolveExamplesAddress,
  resolveExamplesHost,
  serveExamples,
  startTailscaleServe,
  stopExamplesStack,
  tailscaleServeArgs,
} from '../../scripts/serve-examples.js';
import { executeGraphql as typedExecuteGraphql } from '../../src/graphql/execute.js';
import { loadConfig as typedLoadConfig, openDb as typedOpenDb, syncDb as typedSyncDb } from '../../src/index.js';
import { buildOperationManifest as typedBuildOperationManifest, createDbOperationHandler as typedCreateDbOperationHandler } from '../../src/operations.js';
import { handleRestRequest as typedHandleRestRequest } from '../../src/rest/handler.js';

const execFileAsync = promisify(execFile);

const loadConfig = async (options: unknown): Promise<any> => typedLoadConfig(options as never) as Promise<any>;
const syncDb = async (...args: any[]): Promise<any> => typedSyncDb(args[0] as never, args[1] as never) as Promise<any>;
const openDb = async (options: unknown): Promise<any> => typedOpenDb(options as never) as Promise<any>;
const executeGraphql = async (...args: any[]): Promise<any> => typedExecuteGraphql(args[0] as never, args[1] as never) as Promise<any>;
const buildOperationManifest = async (...args: any[]): Promise<any> => typedBuildOperationManifest(args[0] as never, args[1] as never) as Promise<any>;
const createDbOperationHandler = (...args: any[]): any => typedCreateDbOperationHandler(args[0] as never, args[1] as never);
const handleRestRequest = async (...args: any[]): Promise<void> => typedHandleRestRequest(args[0], args[1], args[2], args[3]);
const { renderRecordDetailPage } = await import(pathToFileURL(path.resolve('examples/schema-ui/src/cms-ssr.js')).href);

test('examples launcher can discover repo examples and render an index page', async () => {
  const examples = await findExamples(path.resolve('examples'));
  const names = examples.map((example) => example.name);

  assert.deepEqual(names, [
    'data-first',
    'basic',
    'schema-first',
    'csv',
    'relations',
    'rest-client',
    'diagnostics',
    'computed-fields',
    'content-collections',
    'github-content',
    'standard-schema',
    'schema-manifest',
    'schema-ui',
    'tina-git-cms',
    'advanced',
    'production-json',
    'hono-auth',
    'cms-json-publish',
    'free-plan-upgrade',
    'local-web-app',
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
  assert.match(html, /serve-example\.js/);
  assert.match(html, /Open viewer/);
  assert.match(html, /Start here/);
  assert.match(html, /data-first/);
  assert.match(html, /Content Collections/);
  assert.match(html, /GitHub Content/);
  assert.match(html, /Tina-Style Git CMS/);
  assert.match(html, /CMS JSON Publish/);
  assert.match(html, /Computed Fields/);
  assert.match(html, /csv/);
  assert.match(html, /diagnostics/);
  assert.match(html, /Free Plan Upgrade/);
  assert.match(html, /Hono Auth/);
  assert.match(html, /Local Web App/);
  assert.match(html, /Production JSON/);
  assert.match(html, /REST Client/);
  assert.match(html, /client/);
  assert.match(html, /relations/);
  assert.match(html, /schema-first/);
  assert.match(html, /Schema Manifest/);
  assert.match(html, /Schema UI/);
  assert.match(html, /Standard Schema/);

  const schemaUiHook = await readFile(path.resolve('examples/schema-ui/serve-example.js'), 'utf8');
  assert.match(schemaUiHook, /createExampleRuntime/);
});

test('examples console summary prints one directory URL and example names only', () => {
  const summary = formatExamplesConsoleSummary({
    indexUrl: 'http://127.0.0.1:7329',
    tailscaleServeUrl: 'https://workstation.tailnet.ts.net',
    examples: [
      {
        name: 'basic',
        viewerUrl: 'http://127.0.0.1:7329/examples/basic/__db',
      },
      {
        name: 'schema-ui',
        demoUrl: 'http://127.0.0.1:7329/examples/schema-ui/',
        viewerUrl: 'http://127.0.0.1:7329/examples/schema-ui/__db',
      },
    ],
  });

  assert.deepEqual(summary, [
    'db examples directory: http://127.0.0.1:7329',
    'tailscale serve HTTPS: https://workstation.tailnet.ts.net',
    'examples:',
    '  basic',
    '  schema-ui',
    'Press Ctrl+C to stop.',
  ]);
  assert.doesNotMatch(summary.join('\n'), /\/__db|\/examples\/basic|\/examples\/schema-ui/);
});

test('examples launcher parses the opt-in Tailscale Serve flag', () => {
  assert.deepEqual(parseArgs(['--port', '8123', '--tailscale-serve']), {
    host: undefined,
    port: '8123',
    tailscaleServe: true,
  });
});

test('examples host uses an explicit host before auto-detected Tailscale', async () => {
  const host = await resolveExamplesHost({
    host: '127.0.0.1',
    detectTailscaleHost: async () => '100.64.0.10',
  });

  assert.equal(host, '127.0.0.1');
});

test('examples host defaults to loopback even when Tailscale is available', async () => {
  const host = await resolveExamplesHost({
    detectTailscaleHost: async () => '100.64.0.10',
  });

  assert.equal(host, '127.0.0.1');
});

test('examples host keeps Tailscale MagicDNS separate from the local bind address', async () => {
  const address = await resolveExamplesAddress({
    detectTailscaleNetwork: async () => ({
      ipv4: '100.64.0.10',
      dnsName: 'workstation.tailnet.ts.net.',
    }),
  });

  assert.deepEqual(address, {
    host: '127.0.0.1',
    tailscaleHostname: 'workstation.tailnet.ts.net',
  });
});

test('Tailscale Serve helper uses the background HTTPS proxy command', async () => {
  const startedPorts: number[] = [];

  const result = await startTailscaleServe({
    port: 7329,
    runTailscaleServe: async ({ port }) => {
      startedPorts.push(port);
      return {
        stdout: [
          'Available within your tailnet:',
          'https://workstation.tailnet.ts.net',
          '',
        ].join('\n'),
        stderr: '',
      };
    },
    detectTailscaleNetwork: async () => ({
      dnsName: 'workstation.tailnet.ts.net.',
    }),
  });

  assert.deepEqual(tailscaleServeArgs(7329), ['serve', '--bg', '7329']);
  assert.deepEqual(startedPorts, [7329]);
  assert.equal(result.httpsUrl, 'https://workstation.tailnet.ts.net');
  assert.match(result.output, /Available within your tailnet/);
});

test('examples host starts Tailscale Serve only when requested', async () => {
  const startedPorts: number[] = [];
  const stack = await serveExamples({
    port: 0,
    runTailscaleServe: async ({ port }) => {
      startedPorts.push(port);
      return { stdout: '', stderr: '' };
    },
  });

  try {
    assert.deepEqual(startedPorts, []);
  } finally {
    await stack.close();
  }

  const tailscaleStack = await serveExamples({
    port: 0,
    tailscaleServe: true,
    runTailscaleServe: async ({ port }) => {
      startedPorts.push(port);
      return { stdout: '', stderr: '' };
    },
    detectTailscaleNetwork: async () => ({
      dnsName: 'workstation.tailnet.ts.net.',
    }),
  });

  try {
    assert.deepEqual(startedPorts, [Number(new URL(tailscaleStack.indexUrl).port)]);
    assert.equal(tailscaleStack.tailscaleServeUrl, 'https://workstation.tailnet.ts.net');
  } finally {
    await tailscaleStack.close();
  }
});

test('examples index renders links from the public request origin', async () => {
  const examples = await findExamples(path.resolve('examples'));
  const html = renderExamplesIndex(describeHostedExamples(examples, 'https://workstation.tailnet.ts.net'));

  assert.match(html, /href="https:\/\/workstation\.tailnet\.ts\.net\/examples\/basic\/__db"/);
  assert.match(html, /href="https:\/\/workstation\.tailnet\.ts\.net\/examples\/schema-ui\/"/);
  assert.doesNotMatch(html, /100\.64\.0\.10|127\.0\.0\.1/);
});

test('examples json uses forwarded HTTPS origin for public URLs', async () => {
  const stack = await serveExamples({
    host: '127.0.0.1',
    port: 0,
  });

  try {
    const response = await fetch(`${stack.indexUrl}/examples.json`, {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'workstation.tailnet.ts.net',
      },
    });
    assert.equal(response.status, 200);

    const examples = await response.json();
    const basic = examples.find((example) => example.name === 'basic');
    const schemaUi = examples.find((example) => example.name === 'schema-ui');

    assert.equal(basic.url, 'https://workstation.tailnet.ts.net/examples/basic');
    assert.equal(basic.viewerUrl, 'https://workstation.tailnet.ts.net/examples/basic/__db');
    assert.equal(schemaUi.demoUrl, 'https://workstation.tailnet.ts.net/examples/schema-ui/');
  } finally {
    await stack.close();
  }
});

test('lazy example runtimes receive the current public request URL', async () => {
  const runtimeUrls: string[] = [];
  const stack = await serveExamples({
    host: '127.0.0.1',
    port: 0,
    async createRuntime({ example }) {
      runtimeUrls.push(example.url);
      return {
        starterKind: 'custom',
        viewerUrl: `${example.url}/__db`,
        demoUrl: `${example.url}/`,
        demoLinks: [],
        async handleRequest(_request, response) {
          response.writeHead(200, {
            'content-type': 'text/plain; charset=utf-8',
          });
          response.end(example.url);
        },
        async close() {},
      };
    },
  });

  try {
    const response = await fetch(`${stack.indexUrl}/examples/schema-ui/`, {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'workstation.tailnet.ts.net',
      },
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'https://workstation.tailnet.ts.net/examples/schema-ui');
    assert.deepEqual(runtimeUrls, ['https://workstation.tailnet.ts.net/examples/schema-ui']);
  } finally {
    await stack.close();
  }
});

test('examples host lazily starts only requested example runtimes', async () => {
  const started: string[] = [];
  const closed: string[] = [];
  const handledUrls: string[] = [];
  const stack = await serveExamples({
    port: 0,
    async createRuntime({ example }) {
      started.push(example.name);
      return {
        starterKind: 'db',
        viewerUrl: `${example.url}/__db`,
        demoUrl: undefined,
        demoLinks: [],
        async handleRequest(request, response) {
          handledUrls.push(request.url);
          response.writeHead(200, {
            'content-type': 'text/plain; charset=utf-8',
          });
          response.end(example.name);
        },
        async close() {
          closed.push(example.name);
        },
      };
    },
  });

  try {
    assert.deepEqual(stack.startedExampleNames(), []);

    const index = await fetch(stack.indexUrl);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Basic/);
    assert.deepEqual(started, []);

    const basic = await fetch(`${stack.indexUrl}/examples/basic/__db`);
    assert.equal(basic.status, 200);
    assert.equal(await basic.text(), 'basic');
    assert.deepEqual(started, ['basic']);
    assert.deepEqual(stack.startedExampleNames(), ['basic']);

    const schemaUi = await fetch(`${stack.indexUrl}/examples/schema-ui/`);
    assert.equal(schemaUi.status, 200);
    assert.equal(await schemaUi.text(), 'schema-ui');
    assert.deepEqual(started, ['basic', 'schema-ui']);
    assert.deepEqual(stack.startedExampleNames(), ['basic', 'schema-ui']);
    assert.deepEqual(handledUrls, ['/examples/basic/__db', '/examples/schema-ui/']);
  } finally {
    await stack.close();
  }

  assert.deepEqual(closed, ['basic', 'schema-ui']);
});

test('examples host shutdown closes started runtimes only', async () => {
  const closed: string[] = [];
  const stack = {
    indexServer: fakeServer('index', closed),
    runtimes: new Map([
      ['basic', fakeRuntime('basic-runtime', closed)],
      ['schema-ui', fakeRuntime('schema-ui-runtime', closed)],
    ]),
  };

  await stopExamplesStack(stack as never);

  assert.deepEqual(closed, ['index', 'basic-runtime', 'schema-ui-runtime']);
});

test('example runtime wires local package imports for nested example packages', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'db-nested-example-test-'));
  const cwd = path.join(tempRoot, 'hono-auth');
  await cp(path.resolve('examples/hono-auth'), cwd, {
    recursive: true,
    filter(source) {
      return !source.split(path.sep).includes('.db') && !source.split(path.sep).includes('node_modules');
    },
  });

  const runtime = await createExampleRuntime({
    cwd,
    basePath: '/examples/hono-auth',
    url: 'http://127.0.0.1:7329/examples/hono-auth',
    repoRoot: path.resolve('.'),
  });

  try {
    const response = makeResponse();
    await runtime.handleRequest(makeRequest('GET', undefined, '/examples/hono-auth/__db/schema'), response);
    assert.equal(response.statusCode, 200);

    const viewer = makeResponse();
    await runtime.handleRequest(makeRequest('GET', undefined, '/examples/hono-auth/__db'), viewer);
    assert.equal(viewer.statusCode, 200);
    assert.match(viewer.body, /const SCHEMA_PATH = "\/examples\/hono-auth\/__db\/schema"/);
    assert.match(viewer.body, /const GRAPHQL_PATH = "\/examples\/hono-auth\/graphql"/);
  } finally {
    await runtime.close();
  }
});

test('example runtime resolves schema-ui serve-example hook', async () => {
  const cwd = path.resolve('examples/schema-ui');
  const runtime = await createExampleRuntime({
    cwd,
    basePath: '/examples/schema-ui',
    url: 'http://127.0.0.1:7329/examples/schema-ui',
    repoRoot: path.resolve('.'),
  });

  assert.equal(runtime.starterKind, 'custom');
  assert.equal(runtime.demoUrl, 'http://127.0.0.1:7329/examples/schema-ui/');

  const templates = makeResponse();
  await runtime.handleRequest(makeRequest('GET', undefined, '/examples/schema-ui/templates'), templates);
  assert.equal(templates.statusCode, 200);

  const home = makeResponse();
  await runtime.handleRequest(makeRequest('GET', undefined, '/examples/schema-ui/'), home);
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /href="\/examples\/schema-ui\/cms\/pages"/);
  assert.match(home.body, /href="\/examples\/schema-ui\/templates"/);

  const detail = makeResponse();
  await runtime.handleRequest(makeRequest('GET', undefined, '/examples/schema-ui/cms/pages/page_home'), detail);
  assert.equal(detail.statusCode, 200);
  assert.match(detail.body, /href="\/examples\/schema-ui\/cms\/users\//);

  const viewer = makeResponse();
  await runtime.handleRequest(makeRequest('GET', undefined, '/examples/schema-ui/__db'), viewer);
  assert.equal(viewer.statusCode, 200);
  assert.match(viewer.body, /const SCHEMA_PATH = "\/examples\/schema-ui\/__db\/schema"/);
  assert.match(viewer.body, /const GRAPHQL_PATH = "\/examples\/schema-ui\/graphql"/);

  await runtime.close();
});

test('local web app example saves server state to source JSON and restores transient drafts', async () => {
  const cwd = await copyExampleProject('local-web-app');
  const runtime = await createExampleRuntime({
    cwd,
    basePath: '/examples/local-web-app',
    url: 'http://127.0.0.1:7329/examples/local-web-app',
    repoRoot: path.resolve('.'),
  });

  try {
    assert.equal(runtime.starterKind, 'custom');
    assert.equal(runtime.demoUrl, 'http://127.0.0.1:7329/examples/local-web-app/');

    const home = makeResponse();
    await runtime.handleRequest(makeRequest('GET', undefined, '/examples/local-web-app/'), home);
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /@async\/db Local Web App/);
    assert.match(home.body, /window\.LOCAL_APP_BASE_PATH = "\/examples\/local-web-app"/);

    const appScript = makeResponse();
    await runtime.handleRequest(makeRequest('GET', undefined, '/examples/local-web-app/app.js'), appScript);
    assert.equal(appScript.statusCode, 200);
    assert.match(appScript.body, /\.\/framework\/state\.js/);

    const frameworkScript = makeResponse();
    await runtime.handleRequest(makeRequest('GET', undefined, '/examples/local-web-app/framework/state.js'), frameworkScript);
    assert.equal(frameworkScript.statusCode, 200);
    assert.match(frameworkScript.body, /TRANSIENT_STORAGE_KEY/);

    const stateResponse = makeResponse();
    await runtime.handleRequest(makeRequest('GET', undefined, '/examples/local-web-app/api/state'), stateResponse);
    assert.equal(stateResponse.statusCode, 200);
    assert.equal(stateResponse.json().state.title, 'Local App Notes');

    const savedState = {
      title: 'Blur saved title',
      note: 'Saved after unfocus',
      updatedAt: '2026-06-03T12:00:00.000Z',
    };
    const saveResponse = makeResponse();
    await runtime.handleRequest(makeRequest('PUT', { state: savedState }, '/examples/local-web-app/api/state'), saveResponse);
    assert.equal(saveResponse.statusCode, 200);
    assert.deepEqual(saveResponse.json().state, savedState);
    assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'db/appState.json'), 'utf8')), savedState);
    await assert.rejects(
      () => readFile(path.join(cwd, '.db/state/appState.json'), 'utf8'),
      { code: 'ENOENT' },
    );

    const version = makeResponse();
    await runtime.handleRequest(makeRequest('GET', undefined, '/examples/local-web-app/api/version'), version);
    assert.equal(version.statusCode, 200);
    assert.match(version.json().version, /^\d/);

    const helpers = await import(pathToFileURL(path.join(cwd, 'framework/state.js')).href);
    assert.equal(helpers.shouldCommitFieldEvent('input', 'draft', 'server'), false);
    assert.equal(helpers.shouldCommitFieldEvent('blur', 'draft', 'server'), true);
    assert.equal(helpers.shouldCommitFieldEvent('change', 'server', 'server'), false);
    assert.deepEqual(helpers.applyTransientState(savedState, {
      drafts: {
        note: 'Unsaved note during reload',
      },
      active: {
        field: 'note',
        selectionStart: 7,
        selectionEnd: 11,
      },
      scrollY: 240,
    }), {
      state: {
        ...savedState,
        note: 'Unsaved note during reload',
      },
      transient: {
        drafts: {
          note: 'Unsaved note during reload',
        },
        active: {
          field: 'note',
          selectionStart: 7,
          selectionEnd: 11,
        },
        scrollY: 240,
      },
    });
  } finally {
    await runtime.close();
  }
});

test('new onboarding examples sync expected resources', async () => {
  const expected = {
    'hono-auth': ['pages', 'users'],
    'content-collections': ['authors', 'blog', 'docs', 'site'],
    'computed-fields': ['orders', 'posts', 'products', 'users'],
    'cms-json-publish': ['navigation', 'pages'],
    'free-plan-upgrade': ['appSettings', 'projects'],
    'github-content': ['posts'],
    'local-web-app': ['appState'],
    'production-json': ['appSettings', 'featureFlags'],
    'rest-client': ['settings', 'users'],
    relations: ['posts', 'users'],
    'schema-manifest': ['projects', 'users'],
    'schema-ui': ['pages', 'users'],
    'standard-schema': ['settings', 'users'],
    'tina-git-cms': ['authors', 'pages', 'site'],
  };

  for (const [name, resources] of Object.entries(expected)) {
    const cwd = await copyExampleProject(name);
    const result = await syncDb(await loadConfig({ cwd }));

    assert.deepEqual(Object.keys(result.schema.resources), resources, `${name} resources`);
  }

  const cmsCwd = await copyExampleProject('cms-json-publish');
  await execFileAsync(process.execPath, ['src/cms.js'], { cwd: cmsCwd });

  const upgradeCwd = await copyExampleProject('free-plan-upgrade');
  await execFileAsync(process.execPath, ['src/upgrade-tenant-to-paid.js'], { cwd: upgradeCwd });

  const productionJsonCwd = await copyExampleProject('production-json');
  const productionJsonConfig = await loadConfig({ cwd: productionJsonCwd });
  await syncDb(productionJsonConfig);
  const { refs } = await buildOperationManifest(productionJsonConfig, {
    generatedAt: '2026-01-01T00:00:00.000Z',
    write: false,
  });
  const productionJsonDb = await openDb({ cwd: productionJsonCwd, syncOnOpen: false });
  await productionJsonDb.runtime.hydrate();
  const productionJsonOperations = createDbOperationHandler(productionJsonDb);

  const settings = await productionJsonOperations.execute(refs.operations.ReadPublicSettings.ref);
  assert.equal(settings.status, 200);
  assert.equal(settings.body.appName, 'Launch Console');
  assert.equal(settings.body.maintenanceMode, false);

  const billingFlag = await productionJsonOperations.execute(refs.operations.GetFeatureFlag.ref, {
    id: 'flag_billing_v2',
  });
  assert.equal(billingFlag.status, 200);
  assert.deepEqual(billingFlag.body, {
    id: 'flag_billing_v2',
    key: 'billing.v2',
    enabled: true,
    audience: 'beta',
    rolloutPercent: 25,
    description: 'Expose the new billing flow to beta accounts.',
    owner: 'growth',
    updatedAt: '2026-05-01T12:00:00Z',
  });

  const controlPlane = await productionJsonOperations.execute(refs.operations.GetControlPlane.ref);
  assert.equal(controlPlane.status, 200);
  assert.equal(controlPlane.body.data.appSettings.appName, 'Launch Console');
  assert.equal(controlPlane.body.data.featureFlags.length, 3);
  await assert.rejects(
    () => productionJsonOperations.execute('ReadPublicSettings'),
    (error: any) => error.code === 'OPERATION_NOT_FOUND',
  );

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

  const { stdout } = await execFileAsync(process.execPath, ['src/render-admin.js'], { cwd: schemaUiCwd });
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
  const generatedTypes = await readFile(path.join(contentCwd, 'src/generated/db.types.d.ts'), 'utf8');
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
    (error: any) => error.code === 'STORE_RESOURCE_READ_ONLY',
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

  const preview = await execFileAsync(process.execPath, ['src/content-preview.js'], { cwd: contentCwd });
  assert.match(preview.stdout, /<article data-kind="blog" data-id="launch-notes" data-href="\/blog\/launch-notes">/);
  assert.match(preview.stdout, /Intro To Local Content/);

  const bundled = await execFileAsync(process.execPath, [
    path.resolve('dist/cli.js'),
    'schema',
    'bundle',
    '--all',
    '--cwd',
    contentCwd,
  ]);
  const rootSchema = await readFile(path.join(contentCwd, 'db.schema.js'), 'utf8');
  const siteSeed = JSON.parse(await readFile(path.join(contentCwd, 'db/site.json'), 'utf8'));

  assert.match(bundled.stdout, /Generated db\/site\.json/);
  assert.match(bundled.stdout, /Generated db\.schema\.js/);
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

test('standard schema example validates writes and keeps computed metadata', async () => {
  const cwd = await copyExampleProject('standard-schema');
  const result = await syncDb(await loadConfig({ cwd }));
  const db = await openDb({ cwd, syncOnOpen: false });
  await db.runtime.hydrate();

  const created = await db.collection('users').create({
    id: 'u_2',
    email: ' GRACE@EXAMPLE.COM ',
    firstName: 'Grace',
    lastName: 'Hopper',
  });
  const graphql = await executeGraphql(db, {
    query: `{
      users {
        id
        email
        displayName
      }
    }`,
  });

  assert.equal(created.email, 'grace@example.com');
  assert.equal(result.schema.resources.users.fields.displayName.computed, true);
  assert.equal('validators' in result.schema.resources.users, false);
  assert.match(
    result.diagnostics.map((diagnostic) => diagnostic.code).join('\n'),
    /STANDARD_SCHEMA_FIELDS_UNKNOWN/,
  );
  assert.deepEqual(graphql.data.users.find((record) => record.id === 'u_2'), {
    id: 'u_2',
    email: 'grace@example.com',
    displayName: 'Grace Hopper',
  });
});

test('computed fields example resolves different computed field patterns', async () => {
  const cwd = await copyExampleProject('computed-fields');
  await syncDb(await loadConfig({ cwd }));
  const generatedTypes = await readFile(path.join(cwd, 'src/generated/db.types.d.ts'), 'utf8');
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
  const source = await readFile(path.resolve('examples/hono-auth/src/app.js'), 'utf8');

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
      return !source.split(path.sep).includes('.db') && !source.split(path.sep).includes('node_modules');
    },
  });
  await mkdir(path.join(cwd, 'node_modules/@async'), { recursive: true });
  await symlink(path.resolve('.'), path.join(cwd, 'node_modules/@async/db'), 'dir');
  return cwd;
}

async function closeServer(server: { close(callback: (error?: Error) => void): unknown }) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function makeRequest(method: string, body: unknown = undefined, url = '/') {
  return {
    method,
    url,
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

function fakeServer(name: string, closed: string[]) {
  return {
    close(callback: (error?: Error) => void) {
      closed.push(name);
      callback();
      return this;
    },
  };
}

function fakeDb(name: string, closed: string[]) {
  return {
    async close() {
      closed.push(name);
    },
  };
}

function fakeRuntime(name: string, closed: string[]) {
  return {
    async close() {
      closed.push(name);
    },
  };
}
