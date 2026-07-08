import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDbViewer } from './viewer.js';

test('web viewer renders the db tool surface', () => {
  const html = renderDbViewer({ graphqlPath: '/graphql' });

  assert.match(html, /db viewer/);
  assert.match(html, /cdn\.tailwindcss\.com/);
  assert.match(html, /htmx\.org/);
  assert.match(html, /aria-label="Viewer areas"/);
  assert.match(html, /id="context-explorer"/);
  assert.match(html, /Current connection/);
  assert.match(html, /Local @async\/db runtime/);
  assert.match(html, /data-app-area data-area="connections"/);
  assert.match(html, /data-app-area data-area="data"/);
  assert.match(html, /data-app-area data-area="query"/);
  assert.match(html, /data-app-area data-area="schema"/);
  assert.match(html, /data-app-area data-area="operations"/);
  assert.match(html, /data-app-area data-area="logs"/);
  assert.match(html, /data-app-area data-area="settings"/);
  assert.match(html, /id="area-connections"/);
  assert.match(html, /id="area-data"/);
  assert.match(html, /id="area-query"/);
  assert.match(html, /id="area-schema"/);
  assert.match(html, /id="area-operations"/);
  assert.match(html, /id="area-logs"/);
  assert.match(html, /id="area-settings"/);
  assert.match(html, /Data/);
  assert.match(html, /Query/);
  assert.match(html, /Schema/);
  assert.match(html, /Operations/);
  assert.match(html, /Logs/);
  assert.match(html, /Settings/);
  assert.match(html, /REST Specs/);
  assert.match(html, /GraphQL Examples/);
  assert.match(html, /REST Runner/);
  assert.match(html, /GraphQL Runner/);
  assert.match(html, /Generated Schema/);
  assert.match(html, /Route Exposure/);
  assert.match(html, /Stores/);
  assert.match(html, /Operation Availability/);
  assert.match(html, /does not expose a safe SQL query capability/);
  assert.match(html, /does not expose a safe explain\/plan capability/);
  assert.match(html, /\/__db\/schema/);
  assert.match(html, /\/__db\/manifest\.json/);
  assert.match(html, /\/__db\/events/);
  assert.match(html, /inline-flex min-h-9 items-center justify-center gap-2 rounded-md border/);
  assert.match(html, /px-3 py-2/);
  assert.match(html, /Batch requests run sequentially/);
  assert.match(html, /Earlier successful writes stay committed/);
  assert.match(html, /const BUTTON_CLASS =/);
  assert.match(html, /const APP_RAIL_BUTTON_CLASS =/);
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

test('web viewer shell renders manifest-driven badges and summaries without seeded content', () => {
  const html = renderDbViewer({ graphqlPath: '/graphql' });

  assert.match(html, /storeText\(resource\)/);
  assert.match(html, /writeBadgeText\(resource\)/);
  assert.match(html, /state\.manifest\.capabilities\?\.rest === false \? 'REST off' : 'REST ready'/);
  assert.match(html, /resource\.actions\?\.create\?\.available/);
  assert.match(html, /resource\.actions\?\.patch\?\.available/);
  assert.match(html, /resource\.store\?\.name/);
  assert.match(html, /state\.manifest\?\.stores/);
  assert.match(html, /state\.manifest\?\.operations/);
  assert.match(html, /state\.selected\.queryModes/);
  assert.doesNotMatch(html, /\border(s)?\b/i);
  assert.doesNotMatch(html, /\bcustomer(s)?\b/i);
  assert.doesNotMatch(html, /Table A/i);
  assert.doesNotMatch(html, /fake (activity|metrics?)/i);
  assert.doesNotMatch(html, /prompt note/i);
  assert.doesNotMatch(html, /AI assist/i);
});

test('web viewer renders resource workspace and data grid behaviors', () => {
  const html = renderDbViewer({ graphqlPath: '/graphql' });

  assert.match(html, /id="grid-toolbar"/);
  assert.match(html, /page size ' \+ state\.page\.limit/);
  assert.match(html, /page: \{ offset: 0, limit: 50 \}/);
  assert.match(html, /function resourcePagePath\(resource\)/);
  assert.match(html, /appendQuery\(path, \{\n        offset: state\.page\.offset,\n        limit: state\.page\.limit,/);
  assert.match(html, /function schemaFirstColumns\(records, resource\)/);
  assert.match(html, /Object\.keys\(resource\.fields \|\| \{\}\)/);
  assert.match(html, /function identityBadgeHtml\(resource, column\)/);
  assert.match(html, />identity<\/span>/);
  assert.match(html, /data-json-detail/);
  assert.match(html, /function nestedValueHtml\(value, index, field\)/);
  assert.match(html, /data-relation-link/);
  assert.match(html, /function writeControlsHtml\(resource\)/);
  assert.match(html, /data-write-controls/);
  assert.match(html, /writes disabled/);
  assert.match(html, /id="record-editor"/);
  assert.match(html, /id="pending-edit-actions"/);
  assert.match(html, /Pending edit staged/);
  assert.match(html, /function applyPendingEdit\(\)/);
  assert.match(html, /method: target\.method/);
  assert.match(html, /function renderDocumentWorkspace\(documentData, resource\)/);
  assert.match(html, /Document resource/);
  assert.match(html, /No records found for this page/);
  assert.match(html, /data-page-action="previous"/);
  assert.match(html, /data-page-action="next"/);
});

test('web viewer renders capability-aware query and operation workspace', () => {
  const html = renderDbViewer({ graphqlPath: '/graphql' });

  assert.match(html, /data-query-mode="resource"/);
  assert.match(html, /data-query-mode="operation"/);
  assert.match(html, /data-query-mode="graphql"/);
  assert.match(html, /data-query-mode="sql"/);
  assert.match(html, /data-query-mode="explain"/);
  assert.match(html, /id="query-mode-resource"/);
  assert.match(html, /id="query-mode-operation"/);
  assert.match(html, /id="query-mode-graphql"/);
  assert.match(html, /id="query-mode-sql"/);
  assert.match(html, /id="query-mode-explain"/);
  assert.match(html, /id="resource-query-url"/);
  assert.match(html, /id="resource-query-preview"/);
  assert.match(html, /function resourceQueryPath\(\)/);
  assert.match(html, /const disabledReason = resourceQueryDisabledReason\(state\.selected\);\n      if \(disabledReason\) {\n        state\.selectedData = null;/);
  assert.match(html, /els\.dataView\.innerHTML = emptyHtml\(disabledReason\)/);
  assert.match(html, /Direct REST reads are registered-only/);
  assert.match(html, /Use Operation mode with a public ref/);
  assert.match(html, /Direct REST reads are disabled for this viewer/);
  assert.match(html, /id="operation-ref"/);
  assert.match(html, /id="operation-variables"/);
  assert.match(html, /id="operation-contract"/);
  assert.match(html, /function operationEndpoint\(ref\)/);
  assert.match(html, /POST ' \+ endpoint/);
  assert.match(html, /No client-safe operation refs or summaries are available/);
  assert.match(html, /body: JSON\.stringify\(variables\)/);
  assert.match(html, /id="graphql-operation-name"/);
  assert.match(html, /payload\.operationName = els\.graphqlOperationName\.value\.trim\(\)/);
  assert.match(html, /function graphqlDisabledReason\(\)/);
  assert.match(html, /GraphQL is disabled by project configuration/);
  assert.match(html, /The selected resource\/store does not expose a safe SQL query capability/);
  assert.match(html, /The selected query mode does not expose a safe explain\/plan capability/);
  assert.doesNotMatch(html, /server operation templates/i);
  assert.doesNotMatch(html, /authorization/i);
  assert.doesNotMatch(html, /cookie/i);
  assert.doesNotMatch(html, /connection string/i);
});

test('web viewer renders schema logs diagnostics settings and driver summaries safely', () => {
  const html = renderDbViewer({ graphqlPath: '/graphql' });

  assert.match(html, /function schemaSummaryHtml\(resource\)/);
  assert.match(html, /schemaDisplayValue\(state\.schema\?\.resources\?\.\[state\.selected\.name\] \|\| state\.selected\)/);
  assert.match(html, /function schemaDisplayValue\(value\)/);
  assert.match(html, /filter\(\(\[key\]\) => key !== 'source'\)/);
  assert.match(html, /redactAbsolutePathText\(value\)/);
  assert.match(html, /validationText\(resource\)/);
  assert.match(html, /unknownFieldText\(resource\)/);
  assert.match(html, /defaultText\(field\)/);
  assert.match(html, /enumText\(field\)/);
  assert.match(html, /fieldFlags\(field\)/);
  assert.match(html, /uiHintText\(field\)/);
  assert.match(html, /Required<\/th><th class="[^"]+">Nullable/);
  assert.match(html, /Default<\/th><th class="[^"]+">Enum/);
  assert.match(html, /Flags<\/th><th class="[^"]+">Relation/);
  assert.match(html, /Connect Events/);
  assert.match(html, /Connect Log/);
  assert.match(html, /state\.manifest\.capabilities\?\.liveEvents !== false/);
  assert.match(html, /state\.manifest\?\.capabilities\?\.liveEvents === false/);
  assert.match(html, /function connectRuntimeLog\(\)/);
  assert.match(html, /request trace/);
  assert.match(html, /live event/);
  assert.match(html, /Import results/);
  assert.match(html, /Batch results/);
  assert.match(html, /recordImportResult\('success'/);
  assert.match(html, /recordBatchResult\(String\(response\.status\)/);
  assert.match(html, /Response formats/);
  assert.match(html, /Custom viewer links/);
  assert.match(html, /Resource store mapping/);
  assert.match(html, /Browser-local preferences/);
  assert.match(html, /function storeSummaryHtml\(\)/);
  assert.match(html, /<article class="rounded-lg border border-slate-800 bg-slate-950 p-3">/);
  assert.doesNotMatch(html, /Install plugin/i);
  assert.doesNotMatch(html, /Add driver/i);
  assert.doesNotMatch(html, /request bodies/i);
  assert.doesNotMatch(html, /response bodies/i);
  assert.doesNotMatch(html, /auth headers/i);
  assert.doesNotMatch(html, /cookie headers/i);
  assert.doesNotMatch(html, /source hashes/i);
  assert.doesNotMatch(html, /raw clients/i);
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
  assert.match(html, /<div class="grid h-screen min-h-\[640px\] grid-cols-\[52px_minmax\(240px,300px\)_minmax\(0,1fr\)\] overflow-hidden">/);
  assert.match(html, /id="context-explorer" class="min-h-0 overflow-auto border-r border-slate-800/);
  assert.match(html, /xl:grid-cols-\[minmax\(0,1\.25fr\)_minmax\(320px,0\.75fr\)\]/);
  assert.match(html, /data-tab-panel class="hidden"/);
  assert.match(html, /data-area-panel class="hidden"/);
  assert.match(html, /classList\.toggle\('hidden'/);
  assert.match(html, /showArea\(button\.dataset\.area\)/);
  assert.match(html, /data-copy-example/);
  assert.match(html, /localStorage\.setItem\('db:selectedResource'/);
  assert.match(html, /localStorage\.setItem\('db:recentResources'/);
  assert.match(html, /localStorage\.removeItem\('db:selectedResource'\)/);
  assert.match(html, /url\.searchParams\.delete\('resource'\)/);
  assert.match(html, /renderResourceApi\(\);/);
  assert.match(html, /renderResourceOperations\(\);/);
  assert.match(html, /await loadSelectedData\(\);\n      renderRestExamples\(\);\n      renderGraphqlExamples\(\);/);
  assert.match(html, /function nextRecordId\(resource\)/);
  assert.match(html, /new EventSource\(EVENTS_PATH\)/);
  assert.doesNotMatch(html, /class="(?:app|layout|toolbar|tabs|tab|viewer-grid|panel|panel-head|panel-body|stack|row|muted|code|table-wrap|example|example-head|resource-button|is-hidden)"/);
});
