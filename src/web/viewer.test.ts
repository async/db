import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDbViewer } from './viewer.js';

test('web viewer renders the db tool surface', () => {
  const html = renderDbViewer({ graphqlPath: '/graphql' });

  assert.match(html, /db viewer/);
  assert.match(html, /cdn\.tailwindcss\.com/);
  assert.match(html, /htmx\.org/);
  assert.match(html, /Data/);
  assert.match(html, /REST Specs/);
  assert.match(html, /GraphQL Examples/);
  assert.match(html, /REST Runner/);
  assert.match(html, /GraphQL Runner/);
  assert.match(html, /Generated Schema/);
  assert.match(html, /\/__db\/schema/);
  assert.match(html, /\/__db\/manifest\.json/);
  assert.match(html, /\/__db\/events/);
  assert.match(html, /inline-flex min-h-10 items-center justify-center gap-2 rounded-md border/);
  assert.match(html, /px-3 py-2/);
  assert.match(html, /Batch requests run sequentially/);
  assert.match(html, /Earlier successful writes stay committed/);
  assert.match(html, /const BUTTON_CLASS =/);
  assert.match(html, /Import CSV/);
  assert.match(html, /copy it into db\//);
  assert.match(html, /id="csv-drop"/);
  assert.match(html, /id="diagnostics-view"/);
  assert.match(html, /Relations/);
  assert.match(html, /expand=/);
  assert.match(html, /data-relation-link/);
  assert.match(html, /\/__db\/import/);
  assert.match(html, /x-db-file-name/);
});

test('web viewer renders configured fixture folder label', () => {
  const html = renderDbViewer({
    graphqlPath: '/graphql',
    sourceDirLabel: 'db/',
  });

  assert.match(html, /copy it into db\//);
});

test('web viewer renders configured scoped API paths', () => {
  const html = renderDbViewer({
    graphqlPath: '/__db/graphql',
    schemaPath: '/__db/schema',
    manifestPath: '/__db/manifest.json',
    eventsPath: '/__db/events',
    importPath: '/__db/import',
    restBatchPath: '/__db/batch',
    restBasePath: '/__db/rest',
  });

  assert.match(html, /const GRAPHQL_PATH = "\/__db\/graphql"/);
  assert.match(html, /const SCHEMA_PATH = "\/__db\/schema"/);
  assert.match(html, /const MANIFEST_PATH = "\/__db\/manifest\.json"/);
  assert.match(html, /const EVENTS_PATH = "\/__db\/events"/);
  assert.match(html, /const IMPORT_PATH = "\/__db\/import"/);
  assert.match(html, /const REST_BATCH_PATH = "\/__db\/batch"/);
  assert.match(html, /const REST_BASE_PATH = "\/__db\/rest"/);
});

test('web viewer local CSS does not override Tailwind layout utilities', () => {
  const html = renderDbViewer({ graphqlPath: '/graphql' });

  assert.doesNotMatch(html, /<style>/);
  assert.match(html, /<div class="grid min-h-screen grid-rows-\[auto_1fr\]">/);
  assert.match(html, /lg:grid-cols-\[minmax\(220px,280px\)_minmax\(0,1fr\)\]/);
  assert.match(html, /xl:grid-cols-\[minmax\(0,1\.25fr\)_minmax\(320px,0\.75fr\)\]/);
  assert.match(html, /data-tab-panel class="hidden"/);
  assert.match(html, /classList\.toggle\('hidden'/);
  assert.match(html, /data-copy-example/);
  assert.match(html, /localStorage\.setItem\('db:selectedResource'/);
  assert.match(html, /localStorage\.removeItem\('db:selectedResource'\)/);
  assert.match(html, /url\.searchParams\.delete\('resource'\)/);
  assert.match(html, /await loadSelectedData\(\);\n      renderRestExamples\(\);\n      renderGraphqlExamples\(\);/);
  assert.match(html, /function nextRecordId\(resource\)/);
  assert.match(html, /new EventSource\(EVENTS_PATH\)/);
  assert.doesNotMatch(html, /class="(?:app|layout|toolbar|tabs|tab|viewer-grid|panel|panel-head|panel-body|stack|row|muted|code|table-wrap|example|example-head|resource-button|is-hidden)"/);
});
