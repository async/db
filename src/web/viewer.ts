type DbViewerOptions = {
  graphqlPath?: string;
  schemaPath?: string;
  manifestPath?: string;
  eventsPath?: string;
  importPath?: string;
  restBatchPath?: string;
  restBasePath?: string;
  sourceDirLabel?: string;
};

export function renderDbViewer(options: DbViewerOptions = {}): string {
  const graphqlPath = options.graphqlPath ?? '/graphql';
  const schemaPath = options.schemaPath ?? '/__db/schema';
  const manifestPath = options.manifestPath ?? '/__db/manifest.json';
  const eventsPath = options.eventsPath ?? '/__db/events';
  const importPath = options.importPath ?? '/__db/import';
  const restBatchPath = options.restBatchPath ?? '/__db/batch';
  const restBasePath = options.restBasePath ?? '';
  const sourceDirLabel = options.sourceDirLabel ?? 'db/';
  const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:translate-y-px';
  const primaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:translate-y-px';
  const tabClass = 'inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const activeTabClass = 'inline-flex min-h-10 items-center justify-center rounded-md border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const resourceButtonClass = 'inline-grid w-full gap-1 rounded-md border border-slate-300 bg-white px-3 py-3 text-left shadow-sm transition hover:border-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const activeResourceButtonClass = 'inline-grid w-full gap-1 rounded-md border border-emerald-700 bg-emerald-50 px-3 py-3 text-left shadow-sm ring-1 ring-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const panelClass = 'min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm';
  const panelHeadClass = 'flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3';
  const panelBodyClass = 'p-4';
  const stackClass = 'grid gap-3';
  const rowClass = 'flex flex-wrap items-center gap-2';
  const mutedClass = 'text-sm text-slate-500';
  const codeClass = 'min-h-12 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100';
  const textareaClass = 'min-h-40 w-full resize-y rounded-md border border-slate-300 bg-white p-3 font-mono text-sm text-slate-950 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const inputClass = 'min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const selectClass = 'min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const viewerGridClass = 'grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]';
  const tableWrapClass = 'overflow-auto rounded-md border border-slate-200';
  const tableClass = 'w-full min-w-[480px] border-collapse bg-white';
  const thClass = 'sticky top-0 border-b border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-600';
  const tdClass = 'max-w-[360px] border-b border-slate-200 px-3 py-2 align-top font-mono text-xs text-slate-800 break-words';
  const exampleClass = 'grid gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm';
  const exampleHeadClass = 'flex flex-wrap items-center justify-between gap-2';
  const pillClass = 'inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600';
  const warningPillClass = 'inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700';
  const errorPillClass = 'inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700';
  const importDropClass = 'mt-4 rounded-lg border-2 border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600 shadow-sm transition';
  const importDropActiveClass = 'mt-4 rounded-lg border-2 border-dashed border-emerald-500 bg-emerald-50 p-4 text-sm text-emerald-800 shadow-sm transition';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>db viewer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body class="bg-slate-50 text-slate-950 antialiased">
  <div class="grid min-h-screen grid-rows-[auto_1fr]">
    <header class="flex flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-lg font-bold tracking-normal text-slate-950">db viewer</h1>
        <div class="${mutedClass}" id="subtitle">Loading local fixture database</div>
      </div>
      <div class="${rowClass} sm:justify-end" id="status"></div>
    </header>
    <div class="grid min-h-0 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
      <aside class="max-h-72 overflow-auto border-b border-slate-200 bg-slate-50 p-4 lg:max-h-none lg:border-b-0 lg:border-r">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-base font-bold tracking-normal text-slate-950">Resources</h2>
          <button type="button" id="refresh" class="${buttonClass}">Refresh</button>
        </div>
        <div id="resource-list" class="grid gap-2"></div>
        <div id="csv-drop" class="${importDropClass}">
          <div class="font-semibold text-slate-800">Import CSV</div>
          <p class="mb-3 mt-1 text-xs text-slate-500">Drop a CSV file here to copy it into ${escapeHtml(sourceDirLabel)}, sync the mirror, and open the new resource.</p>
          <button type="button" id="csv-pick" class="${buttonClass}">Choose CSV</button>
          <input id="csv-file" type="file" accept=".csv,text/csv" class="hidden">
          <div id="csv-import-status" class="mt-3 text-xs text-slate-500"></div>
        </div>
      </aside>
      <main class="min-w-0 overflow-auto p-5">
        <div id="diagnostics-view" class="mb-4 hidden"></div>
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="resource-title" class="text-base font-bold tracking-normal text-slate-950">Select a resource</h2>
            <div class="${mutedClass}" id="resource-detail"></div>
          </div>
          <div class="${rowClass}" role="tablist" aria-label="db viewer sections">
            <button type="button" class="${activeTabClass}" data-tab="data">Data</button>
            <button type="button" class="${tabClass}" data-tab="rest">REST</button>
            <button type="button" class="${tabClass}" data-tab="graphql">GraphQL</button>
            <button type="button" class="${tabClass}" data-tab="schema">Schema</button>
          </div>
        </div>

        <section id="tab-data" data-tab-panel>
          <div class="${viewerGridClass}">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-950">Data</h3>
                <button type="button" id="reload-data" class="${buttonClass}">Reload</button>
              </div>
              <div class="${panelBodyClass}" id="data-view"></div>
            </div>
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-950">Selected JSON</h3>
                <button type="button" data-copy-target="json-output" class="${buttonClass}">Copy</button>
              </div>
              <div class="${panelBodyClass}">
                <pre id="json-output" class="${codeClass}">{}</pre>
              </div>
            </div>
          </div>
        </section>

        <section id="tab-rest" data-tab-panel class="hidden">
          <div class="${viewerGridClass}">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-950">REST Specs</h3>
              </div>
              <div class="${panelBodyClass} ${stackClass}">
                <p class="m-0 text-sm text-slate-600">Batch requests run sequentially. Earlier successful writes stay committed if a later item fails.</p>
                <div class="${stackClass}" id="rest-examples"></div>
              </div>
            </div>
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-950">REST Runner</h3>
              </div>
              <div class="${panelBodyClass} ${stackClass}">
                <div class="grid items-center gap-2 sm:grid-cols-[auto_minmax(180px,1fr)_auto]">
                  <select id="rest-method" aria-label="REST method" class="${selectClass}">
                    <option>GET</option>
                    <option>POST</option>
                    <option>PATCH</option>
                    <option>PUT</option>
                    <option>DELETE</option>
                  </select>
                  <input id="rest-path" class="${inputClass}" aria-label="REST path" value="/">
                  <button type="button" class="${primaryButtonClass}" id="run-rest">Run</button>
                </div>
                <textarea id="rest-body" class="${textareaClass}" aria-label="REST request body">{}</textarea>
                <pre id="rest-output" class="${codeClass}">{}</pre>
              </div>
            </div>
          </div>
        </section>

        <section id="tab-graphql" data-tab-panel class="hidden">
          <div class="${viewerGridClass}">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-950">GraphQL Examples</h3>
              </div>
              <div class="${panelBodyClass} ${stackClass}" id="graphql-examples"></div>
            </div>
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-950">GraphQL Runner</h3>
                <button type="button" data-copy-target="graphql-query" class="${buttonClass}">Copy Query</button>
              </div>
              <div class="${panelBodyClass} ${stackClass}">
                <textarea id="graphql-query" class="${textareaClass}" aria-label="GraphQL query"></textarea>
                <textarea id="graphql-variables" class="${textareaClass}" aria-label="GraphQL variables">{}</textarea>
                <div class="${rowClass}">
                  <button type="button" class="${primaryButtonClass}" id="run-graphql">Run GraphQL</button>
                  <button type="button" id="load-sdl" class="${buttonClass}">Load SDL</button>
                </div>
                <pre id="graphql-output" class="${codeClass}">{}</pre>
              </div>
            </div>
          </div>
        </section>

        <section id="tab-schema" data-tab-panel class="hidden">
          <div class="${viewerGridClass}">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-950">Fields</h3>
              </div>
              <div class="${panelBodyClass}" id="field-view"></div>
            </div>
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-950">Generated Schema</h3>
                <button type="button" data-copy-target="schema-output" class="${buttonClass}">Copy</button>
              </div>
              <div class="${panelBodyClass}">
                <pre id="schema-output" class="${codeClass}">{}</pre>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>

  <script>
    const GRAPHQL_PATH = ${JSON.stringify(graphqlPath)};
    const SCHEMA_PATH = ${JSON.stringify(schemaPath)};
    const MANIFEST_PATH = ${JSON.stringify(manifestPath)};
    const EVENTS_PATH = ${JSON.stringify(eventsPath)};
    const IMPORT_PATH = ${JSON.stringify(importPath)};
    const REST_BATCH_PATH = ${JSON.stringify(restBatchPath)};
    const REST_BASE_PATH = ${JSON.stringify(restBasePath)};
    const BUTTON_CLASS = ${JSON.stringify(buttonClass)};
    const TAB_CLASS = ${JSON.stringify(tabClass)};
    const ACTIVE_TAB_CLASS = ${JSON.stringify(activeTabClass)};
    const RESOURCE_BUTTON_CLASS = ${JSON.stringify(resourceButtonClass)};
    const ACTIVE_RESOURCE_BUTTON_CLASS = ${JSON.stringify(activeResourceButtonClass)};
    const PILL_CLASS = ${JSON.stringify(pillClass)};
    const WARNING_PILL_CLASS = ${JSON.stringify(warningPillClass)};
    const ERROR_PILL_CLASS = ${JSON.stringify(errorPillClass)};
    const IMPORT_DROP_CLASS = ${JSON.stringify(importDropClass)};
    const IMPORT_DROP_ACTIVE_CLASS = ${JSON.stringify(importDropActiveClass)};
    const CODE_CLASS = ${JSON.stringify(codeClass)};
    const MUTED_CLASS = ${JSON.stringify(mutedClass)};
    const TABLE_WRAP_CLASS = ${JSON.stringify(tableWrapClass)};
    const TABLE_CLASS = ${JSON.stringify(tableClass)};
    const TH_CLASS = ${JSON.stringify(thClass)};
    const TD_CLASS = ${JSON.stringify(tdClass)};
    const EXAMPLE_CLASS = ${JSON.stringify(exampleClass)};
    const EXAMPLE_HEAD_CLASS = ${JSON.stringify(exampleHeadClass)};
    const ROW_CLASS = ${JSON.stringify(rowClass)};
    const state = {
      manifest: null,
      schema: null,
      resources: [],
      selected: null,
      selectedData: null,
    };

    const els = {
      subtitle: document.getElementById('subtitle'),
      status: document.getElementById('status'),
      resources: document.getElementById('resource-list'),
      refresh: document.getElementById('refresh'),
      reloadData: document.getElementById('reload-data'),
      resourceTitle: document.getElementById('resource-title'),
      resourceDetail: document.getElementById('resource-detail'),
      dataView: document.getElementById('data-view'),
      jsonOutput: document.getElementById('json-output'),
      restExamples: document.getElementById('rest-examples'),
      restMethod: document.getElementById('rest-method'),
      restPath: document.getElementById('rest-path'),
      restBody: document.getElementById('rest-body'),
      restOutput: document.getElementById('rest-output'),
      graphqlExamples: document.getElementById('graphql-examples'),
      graphqlQuery: document.getElementById('graphql-query'),
      graphqlVariables: document.getElementById('graphql-variables'),
      graphqlOutput: document.getElementById('graphql-output'),
      loadSdl: document.getElementById('load-sdl'),
      fieldView: document.getElementById('field-view'),
      schemaOutput: document.getElementById('schema-output'),
      diagnosticsView: document.getElementById('diagnostics-view'),
      csvDrop: document.getElementById('csv-drop'),
      csvPick: document.getElementById('csv-pick'),
      csvFile: document.getElementById('csv-file'),
      csvImportStatus: document.getElementById('csv-import-status'),
    };

    document.addEventListener('click', async (event) => {
      const copyButton = event.target.closest('[data-copy-target]');
      if (copyButton) {
        await copyText(document.getElementById(copyButton.dataset.copyTarget).textContent);
      }

      const exampleButton = event.target.closest('[data-load-example]');
      if (exampleButton) {
        loadExample(JSON.parse(exampleButton.dataset.loadExample));
      }

      const resourceButton = event.target.closest('[data-resource]');
      if (resourceButton) {
        await selectResource(resourceButton.dataset.resource);
      }
    });

    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => showTab(button.dataset.tab));
    });

    els.refresh.addEventListener('click', boot);
    els.reloadData.addEventListener('click', () => loadSelectedData());
    document.getElementById('run-rest').addEventListener('click', runRest);
    document.getElementById('run-graphql').addEventListener('click', runGraphql);
    els.loadSdl.addEventListener('click', loadGraphqlSdl);
    els.csvPick.addEventListener('click', () => els.csvFile.click());
    els.csvFile.addEventListener('change', () => importCsvFile(els.csvFile.files[0]));
    for (const eventName of ['dragenter', 'dragover']) {
      els.csvDrop.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.csvDrop.className = IMPORT_DROP_ACTIVE_CLASS;
      });
    }
    for (const eventName of ['dragleave', 'drop']) {
      els.csvDrop.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.csvDrop.className = IMPORT_DROP_CLASS;
      });
    }
    els.csvDrop.addEventListener('drop', (event) => {
      importCsvFile(event.dataTransfer?.files?.[0]);
    });

    boot().catch(showFatal);
    connectLiveReload();

    async function boot(preferredResourceName) {
      const [manifest, schema] = await Promise.all([
        fetchJson(MANIFEST_PATH),
        fetchJson(SCHEMA_PATH),
      ]);
      state.manifest = manifest;
      state.schema = schema;
      state.resources = [
        ...Object.entries(manifest.collections || {}).map(([name, resource]) => ({ name, ...resource })),
        ...Object.entries(manifest.documents || {}).map(([name, resource]) => ({ name, ...resource })),
      ];
      renderStatus();
      renderDiagnostics();
      renderResourceList();
      els.subtitle.textContent = state.resources.length + ' resources loaded';
      const resourceName = resolveInitialResourceName(preferredResourceName);
      if (resourceName) {
        await selectResource(resourceName);
      }
    }

    async function selectResource(name) {
      const resourceName = resolveResourceName(name);
      state.selected = state.resources.find((resource) => resource.name === resourceName);
      if (!state.selected) {
        return;
      }
      rememberResource(resourceName);

      document.querySelectorAll('[data-resource]').forEach((button) => {
        button.className = button.dataset.resource === resourceName ? ACTIVE_RESOURCE_BUTTON_CLASS : RESOURCE_BUTTON_CLASS;
      });

      els.resourceTitle.textContent = state.selected.name;
      els.resourceDetail.textContent = state.selected.kind + ' · ' + state.selected.typeName + routeText(state.selected);
      renderFields();
      els.schemaOutput.textContent = pretty(state.schema?.resources?.[state.selected.name] || state.selected);
      await loadSelectedData();
      renderRestExamples();
      renderGraphqlExamples();
    }

    async function loadSelectedData() {
      if (!state.selected) {
        return;
      }

      const response = await fetch(resourcePath(state.selected));
      if (!response.ok) {
        throw new Error('Could not load ' + state.selected.name + ': ' + response.status + ' ' + response.statusText);
      }
      state.selectedData = await response.json();
      els.jsonOutput.textContent = pretty(state.selectedData);
      renderData();
    }

    function renderStatus() {
      const diagnostics = state.manifest.diagnostics || [];
      const errors = diagnostics.filter((item) => item.severity === 'error').length;
      const warnings = diagnostics.filter((item) => item.severity === 'warn').length;
      els.status.innerHTML = '';
      els.status.append(
        pill(state.resources.length + ' resources'),
        pill('REST ready'),
        pill(state.manifest.capabilities?.graphql === false ? 'GraphQL off' : 'GraphQL ready'),
        pill(errors + ' errors', errors > 0 ? 'error' : ''),
        pill(warnings + ' warnings', warnings > 0 ? 'warning' : ''),
      );
    }

    function renderDiagnostics() {
      const diagnostics = state.manifest.diagnostics || [];
      if (diagnostics.length === 0) {
        els.diagnosticsView.className = 'mb-4 hidden';
        els.diagnosticsView.innerHTML = '';
        return;
      }

      els.diagnosticsView.className = 'mb-4 grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm';
      els.diagnosticsView.innerHTML = '';
      const heading = document.createElement('div');
      heading.className = 'font-bold';
      heading.textContent = 'Source diagnostics';
      els.diagnosticsView.append(heading);

      for (const diagnostic of diagnostics) {
        const item = document.createElement('div');
        item.className = diagnostic.severity === 'error'
          ? 'rounded-md border border-red-200 bg-white p-3 text-red-900'
          : 'rounded-md border border-amber-200 bg-white p-3 text-amber-900';
        const fileText = diagnostic.file ? diagnostic.file + ': ' : '';
        item.textContent = fileText + diagnostic.message + (diagnostic.hint ? ' ' + diagnostic.hint : '');
        els.diagnosticsView.append(item);
      }
    }

    function renderResourceList() {
      els.resources.innerHTML = '';
      for (const resource of state.resources) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = RESOURCE_BUTTON_CLASS;
        button.dataset.resource = resource.name;
        button.innerHTML = '<span data-resource-name class="font-semibold text-slate-950"></span><span data-resource-meta class="text-xs text-slate-500"></span>';
        button.querySelector('[data-resource-name]').textContent = resource.name;
        button.querySelector('[data-resource-meta]').textContent = resource.kind + ' · ' + Object.keys(resource.fields || {}).length + ' fields';
        els.resources.append(button);
      }
    }

    function renderData() {
      const data = state.selectedData;
      if (Array.isArray(data)) {
        els.dataView.innerHTML = renderTable(data, state.selected);
        return;
      }

      els.dataView.innerHTML = '<pre class="' + CODE_CLASS + '"></pre>';
      els.dataView.querySelector('pre').textContent = pretty(data);
    }

    function renderTable(records, resource) {
      if (records.length === 0) {
        return '<div class="' + MUTED_CLASS + '">[]</div>';
      }

      const columns = Array.from(records.reduce((set, record) => {
        Object.keys(record || {}).forEach((key) => set.add(key));
        return set;
      }, new Set()));

      const head = columns.map((column) => '<th class="' + TH_CLASS + '">' + escapeHtml(column) + '</th>').join('');
      const rows = records.map((record) => '<tr>' + columns.map((column) => '<td class="' + TD_CLASS + '">' + cellHtml(resource, record, column) + '</td>').join('') + '</tr>').join('');
      return '<div class="' + TABLE_WRAP_CLASS + '"><table class="' + TABLE_CLASS + '"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function renderRestExamples() {
      const examples = restExamplesFor(state.selected);
      els.restExamples.innerHTML = '';
      for (const example of examples) {
        els.restExamples.append(exampleView(example, 'rest'));
      }
      if (examples[0]) {
        loadExample({ kind: 'rest', ...examples[0] });
      }
    }

    function renderGraphqlExamples() {
      const examples = graphqlExamplesFor(state.selected);
      els.graphqlExamples.innerHTML = '';
      for (const example of examples) {
        els.graphqlExamples.append(exampleView(example, 'graphql'));
      }
      if (examples[0]) {
        loadExample({ kind: 'graphql', ...examples[0] });
      }
    }

    function renderFields() {
      const rows = Object.entries(state.selected.fields || {}).map(([name, field]) => {
        return '<tr><td class="' + TD_CLASS + '">' + escapeHtml(name) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(fieldType(field)) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(field.required ? 'yes' : 'no') + '</td><td class="' + TD_CLASS + '">' + escapeHtml(relationTextForField(name)) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(field.description || '') + '</td></tr>';
      }).join('');
      els.fieldView.innerHTML = relationSummary(state.selected) + '<div class="' + TABLE_WRAP_CLASS + '"><table class="' + TABLE_CLASS + '"><thead><tr><th class="' + TH_CLASS + '">Field</th><th class="' + TH_CLASS + '">Type</th><th class="' + TH_CLASS + '">Required</th><th class="' + TH_CLASS + '">Relation</th><th class="' + TH_CLASS + '">Description</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function exampleView(example, kind) {
      const element = document.createElement('div');
      element.className = EXAMPLE_CLASS;
      const copyText = kind === 'rest' ? restCopyText(example) : example.query;
      const payload = JSON.stringify({ kind, ...example });
      element.innerHTML = '<div class="' + EXAMPLE_HEAD_CLASS + '"><div><strong class="text-sm font-semibold text-slate-950"></strong><div data-example-meta class="' + MUTED_CLASS + '"></div></div><div class="' + ROW_CLASS + '"><button type="button" data-load-example="">Load</button><button type="button" data-copy-example>Copy</button></div></div><pre class="' + CODE_CLASS + '"></pre>';
      element.querySelector('strong').textContent = example.name;
      element.querySelector('[data-example-meta]').textContent = kind === 'rest' ? example.method + ' ' + example.path : 'GraphQL';
      element.querySelector('[data-load-example]').dataset.loadExample = payload;
      element.querySelectorAll('button').forEach((button) => {
        button.className = BUTTON_CLASS;
      });
      element.querySelector('[data-copy-example]').addEventListener('click', () => copyTextToClipboard(copyText));
      element.querySelector('pre').textContent = copyText;
      return element;
    }

    function loadExample(example) {
      if (example.kind === 'rest') {
        els.restMethod.value = example.method;
        els.restPath.value = example.path;
        els.restBody.value = example.body === undefined ? '{}' : pretty(example.body);
      } else {
        els.graphqlQuery.value = example.query;
        els.graphqlVariables.value = pretty(example.variables || {});
      }
    }

    async function runRest() {
      const method = els.restMethod.value;
      const options = { method, headers: { 'content-type': 'application/json' } };
      if (!['GET', 'DELETE'].includes(method)) {
        options.body = els.restBody.value.trim() || '{}';
      }
      const response = await fetch(els.restPath.value, options);
      const text = await response.text();
      els.restOutput.textContent = response.status + ' ' + response.statusText + '\\n' + formatJsonText(text);
      await loadSelectedData();
    }

    async function runGraphql() {
      const response = await fetch(GRAPHQL_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: els.graphqlQuery.value,
          variables: parseJson(els.graphqlVariables.value, {}),
        }),
      });
      const json = await response.json();
      els.graphqlOutput.textContent = pretty(json);
      await loadSelectedData();
    }

    async function loadGraphqlSdl() {
      const response = await fetch(GRAPHQL_PATH);
      els.graphqlOutput.textContent = await response.text();
    }

    function restExamplesFor(resource) {
      const path = resourcePath(resource);
      if (resource.kind === 'document') {
        return [
          { name: 'Read document', method: 'GET', path },
          { name: 'Replace document', method: 'PUT', path, body: sampleDocument(resource) },
          { name: 'Patch document', method: 'PATCH', path, body: samplePatch(resource) },
        ];
      }

      const id = sampleId(resource);
      const examples = [
        { name: 'List records', method: 'GET', path },
        { name: 'List selected fields', method: 'GET', path: path + '?select=' + encodeURIComponent(selectExampleFields(resource).join(',')) },
        { name: 'List page', method: 'GET', path: path + '?offset=0&limit=20' },
        { name: 'Read record', method: 'GET', path: path + '/' + encodeURIComponent(id) },
        { name: 'Create record', method: 'POST', path, body: sampleRecord(resource, { id: nextRecordId(resource) }) },
        { name: 'Patch record', method: 'PATCH', path: path + '/' + encodeURIComponent(id), body: samplePatch(resource) },
        { name: 'Delete record', method: 'DELETE', path: path + '/' + encodeURIComponent(id) },
        { name: 'Batch list and schema', method: 'POST', path: REST_BATCH_PATH, body: [{ method: 'GET', path }, { method: 'GET', path: SCHEMA_PATH }] },
      ];
      examples.splice(4, 0, ...relationRestExamples(resource, id));
      return examples;
    }

    function graphqlExamplesFor(resource) {
      const fields = selectionFields(resource);
      if (resource.kind === 'document') {
        return [
          { name: 'Read document', query: '{\\n  ' + resource.name + ' {\\n' + fields + '\\n  }\\n}' },
          { name: 'Patch document', query: 'mutation {\\n  update' + resource.typeName + '(patch: ' + inlineObject(samplePatch(resource)) + ') {\\n' + fields + '\\n  }\\n}' },
          { name: 'Set value', query: 'mutation {\\n  set' + resource.typeName + '(path: "/theme", value: "dark") {\\n' + fields + '\\n  }\\n}' },
        ];
      }

      const singular = lowerFirst(resource.typeName);
      return [
        { name: 'List records', query: '{\\n  ' + resource.name + ' {\\n' + fields + '\\n  }\\n}' },
        { name: 'Read record', query: 'query Get' + resource.typeName + '($id: ID!) {\\n  ' + singular + '(id: $id) {\\n' + fields + '\\n  }\\n}', variables: { id: sampleId(resource) } },
        { name: 'Create record', query: 'mutation Create' + resource.typeName + '($input: JSON!) {\\n  create' + resource.typeName + '(input: $input) {\\n' + fields + '\\n  }\\n}', variables: { input: sampleRecord(resource, { id: nextRecordId(resource) }) } },
        { name: 'Patch record', query: 'mutation {\\n  update' + resource.typeName + '(id: "' + sampleId(resource) + '", patch: ' + inlineObject(samplePatch(resource)) + ') {\\n' + fields + '\\n  }\\n}' },
        { name: 'Delete record', query: 'mutation {\\n  delete' + resource.typeName + '(id: "' + sampleId(resource) + '")\\n}' },
      ];
    }

    function sampleRecord(resource, options = {}) {
      const record = {};
      for (const [name, field] of Object.entries(resource.fields || {})) {
        record[name] = name === resource.idField && options.id !== undefined
          ? options.id
          : sampleValue(name, field, resource);
      }
      return record;
    }

    function sampleDocument(resource) {
      return sampleRecord(resource);
    }

    function samplePatch(resource) {
      const entries = Object.entries(resource.fields || {}).filter(([name]) => name !== resource.idField);
      if (entries.length === 0) {
        return {};
      }
      const [name, field] = entries[0];
      return { [name]: sampleValue(name, field, resource) };
    }

    function sampleValue(name, field, resource) {
      if (name === resource.idField) {
        return sampleId(resource);
      }
      if ('default' in field) {
        return field.default;
      }
      if (field.type === 'enum') {
        return (field.values || [])[0] || 'value';
      }
      if (field.type === 'number') {
        return 1;
      }
      if (field.type === 'boolean') {
        return true;
      }
      if (field.type === 'array') {
        return [];
      }
      if (field.type === 'object') {
        return {};
      }
      return sampleString(name);
    }

    function sampleString(name) {
      if (name.toLowerCase().includes('email')) {
        return 'user@example.com';
      }
      if (name.toLowerCase().endsWith('at')) {
        return new Date().toISOString();
      }
      return name + '-value';
    }

    function sampleId(resource) {
      const data = state.selected?.name === resource.name ? state.selectedData : null;
      if (Array.isArray(data) && data[0] && data[0][resource.idField] !== undefined) {
        return data[0][resource.idField];
      }
      return resource.name + '_1';
    }

    function selectExampleFields(resource) {
      const names = Object.keys(resource.fields || {}).slice(0, 3);
      return names.length > 0 ? names : [resource.idField || 'id'];
    }

    function relationRestExamples(resource, id) {
      const relation = (resource.relations || [])[0];
      if (!relation) {
        return [];
      }

      const target = state.resources.find((candidate) => candidate.name === relation.targetResource);
      const targetField = Object.keys(target?.fields || {}).find((name) => name !== target.idField) || relation.targetField;
      const baseFields = selectExampleFields(resource).filter((name) => !name.includes('.')).slice(0, 2);
      return [
        { name: 'List with ' + relation.name, method: 'GET', path: resourcePath(resource) + '?expand=' + encodeURIComponent(relation.name) },
        { name: 'Read selected ' + relation.name, method: 'GET', path: resourcePath(resource) + '/' + encodeURIComponent(id) + '?expand=' + encodeURIComponent(relation.name) + '&select=' + encodeURIComponent([...baseFields, relation.name + '.' + targetField].join(',')) },
      ];
    }

    function nextRecordId(resource) {
      const data = state.selected?.name === resource.name && Array.isArray(state.selectedData)
        ? state.selectedData
        : [];
      const ids = data
        .map((record) => record?.[resource.idField])
        .filter((id) => id !== undefined && id !== null && id !== '')
        .map((id) => String(id));
      const sample = ids[0];
      const match = sample?.match(/^(.*?)(\\d+)$/);

      if (match) {
        const prefix = match[1];
        const next = ids.reduce((max, id) => {
          const current = id.match(/^(.*?)(\\d+)$/);
          return current && current[1] === prefix ? Math.max(max, Number(current[2])) : max;
        }, Number(match[2])) + 1;
        return prefix + next;
      }

      return String(ids.length + 1);
    }

    function selectionFields(resource) {
      const fieldNames = Object.keys(resource.fields || {}).slice(0, 6);
      if (fieldNames.length === 0) {
        return '    __typename';
      }
      return fieldNames.map((name) => '    ' + name).join('\\n');
    }

    function resourcePath(resource) {
      if (resource.api?.list) {
        return resource.api.list;
      }
      if (resource.api?.read) {
        return resource.api.read;
      }
      return joinPaths(REST_BASE_PATH, resource.routePath || '/' + resource.name);
    }

    function relationForField(resource, fieldName) {
      return (resource?.relations || []).find((relation) => relation.sourceField === fieldName) || null;
    }

    function relationTextForField(fieldName) {
      const relation = relationForField(state.selected, fieldName);
      return relation ? relation.name + ' -> ' + relation.targetResource + '.' + relation.targetField : '';
    }

    function relationSummary(resource) {
      const relations = resource?.relations || [];
      if (relations.length === 0) {
        return '<div class="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600"><strong class="text-slate-900">Relations</strong><div>No explicit relations declared.</div></div>';
      }

      const rows = relations.map((relation) => '<tr><td class="' + TD_CLASS + '">' + escapeHtml(relation.name) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(relation.sourceField) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(relation.targetResource + '.' + relation.targetField) + '</td><td class="' + TD_CLASS + '"><code>expand=' + escapeHtml(relation.name) + '</code></td></tr>').join('');
      return '<div class="mb-3"><h4 class="mb-2 text-sm font-bold tracking-normal text-slate-950">Relations</h4><div class="' + TABLE_WRAP_CLASS + '"><table class="' + TABLE_CLASS + '"><thead><tr><th class="' + TH_CLASS + '">Name</th><th class="' + TH_CLASS + '">Source</th><th class="' + TH_CLASS + '">Target</th><th class="' + TH_CLASS + '">REST</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }

    function cellHtml(resource, record, column) {
      const relation = relationForField(resource, column);
      const value = record?.[column];
      if (!relation || value === undefined || value === null || value === '') {
        return escapeHtml(formatCell(value));
      }

      const target = state.resources.find((candidate) => candidate.name === relation.targetResource);
      const targetPath = target ? resourcePath(target) : joinPaths(REST_BASE_PATH, '/' + relation.targetResource);
      const href = targetPath + '/' + encodeURIComponent(value);
      return '<a data-relation-link href="' + escapeHtml(href) + '" class="font-semibold text-emerald-700 hover:underline">' + escapeHtml(formatCell(value)) + '</a>';
    }

    function routeText(resource) {
      return ' · ' + resourcePath(resource);
    }

    function restCopyText(example) {
      const lines = [example.method + ' ' + example.path];
      if (example.body !== undefined) {
        lines.push('', pretty(example.body));
      }
      return lines.join('\\n');
    }

    function resolveInitialResourceName(preferredResourceName) {
      const preferred = resolveResourceName(preferredResourceName);
      if (preferred) {
        return preferred;
      }

      const params = new URLSearchParams(window.location.search);
      const queryResource = params.get('resource');
      if (queryResource) {
        const resolvedQueryResource = resolveResourceName(queryResource);
        if (resolvedQueryResource) {
          return resolvedQueryResource;
        }
        clearRememberedResource(true);
        return state.resources[0]?.name;
      }

      const storedResource = localStorage.getItem('db:selectedResource');
      if (storedResource) {
        const resolvedStoredResource = resolveResourceName(storedResource);
        if (resolvedStoredResource) {
          return resolvedStoredResource;
        }
        clearRememberedResource(false);
      }

      if (state.selected?.name && hasResource(state.selected.name)) {
        return state.selected.name;
      }

      return state.resources[0]?.name;
    }

    function hasResource(name) {
      return Boolean(resolveResourceName(name));
    }

    function resolveResourceName(name) {
      if (!name) {
        return null;
      }
      for (const candidate of resourceNameCandidates(name)) {
        if (state.resources.some((resource) => resource.name === candidate)) {
          return candidate;
        }
      }
      return null;
    }

    function resourceNameCandidates(value) {
      const exact = String(value);
      return [...new Set([exact, camelCase(exact), kebabCase(exact)])];
    }

    function camelCase(value) {
      return words(value).map((word, index) => (
        index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
      )).join('');
    }

    function kebabCase(value) {
      return words(value).join('-');
    }

    function words(value) {
      return String(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part) => part.toLowerCase());
    }

    function rememberResource(name) {
      localStorage.setItem('db:selectedResource', name);
      const url = new URL(window.location.href);
      url.searchParams.set('resource', name);
      window.history.replaceState({}, '', url);
    }

    function clearRememberedResource(clearQuery) {
      localStorage.removeItem('db:selectedResource');
      if (clearQuery) {
        const url = new URL(window.location.href);
        url.searchParams.delete('resource');
        window.history.replaceState({}, '', url);
      }
    }

    function connectLiveReload() {
      if (!window.EventSource) {
        return;
      }

      const events = new EventSource(EVENTS_PATH);
      events.addEventListener('db', (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === 'connected') {
          return;
        }

        const selectedName = state.selected?.name;
        els.subtitle.textContent = payload.type === 'synced-with-errors'
          ? 'Files changed; reloaded with source errors'
          : 'Files changed; reloaded';
        boot(selectedName).catch(showFatal);
      });
    }

    async function importCsvFile(file) {
      if (!file) {
        return;
      }

      if (!file.name.toLowerCase().endsWith('.csv')) {
        setImportStatus('Choose a .csv file.', 'error');
        return;
      }

      setImportStatus('Importing ' + file.name + '...', 'loading');
      try {
        const response = await fetch(IMPORT_PATH, {
          method: 'POST',
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'x-db-file-name': file.name,
          },
          body: file,
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error?.message || 'CSV import failed.');
        }

        setImportStatus('Imported ' + result.dataPath + ' and opened ' + result.resource + '.', 'success');
        await boot(result.resource);
        showTab('data');
      } catch (error) {
        setImportStatus(error.message, 'error');
      } finally {
        els.csvFile.value = '';
      }
    }

    function setImportStatus(message, kind) {
      els.csvImportStatus.textContent = message;
      els.csvImportStatus.className = kind === 'error'
        ? 'mt-3 text-xs font-medium text-red-700'
        : kind === 'success'
          ? 'mt-3 text-xs font-medium text-emerald-700'
          : 'mt-3 text-xs text-slate-500';
    }

    function showTab(name) {
      document.querySelectorAll('[data-tab]').forEach((button) => {
        button.className = button.dataset.tab === name ? ACTIVE_TAB_CLASS : TAB_CLASS;
      });
      document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
        panel.classList.toggle('hidden', panel.id !== 'tab-' + name);
      });
    }

    function fieldType(field) {
      const suffix = field.nullable ? ' | null' : '';
      if (field.type === 'enum') {
        return 'enum(' + (field.values || []).join(', ') + ')' + suffix;
      }
      if (field.type === 'array') {
        return 'array<' + fieldType(field.items || { type: 'unknown' }) + '>' + suffix;
      }
      return (field.type || 'unknown') + suffix;
    }

    function inlineObject(value) {
      return JSON.stringify(value).replace(/"([^"]+)":/g, '$1:');
    }

    function lowerFirst(value) {
      return value.charAt(0).toLowerCase() + value.slice(1);
    }

    function parseJson(text, fallback) {
      try {
        return text.trim() ? JSON.parse(text) : fallback;
      } catch (error) {
        return fallback;
      }
    }

    function formatJsonText(text) {
      try {
        return pretty(JSON.parse(text));
      } catch {
        return text;
      }
    }

    function formatCell(value) {
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    }

    function pretty(value) {
      return JSON.stringify(value, null, 2);
    }

    function pill(text, className) {
      const element = document.createElement('span');
      element.className = className === 'error'
        ? ERROR_PILL_CLASS
        : className === 'warning'
          ? WARNING_PILL_CLASS
          : PILL_CLASS;
      element.textContent = text;
      return element;
    }

    async function fetchJson(path) {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error('Request failed: ' + response.status + ' ' + path);
      }
      return response.json();
    }

    function joinPaths(basePath, routePath) {
      if (!basePath) {
        return routePath;
      }

      const base = '/' + String(basePath).replace(/^\\/+/, '').replace(/\\/+$/, '');
      const route = '/' + String(routePath || '/').replace(/^\\/+/, '');
      return base + (route === '/' ? '' : route);
    }

    async function copyText(text) {
      await copyTextToClipboard(text);
    }

    async function copyTextToClipboard(text) {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function showFatal(error) {
      els.subtitle.textContent = 'Unable to load db viewer';
      els.dataView.innerHTML = '<pre class="' + CODE_CLASS + '"></pre>';
      els.dataView.querySelector('pre').textContent = error.stack || error.message;
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
