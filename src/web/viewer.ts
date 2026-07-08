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
  const buttonClass = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 shadow-sm transition hover:border-cyan-500 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:translate-y-px';
  const primaryButtonClass = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-cyan-500 bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 active:translate-y-px';
  const tabClass = 'inline-flex min-h-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-300 shadow-sm transition hover:border-cyan-500 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400';
  const activeTabClass = 'inline-flex min-h-9 items-center justify-center rounded-md border border-cyan-500 bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300';
  const appRailButtonClass = 'grid h-11 w-11 place-items-center rounded-md border border-transparent bg-transparent text-xs font-bold text-slate-400 transition hover:border-slate-700 hover:bg-slate-900 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400';
  const activeAppRailButtonClass = 'grid h-11 w-11 place-items-center rounded-md border border-cyan-500 bg-cyan-500 text-xs font-bold text-slate-950 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300';
  const resourceButtonClass = 'inline-grid w-full gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-3 text-left shadow-sm transition hover:border-cyan-500 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400';
  const activeResourceButtonClass = 'inline-grid w-full gap-2 rounded-md border border-cyan-500 bg-cyan-950/70 px-3 py-3 text-left shadow-sm ring-1 ring-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300';
  const panelClass = 'min-w-0 rounded-lg border border-slate-800 bg-slate-900/80 shadow-sm';
  const panelHeadClass = 'flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3';
  const panelBodyClass = 'p-4';
  const stackClass = 'grid gap-3';
  const rowClass = 'flex flex-wrap items-center gap-2';
  const mutedClass = 'text-sm text-slate-400';
  const codeClass = 'min-h-12 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100';
  const textareaClass = 'min-h-40 w-full resize-y rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-slate-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400';
  const inputClass = 'min-h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 shadow-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400';
  const selectClass = 'min-h-9 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400';
  const viewerGridClass = 'grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]';
  const tableWrapClass = 'overflow-auto rounded-md border border-slate-800';
  const tableClass = 'w-full min-w-[480px] border-collapse bg-slate-950';
  const thClass = 'sticky top-0 border-b border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs font-semibold text-slate-300';
  const tdClass = 'max-w-[360px] border-b border-slate-800 px-3 py-2 align-top font-mono text-xs text-slate-200 break-words';
  const exampleClass = 'grid gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 shadow-sm';
  const exampleHeadClass = 'flex flex-wrap items-center justify-between gap-2';
  const pillClass = 'inline-flex items-center rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-300';
  const warningPillClass = 'inline-flex items-center rounded-full border border-amber-400/60 bg-amber-950/50 px-2.5 py-1 text-xs font-medium text-amber-200';
  const errorPillClass = 'inline-flex items-center rounded-full border border-red-400/60 bg-red-950/50 px-2.5 py-1 text-xs font-medium text-red-200';
  const importDropClass = 'mt-4 rounded-lg border-2 border-dashed border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-400 shadow-sm transition';
  const importDropActiveClass = 'mt-4 rounded-lg border-2 border-dashed border-cyan-500 bg-cyan-950/50 p-4 text-sm text-cyan-100 shadow-sm transition';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>db viewer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body class="bg-slate-950 text-slate-100 antialiased">
  <div class="grid h-screen min-h-[640px] grid-cols-[52px_minmax(240px,300px)_minmax(0,1fr)] overflow-hidden">
    <nav class="flex min-h-0 flex-col items-center gap-2 border-r border-slate-800 bg-slate-950 px-1.5 py-3" aria-label="Viewer areas">
      <div class="mb-2 grid h-11 w-11 place-items-center rounded-md border border-slate-800 bg-slate-900 font-mono text-sm font-bold text-cyan-300" title="db viewer">db</div>
      <button type="button" class="${appRailButtonClass}" data-app-area data-area="connections" aria-label="Connections" title="Connections">CN</button>
      <button type="button" class="${activeAppRailButtonClass}" data-app-area data-area="data" aria-label="Data" title="Data">DA</button>
      <button type="button" class="${appRailButtonClass}" data-app-area data-area="query" aria-label="Query" title="Query">QY</button>
      <button type="button" class="${appRailButtonClass}" data-app-area data-area="schema" aria-label="Schema" title="Schema">SC</button>
      <button type="button" class="${appRailButtonClass}" data-app-area data-area="operations" aria-label="Operations" title="Operations">OP</button>
      <button type="button" class="${appRailButtonClass}" data-app-area data-area="logs" aria-label="Logs" title="Logs">LG</button>
      <button type="button" class="${appRailButtonClass}" data-app-area data-area="settings" aria-label="Settings" title="Settings">ST</button>
    </nav>

    <aside id="context-explorer" class="min-h-0 overflow-auto border-r border-slate-800 bg-slate-950/95 p-4">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-bold tracking-normal text-slate-100">Explorer</h2>
          <div class="${mutedClass}" id="subtitle">Loading local data files</div>
        </div>
        <button type="button" id="refresh" class="${buttonClass}" title="Refresh manifest and schema">Refresh</button>
      </div>

      <div class="mb-4 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">Current connection</div>
        <div class="mt-1 text-sm font-semibold text-slate-100">Local @async/db runtime</div>
        <div class="${mutedClass}" id="connection-brief">Manifest and schema routes load in this browser session.</div>
      </div>

      <label class="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500" for="resource-filter">Resources</label>
      <input id="resource-filter" class="${inputClass}" placeholder="Filter resources" autocomplete="off">
      <div id="resource-list" class="mt-3 grid gap-4"></div>

      <div id="csv-drop" class="${importDropClass}">
        <div class="font-semibold text-slate-100">Import CSV</div>
        <p class="mb-3 mt-1 text-xs text-slate-400">Drop a CSV file here to copy it into ${escapeHtml(sourceDirLabel)}, sync the mirror, and open the new resource.</p>
        <button type="button" id="csv-pick" class="${buttonClass}">Choose CSV</button>
        <input id="csv-file" type="file" accept=".csv,text/csv" class="hidden">
        <div id="csv-import-status" class="mt-3 text-xs text-slate-400"></div>
      </div>
    </aside>

    <main class="min-h-0 min-w-0 overflow-auto bg-slate-950">
      <header class="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-5 py-4 backdrop-blur">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-xs font-semibold uppercase tracking-wide text-cyan-300" id="area-label">Data</div>
            <h1 id="resource-title" class="truncate text-lg font-bold tracking-normal text-slate-100">db viewer</h1>
            <div class="${mutedClass}" id="resource-detail">Select a resource to open a workspace.</div>
          </div>
          <div class="${rowClass} justify-end" id="status"></div>
        </div>
      </header>

      <div class="p-5">
        <div id="diagnostics-view" class="mb-4 hidden"></div>

        <section id="area-connections" data-area-panel class="hidden">
          <div class="${viewerGridClass}">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">Connections</h2>
              </div>
              <div class="${panelBodyClass}" id="connection-view"></div>
            </div>
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">Route Exposure</h2>
              </div>
              <div class="${panelBodyClass}" id="route-exposure-view"></div>
            </div>
          </div>
        </section>

        <section id="area-data" data-area-panel>
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div class="${rowClass}" role="tablist" aria-label="Resource workspace tabs">
              <button type="button" class="${activeTabClass}" data-tab="data">Data</button>
              <button type="button" class="${tabClass}" data-tab="schema">Schema</button>
              <button type="button" class="${tabClass}" data-tab="api">API</button>
              <button type="button" class="${tabClass}" data-tab="operations">Operations</button>
              <button type="button" class="${tabClass}" data-tab="related">Related</button>
              <button type="button" class="${tabClass}" data-tab="diagnostics">Diagnostics</button>
            </div>
            <button type="button" id="reload-data" class="${buttonClass}">Reload</button>
          </div>

          <section id="tab-data" data-tab-panel>
            <div class="${viewerGridClass}">
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h3 class="text-sm font-bold tracking-normal text-slate-100">Data grid</h3>
                </div>
                <div class="${panelBodyClass}" id="data-view"></div>
              </div>
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h3 class="text-sm font-bold tracking-normal text-slate-100">Selected JSON</h3>
                  <button type="button" data-copy-target="json-output" class="${buttonClass}">Copy</button>
                </div>
                <div class="${panelBodyClass}">
                  <pre id="json-output" class="${codeClass}">{}</pre>
                  <textarea id="record-editor" class="${textareaClass} mt-3 hidden" aria-label="Selected row JSON editor"></textarea>
                  <div id="pending-edit-actions" class="mt-3 hidden flex-wrap gap-2">
                    <button type="button" id="apply-edits" class="${primaryButtonClass}">Apply</button>
                    <button type="button" id="discard-edits" class="${buttonClass}">Discard</button>
                  </div>
                  <div id="write-status" class="mt-3 text-xs text-slate-400"></div>
                </div>
              </div>
            </div>
          </section>

          <section id="tab-schema" data-tab-panel class="hidden">
            <div class="${viewerGridClass}">
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h3 class="text-sm font-bold tracking-normal text-slate-100">Fields</h3>
                </div>
                <div class="${panelBodyClass}" id="field-view"></div>
              </div>
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h3 class="text-sm font-bold tracking-normal text-slate-100">Generated Schema</h3>
                  <button type="button" data-copy-target="schema-output" class="${buttonClass}">Copy</button>
                </div>
                <div class="${panelBodyClass}">
                  <pre id="schema-output" class="${codeClass}">{}</pre>
                </div>
              </div>
            </div>
          </section>

          <section id="tab-api" data-tab-panel class="hidden">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-100">API</h3>
              </div>
              <div class="${panelBodyClass}" id="resource-api-view"></div>
            </div>
          </section>

          <section id="tab-operations" data-tab-panel class="hidden">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-100">Resource Operations</h3>
              </div>
              <div class="${panelBodyClass}" id="resource-operation-view"></div>
            </div>
          </section>

          <section id="tab-related" data-tab-panel class="hidden">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-100">Related Records</h3>
              </div>
              <div class="${panelBodyClass}" id="related-view"></div>
            </div>
          </section>

          <section id="tab-diagnostics" data-tab-panel class="hidden">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h3 class="text-sm font-bold tracking-normal text-slate-100">Resource Diagnostics</h3>
              </div>
              <div class="${panelBodyClass}" id="resource-diagnostics-view"></div>
            </div>
          </section>
        </section>

        <section id="area-query" data-area-panel class="hidden">
          <div class="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Query modes">
            <button type="button" class="${activeTabClass}" data-query-mode="resource">Resource</button>
            <button type="button" class="${tabClass}" data-query-mode="operation">Operation</button>
            <button type="button" class="${tabClass}" data-query-mode="graphql">GraphQL</button>
            <button type="button" class="${tabClass}" data-query-mode="sql">SQL</button>
            <button type="button" class="${tabClass}" data-query-mode="explain">Explain</button>
          </div>

          <section id="query-mode-resource" data-query-panel>
            <div class="${viewerGridClass}">
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h2 class="text-sm font-bold tracking-normal text-slate-100">Resource Query</h2>
                  <button type="button" id="run-resource-query" class="${primaryButtonClass}">Run</button>
                </div>
                <div class="${panelBodyClass} ${stackClass}">
                  <div id="resource-query-disabled" class="hidden"></div>
                  <div class="grid gap-3 sm:grid-cols-2">
                    <label class="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Select<input id="query-select" class="${inputClass}" placeholder="id,name"></label>
                    <label class="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Expand<input id="query-expand" class="${inputClass}" placeholder="relationName"></label>
                    <label class="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Offset<input id="query-offset" class="${inputClass}" inputmode="numeric" value="0"></label>
                    <label class="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Limit<input id="query-limit" class="${inputClass}" inputmode="numeric" value="50"></label>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">URL preview</div>
                    <pre id="resource-query-url" class="${codeClass}"></pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Fetch preview</div>
                    <pre id="resource-query-preview" class="${codeClass}"></pre>
                  </div>
                </div>
              </div>
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h2 class="text-sm font-bold tracking-normal text-slate-100">Resource Result</h2>
                </div>
                <div class="${panelBodyClass}">
                  <pre id="query-output" class="${codeClass}">{}</pre>
                </div>
              </div>
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h2 class="text-sm font-bold tracking-normal text-slate-100">REST Specs</h2>
                </div>
                <div class="${panelBodyClass} ${stackClass}">
                  <p class="m-0 text-sm text-slate-400">Batch requests run sequentially. Earlier successful writes stay committed if a later item fails.</p>
                  <div class="${stackClass}" id="rest-examples"></div>
                </div>
              </div>
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h2 class="text-sm font-bold tracking-normal text-slate-100">REST Runner</h2>
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

          <section id="query-mode-operation" data-query-panel class="hidden">
            <div class="${viewerGridClass}">
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h2 class="text-sm font-bold tracking-normal text-slate-100">Operation</h2>
                  <button type="button" id="run-operation" class="${primaryButtonClass}">Run Operation</button>
                </div>
                <div class="${panelBodyClass} ${stackClass}">
                  <div id="operation-disabled" class="hidden"></div>
                  <label class="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ref or name<input id="operation-ref" class="${inputClass}" placeholder="public-operation-ref"></label>
                  <label class="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Contract<select id="operation-contract" class="${selectClass}"><option value="">Default contract</option></select></label>
                  <label class="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Variables<textarea id="operation-variables" class="${textareaClass}">{}</textarea></label>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Request preview</div>
                    <pre id="operation-preview" class="${codeClass}"></pre>
                  </div>
                </div>
              </div>
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h2 class="text-sm font-bold tracking-normal text-slate-100">Operation Result</h2>
                </div>
                <div class="${panelBodyClass}">
                  <pre id="operation-output" class="${codeClass}">{}</pre>
                </div>
              </div>
            </div>
          </section>

          <section id="query-mode-graphql" data-query-panel class="hidden">
            <div id="graphql-disabled" class="mb-4 hidden"></div>
            <div class="${viewerGridClass}">
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h2 class="text-sm font-bold tracking-normal text-slate-100">GraphQL Examples</h2>
                </div>
                <div class="${panelBodyClass} ${stackClass}" id="graphql-examples"></div>
              </div>
              <div class="${panelClass}">
                <div class="${panelHeadClass}">
                  <h2 class="text-sm font-bold tracking-normal text-slate-100">GraphQL Runner</h2>
                  <button type="button" data-copy-target="graphql-query" class="${buttonClass}">Copy Query</button>
                </div>
                <div class="${panelBodyClass} ${stackClass}">
                  <input id="graphql-operation-name" class="${inputClass}" aria-label="GraphQL operation name" placeholder="operationName">
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

          <section id="query-mode-sql" data-query-panel class="hidden">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">SQL</h2>
              </div>
              <div class="${panelBodyClass}" id="sql-disabled">${escapeHtml('The selected resource/store does not expose a safe SQL query capability.')}</div>
            </div>
          </section>

          <section id="query-mode-explain" data-query-panel class="hidden">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">Explain</h2>
              </div>
              <div class="${panelBodyClass}" id="explain-disabled">${escapeHtml('The selected query mode does not expose a safe explain/plan capability.')}</div>
            </div>
          </section>
        </section>

        <section id="area-schema" data-area-panel class="hidden">
          <div class="${viewerGridClass}">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">Schema Resources</h2>
              </div>
              <div class="${panelBodyClass}" id="schema-resource-view"></div>
            </div>
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">Generated Schema</h2>
                <button type="button" data-copy-target="schema-output-copy" class="${buttonClass}">Copy</button>
              </div>
              <div class="${panelBodyClass}">
                <pre class="${codeClass}" id="schema-output-copy">{}</pre>
              </div>
            </div>
          </div>
        </section>

        <section id="area-operations" data-area-panel class="hidden">
          <div class="${viewerGridClass}">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">Operations</h2>
              </div>
              <div class="${panelBodyClass}" id="operations-view"></div>
            </div>
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">Operation Availability</h2>
              </div>
              <div class="${panelBodyClass}" id="operation-availability-view"></div>
            </div>
          </div>
        </section>

        <section id="area-logs" data-area-panel class="hidden">
          <div class="${viewerGridClass}">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">Logs</h2>
                <div class="${rowClass}">
                  <button type="button" id="connect-events" class="${buttonClass}">Connect Events</button>
                  <button type="button" id="connect-log" class="${buttonClass}">Connect Log</button>
                </div>
              </div>
              <div class="${panelBodyClass}" id="log-view"></div>
            </div>
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">Diagnostics</h2>
              </div>
              <div class="${panelBodyClass}" id="diagnostics-list-view"></div>
            </div>
          </div>
        </section>

        <section id="area-settings" data-area-panel class="hidden">
          <div class="${viewerGridClass}">
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">Settings</h2>
              </div>
              <div class="${panelBodyClass}" id="settings-view"></div>
            </div>
            <div class="${panelClass}">
              <div class="${panelHeadClass}">
                <h2 class="text-sm font-bold tracking-normal text-slate-100">Stores</h2>
              </div>
              <div class="${panelBodyClass}" id="store-view"></div>
            </div>
          </div>
        </section>
      </div>
    </main>
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
    const APP_RAIL_BUTTON_CLASS = ${JSON.stringify(appRailButtonClass)};
    const ACTIVE_APP_RAIL_BUTTON_CLASS = ${JSON.stringify(activeAppRailButtonClass)};
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
      selectedRecordIndex: 0,
      page: { offset: 0, limit: 50 },
      pendingEdit: null,
      queryMode: 'resource',
      liveEventsConnected: false,
      runtimeLogConnected: false,
      logItems: [],
      importResults: [],
      batchResults: [],
      activeArea: 'data',
    };

    const els = {
      areaLabel: document.getElementById('area-label'),
      subtitle: document.getElementById('subtitle'),
      status: document.getElementById('status'),
      resources: document.getElementById('resource-list'),
      resourceFilter: document.getElementById('resource-filter'),
      refresh: document.getElementById('refresh'),
      reloadData: document.getElementById('reload-data'),
      connectionBrief: document.getElementById('connection-brief'),
      connectionView: document.getElementById('connection-view'),
      routeExposureView: document.getElementById('route-exposure-view'),
      resourceTitle: document.getElementById('resource-title'),
      resourceDetail: document.getElementById('resource-detail'),
      dataView: document.getElementById('data-view'),
      jsonOutput: document.getElementById('json-output'),
      recordEditor: document.getElementById('record-editor'),
      pendingEditActions: document.getElementById('pending-edit-actions'),
      writeStatus: document.getElementById('write-status'),
      resourceApiView: document.getElementById('resource-api-view'),
      resourceOperationView: document.getElementById('resource-operation-view'),
      relatedView: document.getElementById('related-view'),
      resourceDiagnosticsView: document.getElementById('resource-diagnostics-view'),
      restExamples: document.getElementById('rest-examples'),
      restMethod: document.getElementById('rest-method'),
      restPath: document.getElementById('rest-path'),
      restBody: document.getElementById('rest-body'),
      restOutput: document.getElementById('rest-output'),
      querySelect: document.getElementById('query-select'),
      queryExpand: document.getElementById('query-expand'),
      queryOffset: document.getElementById('query-offset'),
      queryLimit: document.getElementById('query-limit'),
      resourceQueryDisabled: document.getElementById('resource-query-disabled'),
      resourceQueryUrl: document.getElementById('resource-query-url'),
      resourceQueryPreview: document.getElementById('resource-query-preview'),
      queryOutput: document.getElementById('query-output'),
      operationDisabled: document.getElementById('operation-disabled'),
      operationRef: document.getElementById('operation-ref'),
      operationContract: document.getElementById('operation-contract'),
      operationVariables: document.getElementById('operation-variables'),
      operationPreview: document.getElementById('operation-preview'),
      operationOutput: document.getElementById('operation-output'),
      graphqlDisabled: document.getElementById('graphql-disabled'),
      graphqlOperationName: document.getElementById('graphql-operation-name'),
      graphqlExamples: document.getElementById('graphql-examples'),
      graphqlQuery: document.getElementById('graphql-query'),
      graphqlVariables: document.getElementById('graphql-variables'),
      graphqlOutput: document.getElementById('graphql-output'),
      loadSdl: document.getElementById('load-sdl'),
      fieldView: document.getElementById('field-view'),
      schemaOutput: document.getElementById('schema-output'),
      schemaOutputCopy: document.getElementById('schema-output-copy'),
      schemaResourceView: document.getElementById('schema-resource-view'),
      operationsView: document.getElementById('operations-view'),
      operationAvailabilityView: document.getElementById('operation-availability-view'),
      logView: document.getElementById('log-view'),
      diagnosticsListView: document.getElementById('diagnostics-list-view'),
      connectEvents: document.getElementById('connect-events'),
      connectLog: document.getElementById('connect-log'),
      settingsView: document.getElementById('settings-view'),
      storeView: document.getElementById('store-view'),
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

      const areaButton = event.target.closest('[data-area]');
      if (areaButton && !areaButton.dataset.resource) {
        showArea(areaButton.dataset.area);
      }

      const pageButton = event.target.closest('[data-page-action]');
      if (pageButton) {
        await movePage(pageButton.dataset.pageAction);
      }

      const recordButton = event.target.closest('[data-record-index]');
      if (recordButton) {
        selectRecord(Number(recordButton.dataset.recordIndex));
      }

      const detailButton = event.target.closest('[data-json-detail]');
      if (detailButton) {
        showJsonDetail(Number(detailButton.dataset.recordIndex), detailButton.dataset.field);
      }

      const resourceButton = event.target.closest('[data-resource]');
      if (resourceButton) {
        await selectResource(resourceButton.dataset.resource);
        showArea('data');
      }
    });

    document.querySelectorAll('[data-app-area]').forEach((button) => {
      button.addEventListener('click', () => showArea(button.dataset.area));
    });

    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => showTab(button.dataset.tab));
    });

    document.querySelectorAll('[data-query-mode]').forEach((button) => {
      button.addEventListener('click', () => showQueryMode(button.dataset.queryMode));
    });

    els.refresh.addEventListener('click', boot);
    els.resourceFilter.addEventListener('input', renderResourceList);
    els.reloadData.addEventListener('click', () => loadSelectedData());
    els.recordEditor.addEventListener('input', stageEditorEdit);
    document.getElementById('apply-edits').addEventListener('click', applyPendingEdit);
    document.getElementById('discard-edits').addEventListener('click', discardPendingEdit);
    for (const input of [els.querySelect, els.queryExpand, els.queryOffset, els.queryLimit]) {
      input.addEventListener('input', renderQueryWorkspace);
    }
    els.operationRef.addEventListener('input', renderOperationPreview);
    els.operationContract.addEventListener('change', renderOperationPreview);
    els.operationVariables.addEventListener('input', renderOperationPreview);
    document.getElementById('run-resource-query').addEventListener('click', runResourceQuery);
    document.getElementById('run-operation').addEventListener('click', runOperation);
    els.connectEvents.addEventListener('click', connectLiveReload);
    els.connectLog.addEventListener('click', connectRuntimeLog);
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
      renderConnectionView();
      renderOperationsView();
      renderLogView();
      renderSettingsView();
      renderSchemaOverview();
      renderQueryWorkspace();
      els.subtitle.textContent = state.resources.length + ' resources loaded';
      els.connectionBrief.textContent = state.resources.length + ' resources from manifest and schema routes.';
      if (state.manifest.capabilities?.liveEvents !== false) {
        connectLiveReload();
      }
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
      state.page.offset = 0;
      state.pendingEdit = null;
      state.selectedRecordIndex = 0;

      document.querySelectorAll('[data-resource]').forEach((button) => {
        button.className = button.dataset.resource === resourceName ? ACTIVE_RESOURCE_BUTTON_CLASS : RESOURCE_BUTTON_CLASS;
      });

      els.resourceTitle.textContent = state.selected.name;
      els.resourceDetail.textContent = state.selected.kind + ' · ' + (state.selected.typeName || state.selected.name) + ' · ' + storeText(state.selected) + routeText(state.selected);
      renderFields();
      els.schemaOutput.textContent = pretty(schemaDisplayValue(state.schema?.resources?.[state.selected.name] || state.selected));
      els.schemaOutputCopy.textContent = els.schemaOutput.textContent;
      renderResourceApi();
      renderResourceOperations();
      renderRelated();
      renderResourceDiagnostics();
      renderQueryWorkspace();
      await loadSelectedData();
      renderRestExamples();
      renderGraphqlExamples();
    }

    async function loadSelectedData() {
      if (!state.selected) {
        return;
      }

      const disabledReason = resourceQueryDisabledReason(state.selected);
      if (disabledReason) {
        state.selectedData = null;
        state.pendingEdit = null;
        renderData();
        renderSelectedRecord();
        return;
      }

      const response = await fetch(resourcePagePath(state.selected));
      if (!response.ok) {
        throw new Error('Could not load ' + state.selected.name + ': ' + response.status + ' ' + response.statusText);
      }
      state.selectedData = await response.json();
      state.selectedRecordIndex = 0;
      state.pendingEdit = null;
      els.jsonOutput.textContent = pretty(state.selectedData);
      renderData();
      renderSelectedRecord();
    }

    function renderStatus() {
      const diagnostics = state.manifest.diagnostics || [];
      const errors = diagnostics.filter((item) => item.severity === 'error').length;
      const warnings = diagnostics.filter((item) => item.severity === 'warn').length;
      els.status.innerHTML = '';
      els.status.append(
        pill(state.resources.length + ' resources'),
        pill(state.manifest.capabilities?.rest === false ? 'REST off' : 'REST ready'),
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

      els.diagnosticsView.className = 'mb-4 grid gap-2 rounded-lg border border-amber-400/60 bg-amber-950/40 p-4 text-sm text-amber-100 shadow-sm';
      els.diagnosticsView.innerHTML = '';
      const heading = document.createElement('div');
      heading.className = 'font-bold';
      heading.textContent = 'Source diagnostics';
      els.diagnosticsView.append(heading);

      for (const diagnostic of diagnostics) {
        const item = document.createElement('div');
        item.className = diagnostic.severity === 'error'
          ? 'rounded-md border border-red-400/60 bg-red-950/40 p-3 text-red-100'
          : 'rounded-md border border-amber-400/60 bg-amber-950/40 p-3 text-amber-100';
        const fileText = diagnostic.file ? diagnostic.file + ': ' : '';
        item.textContent = fileText + diagnostic.message + (diagnostic.hint ? ' ' + diagnostic.hint : '');
        els.diagnosticsView.append(item);
      }
    }

    function renderResourceList() {
      els.resources.innerHTML = '';
      const query = els.resourceFilter.value.trim().toLowerCase();
      const resources = state.resources.filter((resource) => resourceMatches(resource, query));
      const recent = recentResources()
        .map((name) => state.resources.find((resource) => resource.name === name))
        .filter((resource) => resource && resourceMatches(resource, query));

      appendResourceGroup('Recent', recent);
      appendResourceGroup('Collections', resources.filter((resource) => resource.kind === 'collection'));
      appendResourceGroup('Documents', resources.filter((resource) => resource.kind === 'document'));
      appendStoreGroups(resources);
      appendDiagnosticsGroup(query);

      if (els.resources.childElementCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'rounded-md border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-400';
        empty.textContent = 'No matching resources.';
        els.resources.append(empty);
      }
    }

    function appendResourceGroup(label, resources) {
      if (resources.length === 0) {
        return;
      }

      const group = document.createElement('section');
      group.className = 'grid gap-2';
      const heading = document.createElement('h3');
      heading.className = 'text-xs font-semibold uppercase tracking-wide text-slate-500';
      heading.textContent = label;
      const list = document.createElement('div');
      list.className = 'grid gap-2';

      for (const resource of resources) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = state.selected?.name === resource.name ? ACTIVE_RESOURCE_BUTTON_CLASS : RESOURCE_BUTTON_CLASS;
        button.dataset.resource = resource.name;
        button.innerHTML = '<span data-resource-name class="font-semibold text-slate-100"></span><span data-resource-meta class="text-xs text-slate-400"></span><span data-resource-badges class="flex flex-wrap gap-1.5"></span>';
        button.querySelector('[data-resource-name]').textContent = resource.name;
        button.querySelector('[data-resource-meta]').textContent = resource.kind + ' · ' + Object.keys(resource.fields || {}).length + ' fields';
        const badges = button.querySelector('[data-resource-badges]');
        badges.append(
          textBadge(storeText(resource)),
          textBadge(writeBadgeText(resource), resource.actions?.create?.available || resource.actions?.patch?.available ? '' : 'warning'),
        );
        const diagnostics = diagnosticsForResource(resource);
        if (diagnostics.length > 0) {
          badges.append(textBadge(diagnostics.length + ' diagnostics', 'warning'));
        }
        list.append(button);
      }

      group.append(heading, list);
      els.resources.append(group);
    }

    function appendStoreGroups(resources) {
      const byStore = new Map();
      for (const resource of resources) {
        const store = resource.store?.name || 'default';
        byStore.set(store, [...(byStore.get(store) || []), resource]);
      }

      if (byStore.size === 0) {
        return;
      }

      const group = document.createElement('section');
      group.className = 'grid gap-2';
      const heading = document.createElement('h3');
      heading.className = 'text-xs font-semibold uppercase tracking-wide text-slate-500';
      heading.textContent = 'Stores';
      const list = document.createElement('div');
      list.className = 'grid gap-1.5';
      for (const [store, storeResources] of [...byStore.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-300';
        item.append(textNode(store), textBadge(storeResources.length + ' resources'));
        list.append(item);
      }
      group.append(heading, list);
      els.resources.append(group);
    }

    function appendDiagnosticsGroup(query) {
      const diagnostics = state.manifest.diagnostics || [];
      if (diagnostics.length === 0 || (query && !'diagnostics'.includes(query))) {
        return;
      }

      const group = document.createElement('section');
      group.className = 'grid gap-2';
      const heading = document.createElement('h3');
      heading.className = 'text-xs font-semibold uppercase tracking-wide text-slate-500';
      heading.textContent = 'Diagnostics';
      const item = document.createElement('button');
      item.type = 'button';
      item.className = RESOURCE_BUTTON_CLASS;
      item.dataset.area = 'logs';
      item.innerHTML = '<span class="font-semibold text-slate-100">Source diagnostics</span><span class="text-xs text-slate-400"></span>';
      item.querySelector('span:last-child').textContent = diagnostics.length + ' manifest diagnostics';
      group.append(heading, item);
      els.resources.append(group);
    }

    function resourceMatches(resource, query) {
      if (!query) {
        return true;
      }
      return [
        resource.name,
        resource.kind,
        resource.typeName,
        resource.store?.name,
        resource.store?.driver,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    }

    function renderConnectionView() {
      const manifest = state.manifest || {};
      const api = manifest.api || {};
      const capabilities = manifest.capabilities || {};
      const routeRows = [
        ['Viewer', api.viewer || '/'],
        ['Manifest', api.manifestJson || MANIFEST_PATH],
        ['Schema', api.schema || SCHEMA_PATH],
        ['REST base', api.restBasePath || REST_BASE_PATH || '/'],
        ['GraphQL', api.graphql || GRAPHQL_PATH],
        ['Operations', manifest.operations?.endpoint || 'disabled'],
        ['Events', api.events || EVENTS_PATH],
        ['Log', api.log || 'not exposed'],
        ['Batch', api.batch || REST_BATCH_PATH],
        ['Import', api.import || IMPORT_PATH],
      ];
      const capabilityRows = Object.entries(capabilities)
        .map(([name, value]) => [name, value === true ? 'available' : value === false ? 'disabled' : String(value)]);

      els.connectionView.innerHTML = summaryTable(routeRows);
      els.routeExposureView.innerHTML = [
        summaryTable(Object.entries(manifest.routeExposure || {})),
        viewerLinksHtml(api.viewers || []),
        capabilityRows.length > 0 ? '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Capabilities</h3>' + summaryTable(capabilityRows) : '',
      ].join('');
    }

    function renderOperationsView() {
      const operations = state.manifest?.operations || {};
      const rows = [
        ['Enabled', operations.enabled ? 'yes' : 'no'],
        ['Endpoint', operations.endpoint || 'not exposed'],
        ['Accepted refs', operations.acceptRefs || 'none'],
        ['Refs available', operations.refsAvailable ? 'yes' : 'no'],
        ['Contracts', (operations.contracts || []).join(', ') || 'none'],
      ];
      els.operationsView.innerHTML = summaryTable(rows);
      els.operationAvailabilityView.innerHTML = resourceActionMatrix('operation');
    }

    function renderLogView() {
      const api = state.manifest?.api || {};
      const streamRows = summaryTable([
        ['Events', api.events || EVENTS_PATH],
        ['Log', api.log || 'not exposed'],
        ['Manifest diagnostics', String((state.manifest?.diagnostics || []).length)],
      ]);
      els.logView.innerHTML = [
        streamRows,
        logItemsHtml(),
        importResultsHtml(),
        batchResultsHtml(),
      ].join('');
      els.diagnosticsListView.innerHTML = diagnosticsHtml(state.manifest?.diagnostics || []);
    }

    function renderSettingsView() {
      const api = state.manifest?.api || {};
      const formats = Object.entries(api.formats || {}).map(([name, format]) => [
        name,
        [
          format.extension,
          format.contentType,
          format.manifestPath,
        ].filter(Boolean).join(' · '),
      ]);
      const mappings = state.resources.map((resource) => [resource.name, storeText(resource)]);
      els.settingsView.innerHTML = [
        '<p class="m-0 text-sm text-slate-400">Viewer navigation and recent resources are browser-local only.</p>',
        '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Routes</h3>',
        summaryTable([
          ['Viewer', api.viewer || '/'],
          ['Manifest', api.manifestJson || MANIFEST_PATH],
          ['Schema', api.schema || SCHEMA_PATH],
          ['Events', api.events || EVENTS_PATH],
          ['Log', api.log || 'not exposed'],
          ['Batch', api.batch || REST_BATCH_PATH],
          ['Import', api.import || IMPORT_PATH],
          ['GraphQL', api.graphql || GRAPHQL_PATH],
          ['Falcor', api.falcor || 'not exposed'],
          ['REST base', api.restBasePath || REST_BASE_PATH || '/'],
        ]),
        '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Response formats</h3>',
        formats.length > 0 ? summaryTable(formats) : emptyHtml('No response formats exposed.'),
        '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Custom viewer links</h3>',
        viewerLinksHtml((api.viewers || []).filter((viewer) => viewer.source === 'custom')) || emptyHtml('No custom viewer links exposed.'),
        '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Route exposure</h3>',
        summaryTable(Object.entries(state.manifest?.routeExposure || {})),
        '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Resource store mapping</h3>',
        mappings.length > 0 ? summaryTable(mappings) : emptyHtml('No resources found.'),
        '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Availability</h3>',
        summaryTable([
          ['Import', state.manifest?.capabilities?.csvImport === false ? 'disabled' : 'available'],
          ['GraphQL', state.manifest?.capabilities?.graphql === false ? 'disabled' : 'available'],
          ['Falcor', state.manifest?.capabilities?.falcor === true ? 'available' : 'disabled'],
          ['Operations', state.manifest?.operations?.enabled ? 'available' : 'disabled'],
        ]),
        '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Browser-local preferences</h3>',
        summaryTable([
          ['Selected resource key', 'db:selectedResource'],
          ['Recent resources key', 'db:recentResources'],
          ['Route query', 'resource'],
        ]),
      ].join('');
      els.storeView.innerHTML = storeSummaryHtml();
    }

    function renderSchemaOverview() {
      const rows = state.resources.map((resource) => [
        resource.name,
        [
          resource.kind,
          identityText(resource),
          Object.keys(resource.fields || {}).length + ' fields',
          storeText(resource),
        ].join(' · '),
      ]);
      els.schemaResourceView.innerHTML = rows.length > 0 ? summaryTable(rows) : emptyHtml('No resources found.');
    }

    function renderResourceApi() {
      if (!state.selected) {
        els.resourceApiView.innerHTML = emptyHtml('Select a resource.');
        return;
      }

      const api = state.selected.api || {};
      const rows = [
        ['List', api.list || resourcePath(state.selected)],
        ['Read', api.read || resourcePath(state.selected) + '/{id}'],
        ['Canonical list', api.canonicalList || 'not exposed'],
        ['Canonical record', api.canonicalRecord || 'not exposed'],
        ['Identity', (api.identity || state.selected.identity?.fields || [state.selected.idField || 'id']).join(', ')],
      ];
      els.resourceApiView.innerHTML = summaryTable(rows);
    }

    function renderResourceOperations() {
      if (!state.selected) {
        els.resourceOperationView.innerHTML = emptyHtml('Select a resource.');
        return;
      }
      const actions = Object.entries(state.selected.actions || {}).map(([name, action]) => [
        name,
        action.available ? 'available' : 'disabled' + (action.reason ? ' · ' + action.reason : ''),
      ]);
      const modes = (state.selected.queryModes || []).join(', ') || 'none';
      els.resourceOperationView.innerHTML = [
        '<div class="mb-3 flex flex-wrap gap-2">' + textBadgeHtml('query modes: ' + modes) + '</div>',
        actions.length > 0 ? summaryTable(actions) : emptyHtml('No operation actions exposed for this resource.'),
      ].join('');
    }

    function renderRelated() {
      if (!state.selected) {
        els.relatedView.innerHTML = emptyHtml('Select a resource.');
        return;
      }
      els.relatedView.innerHTML = relationSummary(state.selected);
    }

    function renderResourceDiagnostics() {
      if (!state.selected) {
        els.resourceDiagnosticsView.innerHTML = emptyHtml('Select a resource.');
        return;
      }
      const diagnostics = diagnosticsForResource(state.selected);
      els.resourceDiagnosticsView.innerHTML = diagnostics.length > 0
        ? diagnosticsHtml(diagnostics)
        : emptyHtml('No manifest diagnostics matched this resource.');
    }

    function renderQueryWorkspace() {
      renderResourceQueryPreview();
      renderOperationPreview();
      renderGraphqlAvailability();
    }

    function renderResourceQueryPreview() {
      if (!state.selected) {
        els.resourceQueryUrl.textContent = '';
        els.resourceQueryPreview.textContent = '';
        setDisabledPanel(els.resourceQueryDisabled, true, 'Select a resource before running a resource query.');
        return;
      }

      const reason = resourceQueryDisabledReason(state.selected);
      setDisabledPanel(els.resourceQueryDisabled, Boolean(reason), reason);
      const url = resourceQueryPath();
      els.resourceQueryUrl.textContent = url;
      els.resourceQueryPreview.textContent = "fetch('" + url.replaceAll("'", "\\'") + "').then((response) => response.json())";
    }

    function resourceQueryDisabledReason(resource) {
      if (state.manifest?.routeExposure?.rest === 'registered-only') {
        return 'Direct REST reads are registered-only. Use Operation mode with a public ref.';
      }
      if (state.manifest?.routeExposure?.rest === 'disabled' || state.manifest?.routeExposure?.rest === false) {
        return 'Direct REST reads are disabled for this viewer.';
      }
      const read = resource.actions?.read;
      if (read && !read.available) {
        return 'Resource reads are unavailable: ' + (read.reason || 'route-disabled') + '.';
      }
      return '';
    }

    function resourceQueryPath() {
      if (!state.selected) {
        return '';
      }
      const params = {};
      const select = els.querySelect.value.trim();
      const expand = els.queryExpand.value.trim();
      const offset = numberInput(els.queryOffset.value, state.page.offset);
      const limit = Math.min(Math.max(numberInput(els.queryLimit.value, state.page.limit), 1), 500);
      if (select) {
        params.select = select;
      }
      if (expand) {
        params.expand = expand;
      }
      if (state.selected.kind !== 'document') {
        params.offset = offset;
        params.limit = limit;
      }
      return appendQuery(resourcePath(state.selected), params);
    }

    async function runResourceQuery() {
      if (!state.selected) {
        return;
      }
      const reason = resourceQueryDisabledReason(state.selected);
      if (reason) {
        els.queryOutput.textContent = pretty({ error: { message: reason } });
        return;
      }
      try {
        const response = await fetch(resourceQueryPath());
        const text = await response.text();
        els.queryOutput.textContent = response.status + ' ' + response.statusText + '\\n' + formatJsonText(text);
      } catch (error) {
        els.queryOutput.textContent = pretty({ error: { message: error.message } });
      }
    }

    function renderOperationPreview() {
      const operations = state.manifest?.operations || {};
      const reason = operationDisabledReason();
      setDisabledPanel(els.operationDisabled, Boolean(reason), reason);
      syncOperationContracts(operations.contracts || []);
      const ref = els.operationRef.value.trim() || '{ref}';
      const endpoint = operationEndpoint(ref);
      els.operationPreview.textContent = [
        'POST ' + endpoint,
        'content-type: application/json',
        '',
        safeJsonPreview(els.operationVariables.value),
      ].join('\\n');
    }

    function operationDisabledReason() {
      const operations = state.manifest?.operations || {};
      if (state.manifest?.routeExposure?.operations === 'disabled' || state.manifest?.routeExposure?.operations === false) {
        return 'Registered operation routes are disabled for this viewer.';
      }
      if (!operations.enabled) {
        return 'Registered operations are not enabled.';
      }
      if (!operations.refsAvailable) {
        return 'No client-safe operation refs or summaries are available.';
      }
      return '';
    }

    function operationEndpoint(ref) {
      const endpoint = state.manifest?.operations?.endpoint || joinPaths(REST_BASE_PATH || '', '/operations/{ref}');
      return endpoint.replace('{ref}', encodeURIComponent(ref));
    }

    async function runOperation() {
      const reason = operationDisabledReason();
      if (reason) {
        els.operationOutput.textContent = pretty({ error: { message: reason } });
        return;
      }
      const ref = els.operationRef.value.trim();
      if (!ref) {
        els.operationOutput.textContent = pretty({ error: { message: 'Enter an operation ref or name.' } });
        return;
      }
      const variables = parseJson(els.operationVariables.value, null);
      if (variables === null) {
        els.operationOutput.textContent = pretty({ error: { message: 'Operation variables must be valid JSON.' } });
        return;
      }
      try {
        const response = await fetch(operationEndpoint(ref), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(variables),
        });
        const text = await response.text();
        els.operationOutput.textContent = response.status + ' ' + response.statusText + '\\n' + formatJsonText(text);
      } catch (error) {
        els.operationOutput.textContent = pretty({ error: { message: error.message } });
      }
    }

    function syncOperationContracts(contracts) {
      const current = els.operationContract.value;
      const options = ['<option value="">Default contract</option>', ...contracts.map((contract) => '<option value="' + escapeHtml(contract) + '">' + escapeHtml(contract) + '</option>')];
      const next = options.join('');
      if (els.operationContract.innerHTML !== next) {
        els.operationContract.innerHTML = next;
        els.operationContract.value = contracts.includes(current) ? current : '';
      }
    }

    function renderGraphqlAvailability() {
      const reason = graphqlDisabledReason();
      setDisabledPanel(els.graphqlDisabled, Boolean(reason), reason);
      document.getElementById('run-graphql').disabled = Boolean(reason);
      els.loadSdl.disabled = Boolean(reason);
    }

    function graphqlDisabledReason() {
      if (state.manifest?.routeExposure?.graphql === 'disabled' || state.manifest?.routeExposure?.graphql === false) {
        return 'GraphQL is disabled for this viewer.';
      }
      if (state.selected?.actions?.graphql && !state.selected.actions.graphql.available) {
        return 'GraphQL is unavailable: ' + (state.selected.actions.graphql.reason || 'graphql-disabled') + '.';
      }
      if (state.manifest?.capabilities?.graphql === false) {
        return 'GraphQL is disabled by project configuration.';
      }
      return '';
    }

    function setDisabledPanel(element, disabled, message) {
      if (!element) {
        return;
      }
      element.className = disabled
        ? 'rounded-md border border-amber-400/60 bg-amber-950/40 p-3 text-sm text-amber-100'
        : 'hidden';
      element.textContent = disabled ? message : '';
    }

    function safeJsonPreview(text) {
      const parsed = parseJson(text, {});
      return pretty(parsed);
    }

    function numberInput(value, fallback) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    }

    function summaryTable(rows) {
      if (!rows || rows.length === 0) {
        return emptyHtml('No values exposed.');
      }
      const body = rows.map(([label, value]) => '<tr><td class="' + TH_CLASS + '">' + escapeHtml(label) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(value === false ? 'disabled' : value ?? '') + '</td></tr>').join('');
      return '<div class="' + TABLE_WRAP_CLASS + '"><table class="' + TABLE_CLASS + '"><tbody>' + body + '</tbody></table></div>';
    }

    function viewerLinksHtml(links) {
      if (!links.length) {
        return '';
      }
      const items = links.map((link) => '<li><a class="font-semibold text-cyan-300 hover:underline" href="' + escapeHtml(link.href) + '">' + escapeHtml(link.label) + '</a><span class="ml-2 text-xs text-slate-500">' + escapeHtml(link.source || 'viewer') + '</span></li>').join('');
      return '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Viewer links</h3><ul class="grid gap-2 text-sm text-slate-300">' + items + '</ul>';
    }

    function resourceActionMatrix(actionName) {
      const rows = state.resources.map((resource) => {
        const action = resource.actions?.[actionName];
        return [
          resource.name,
          action?.available ? 'available' : 'disabled' + (action?.reason ? ' · ' + action.reason : ''),
        ];
      });
      return rows.length > 0 ? summaryTable(rows) : emptyHtml('No resources found.');
    }

    function storeSummaryHtml() {
      const stores = Object.values(state.manifest?.stores || {});
      if (stores.length === 0) {
        return emptyHtml('No store summaries exposed.');
      }
      return '<div class="grid gap-3">' + stores.map((store) => {
        const capabilities = Object.entries(store.capabilities || {})
          .filter(([, available]) => available === true)
          .map(([name]) => textBadgeHtml(name))
          .join('');
        return '<article class="rounded-lg border border-slate-800 bg-slate-950 p-3"><div class="flex flex-wrap items-center justify-between gap-3"><h3 class="text-sm font-bold text-slate-100">' + escapeHtml(store.name) + '</h3>' + textBadgeHtml(store.driver) + '</div><div class="mt-2 text-sm text-slate-400">' + escapeHtml(store.persistence || 'runtime') + '</div><div class="mt-3 flex flex-wrap gap-2">' + (capabilities || textBadgeHtml('read-only')) + '</div></article>';
      }).join('') + '</div>';
    }

    function diagnosticsHtml(diagnostics) {
      if (!diagnostics.length) {
        return emptyHtml('No diagnostics exposed.');
      }
      return '<div class="grid gap-2">' + diagnostics.map((diagnostic) => {
        const severity = diagnostic.severity === 'error' ? 'border-red-400/60 bg-red-950/40 text-red-100' : 'border-amber-400/60 bg-amber-950/40 text-amber-100';
        return '<div class="rounded-md border ' + severity + ' p-3 text-sm">' + escapeHtml(diagnostic.message || diagnostic.code || 'Diagnostic') + '</div>';
      }).join('') + '</div>';
    }

    function logItemsHtml() {
      if (state.logItems.length === 0) {
        return '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Log rows</h3>' + emptyHtml('No live event or request trace rows captured in this browser session.');
      }
      const rows = state.logItems.map((item) => [
        item.kind,
        item.label,
        item.message,
        item.at,
      ]);
      return '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Log rows</h3>' + summaryTable(rows);
    }

    function importResultsHtml() {
      if (state.importResults.length === 0) {
        return '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Import results</h3>' + emptyHtml('No imports captured in this browser session.');
      }
      return '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Import results</h3>' + summaryTable(state.importResults.map((item) => [item.status, item.message, item.at]));
    }

    function batchResultsHtml() {
      if (state.batchResults.length === 0) {
        return '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Batch results</h3>' + emptyHtml('No batch requests captured in this browser session.');
      }
      return '<h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Batch results</h3>' + summaryTable(state.batchResults.map((item) => [item.status, item.message, item.at]));
    }

    function recordImportResult(status, message) {
      state.importResults = [{ status, message, at: new Date().toISOString() }, ...state.importResults].slice(0, 20);
      renderLogView();
    }

    function recordBatchResult(status, message) {
      state.batchResults = [{ status, message, at: new Date().toISOString() }, ...state.batchResults].slice(0, 20);
      renderLogView();
    }

    function emptyHtml(message) {
      return '<div class="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-400">' + escapeHtml(message) + '</div>';
    }

    function renderData() {
      if (!state.selected) {
        els.dataView.innerHTML = emptyHtml('Select a resource.');
        renderSelectedRecord();
        return;
      }

      const disabledReason = resourceQueryDisabledReason(state.selected);
      if (disabledReason) {
        els.dataView.innerHTML = emptyHtml(disabledReason);
        return;
      }

      const data = state.selectedData;
      if (Array.isArray(data)) {
        els.dataView.innerHTML = renderCollectionWorkspace(data, state.selected);
        return;
      }

      els.dataView.innerHTML = renderDocumentWorkspace(data, state.selected);
    }

    function renderCollectionWorkspace(records, resource) {
      return [
        renderGridToolbar(records, resource),
        renderTable(records, resource),
      ].join('');
    }

    function renderDocumentWorkspace(documentData, resource) {
      const canWrite = canWriteResource(resource);
      return [
        '<div class="mb-3 flex flex-wrap items-center justify-between gap-3">',
        '<div class="text-sm text-slate-400">Document resource</div>',
        writeControlsHtml(resource),
        '</div>',
        '<pre class="' + CODE_CLASS + '">' + escapeHtml(pretty(documentData)) + '</pre>',
        canWrite ? '<p class="mt-3 text-sm text-slate-400">Edit the selected JSON panel, then apply or discard staged changes.</p>' : '',
      ].join('');
    }

    function renderGridToolbar(records, resource) {
      const nextDisabled = records.length < state.page.limit;
      return [
        '<div id="grid-toolbar" class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950 p-3">',
        '<div class="flex flex-wrap items-center gap-2">',
        textBadgeHtml('page size ' + state.page.limit),
        textBadgeHtml('offset ' + state.page.offset),
        textBadgeHtml(records.length + ' loaded'),
        textBadgeHtml(identityText(resource)),
        '</div>',
        '<div class="flex flex-wrap items-center gap-2">',
        writeControlsHtml(resource),
        '<button type="button" class="' + BUTTON_CLASS + '" data-copy-target="json-output">Copy page</button>',
        '<button type="button" class="' + BUTTON_CLASS + '" data-page-action="previous"' + (state.page.offset === 0 ? ' disabled' : '') + '>Previous</button>',
        '<button type="button" class="' + BUTTON_CLASS + '" data-page-action="next"' + (nextDisabled ? ' disabled' : '') + '>Next</button>',
        '</div>',
        '</div>',
      ].join('');
    }

    function renderTable(records, resource) {
      if (records.length === 0) {
        return emptyHtml('No records found for this page.');
      }

      const columns = schemaFirstColumns(records, resource);

      const head = '<th class="' + TH_CLASS + '">Row</th>' + columns.map((column) => '<th class="' + TH_CLASS + '">' + escapeHtml(column) + identityBadgeHtml(resource, column) + '</th>').join('');
      const rows = records.map((record, index) => {
        const selectedClass = index === state.selectedRecordIndex ? ' data-selected-row="true"' : '';
        return '<tr' + selectedClass + '><td class="' + TD_CLASS + '"><button type="button" class="' + BUTTON_CLASS + '" data-record-index="' + index + '">Open</button></td>' + columns.map((column) => '<td class="' + TD_CLASS + '">' + cellHtml(resource, record, column, index) + '</td>').join('') + '</tr>';
      }).join('');
      return '<div class="' + TABLE_WRAP_CLASS + '"><table class="' + TABLE_CLASS + '"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function schemaFirstColumns(records, resource) {
      const schemaColumns = Object.keys(resource.fields || {});
      const driftColumns = Array.from(records.reduce((set, record) => {
        Object.keys(record || {}).forEach((key) => {
          if (!schemaColumns.includes(key)) {
            set.add(key);
          }
        });
        return set;
      }, new Set())).sort();
      return [...schemaColumns, ...driftColumns];
    }

    function identityFields(resource) {
      if (Array.isArray(resource.identity?.fields) && resource.identity.fields.length > 0) {
        return resource.identity.fields;
      }
      if (Array.isArray(resource.api?.identity) && resource.api.identity.length > 0) {
        return resource.api.identity;
      }
      return [resource.idField || 'id'];
    }

    function identityText(resource) {
      return 'identity ' + identityFields(resource).join(', ');
    }

    function identityBadgeHtml(resource, column) {
      return identityFields(resource).includes(column) ? ' <span class="' + PILL_CLASS + '">identity</span>' : '';
    }

    function canWriteResource(resource) {
      return Boolean(
        resource.actions?.create?.available
        || resource.actions?.patch?.available
        || resource.actions?.replace?.available
        || resource.actions?.delete?.available,
      );
    }

    function writeControlsHtml(resource) {
      const actions = resource.actions || {};
      const writable = canWriteResource(resource);
      const disabledReason = firstUnavailableReason(actions);
      const badges = [
        actions.create?.available ? textBadgeHtml('create') : '',
        actions.patch?.available ? textBadgeHtml('patch') : '',
        actions.replace?.available ? textBadgeHtml('replace') : '',
        actions.delete?.available ? textBadgeHtml('delete') : '',
        writable ? '' : textBadgeHtml(disabledReason ? 'writes disabled: ' + disabledReason : 'writes disabled'),
      ].filter(Boolean).join('');
      return '<div class="flex flex-wrap items-center gap-2" data-write-controls>' + badges + '</div>';
    }

    function firstUnavailableReason(actions) {
      for (const action of [actions.create, actions.patch, actions.replace, actions.delete, actions.importCsv]) {
        if (action && !action.available && action.reason) {
          return action.reason;
        }
      }
      return '';
    }

    function renderSelectedRecord() {
      if (state.selected) {
        const disabledReason = resourceQueryDisabledReason(state.selected);
        if (disabledReason) {
          els.jsonOutput.textContent = pretty({ error: { message: disabledReason } });
          els.recordEditor.value = '';
          els.pendingEditActions.classList.add('hidden');
          return;
        }
      }

      const selected = selectedRecordValue();
      els.jsonOutput.textContent = pretty(selected);
      if (state.selected && canWriteResource(state.selected)) {
        els.recordEditor.classList.remove('hidden');
        els.recordEditor.value = pretty(selected);
      } else {
        els.recordEditor.classList.add('hidden');
        els.recordEditor.value = '';
      }
      renderPendingEditControls();
    }

    function selectedRecordValue() {
      if (Array.isArray(state.selectedData)) {
        return state.selectedData[state.selectedRecordIndex] || {};
      }
      return state.selectedData ?? {};
    }

    function selectRecord(index) {
      if (!Array.isArray(state.selectedData)) {
        return;
      }
      if (index < 0 || index >= state.selectedData.length) {
        return;
      }
      state.selectedRecordIndex = index;
      state.pendingEdit = null;
      renderData();
      renderSelectedRecord();
    }

    function showJsonDetail(index, field) {
      if (!Array.isArray(state.selectedData)) {
        return;
      }
      const value = state.selectedData[index]?.[field];
      state.selectedRecordIndex = index;
      els.jsonOutput.textContent = pretty({ [field]: value });
      if (state.selected && canWriteResource(state.selected)) {
        els.recordEditor.classList.remove('hidden');
        els.recordEditor.value = pretty(state.selectedData[index] || {});
      }
    }

    function stageEditorEdit() {
      if (!state.selected || !canWriteResource(state.selected)) {
        state.pendingEdit = null;
        renderPendingEditControls();
        return;
      }
      const original = pretty(selectedRecordValue());
      state.pendingEdit = els.recordEditor.value.trim() && els.recordEditor.value !== original
        ? { resource: state.selected.name, value: els.recordEditor.value }
        : null;
      renderPendingEditControls();
    }

    function renderPendingEditControls() {
      const hasPending = Boolean(state.pendingEdit);
      els.pendingEditActions.className = hasPending ? 'mt-3 flex flex-wrap gap-2' : 'mt-3 hidden flex-wrap gap-2';
      if (!hasPending && els.writeStatus.textContent === 'Pending edit staged.') {
        els.writeStatus.textContent = '';
      }
      if (hasPending) {
        els.writeStatus.textContent = 'Pending edit staged.';
        els.writeStatus.className = 'mt-3 text-xs font-medium text-cyan-300';
      }
    }

    async function applyPendingEdit() {
      if (!state.pendingEdit || !state.selected) {
        return;
      }

      const parsed = parseJson(els.recordEditor.value, null);
      if (parsed === null) {
        setWriteStatus('Editor JSON is invalid.', 'error');
        return;
      }

      const target = writeTargetFor(state.selected, selectedRecordValue());
      try {
        const response = await fetch(target.path, {
          method: target.method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(parsed),
        });
        const text = await response.text();
        if (!response.ok) {
          const payload = parseJson(text, {});
          const message = payload.error?.message || response.status + ' ' + response.statusText;
          throw new Error(message);
        }
        state.pendingEdit = null;
        setWriteStatus('Changes applied through REST.', 'success');
        await loadSelectedData();
      } catch (error) {
        setWriteStatus(error.message, 'error');
      }
    }

    function discardPendingEdit() {
      state.pendingEdit = null;
      renderSelectedRecord();
      setWriteStatus('', '');
    }

    function writeTargetFor(resource, value) {
      if (resource.kind === 'document') {
        return { method: resource.actions?.replace?.available ? 'PUT' : 'PATCH', path: resourcePath(resource) };
      }

      const id = identityValue(resource, value);
      const basePath = resourcePath(resource);
      if (id !== null && id !== undefined && id !== '' && resource.actions?.patch?.available) {
        return { method: 'PATCH', path: basePath + '/' + encodeURIComponent(id) };
      }
      return { method: 'POST', path: basePath };
    }

    function identityValue(resource, value) {
      const fields = identityFields(resource);
      if (fields.length !== 1) {
        return null;
      }
      return value?.[fields[0]];
    }

    function setWriteStatus(message, kind) {
      els.writeStatus.textContent = message;
      els.writeStatus.className = kind === 'error'
        ? 'mt-3 text-xs font-medium text-red-300'
        : kind === 'success'
          ? 'mt-3 text-xs font-medium text-cyan-300'
          : 'mt-3 text-xs text-slate-400';
    }

    async function movePage(action) {
      if (!state.selected || state.selected.kind === 'document') {
        return;
      }
      if (action === 'previous') {
        state.page.offset = Math.max(0, state.page.offset - state.page.limit);
      } else if (action === 'next') {
        state.page.offset += state.page.limit;
      }
      await loadSelectedData();
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
        return '<tr><td class="' + TD_CLASS + '">' + escapeHtml(name) + identityBadgeHtml(state.selected, name) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(fieldType(field)) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(field.required ? 'yes' : 'no') + '</td><td class="' + TD_CLASS + '">' + escapeHtml(field.nullable ? 'yes' : 'no') + '</td><td class="' + TD_CLASS + '">' + escapeHtml(defaultText(field)) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(enumText(field)) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(fieldFlags(field)) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(relationTextForField(name)) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(uiHintText(field)) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(field.description || '') + '</td></tr>';
      }).join('');
      els.fieldView.innerHTML = schemaSummaryHtml(state.selected) + relationSummary(state.selected) + '<div class="' + TABLE_WRAP_CLASS + '"><table class="' + TABLE_CLASS + '"><thead><tr><th class="' + TH_CLASS + '">Field</th><th class="' + TH_CLASS + '">Type</th><th class="' + TH_CLASS + '">Required</th><th class="' + TH_CLASS + '">Nullable</th><th class="' + TH_CLASS + '">Default</th><th class="' + TH_CLASS + '">Enum</th><th class="' + TH_CLASS + '">Flags</th><th class="' + TH_CLASS + '">Relation</th><th class="' + TH_CLASS + '">UI hint</th><th class="' + TH_CLASS + '">Description</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function schemaSummaryHtml(resource) {
      return '<div class="mb-3">' + summaryTable([
        ['Kind', resource.kind],
        ['Identity', identityFields(resource).join(', ')],
        ['Store', storeText(resource)],
        ['Validation', validationText(resource)],
        ['Unknown fields', unknownFieldText(resource)],
      ]) + '</div>';
    }

    function validationText(resource) {
      return resource.validation?.mode || resource.validationMode || 'schema fields';
    }

    function unknownFieldText(resource) {
      if (resource.unknownFields) {
        return String(resource.unknownFields);
      }
      return resource.additionalProperties === false ? 'rejected' : 'preserved when present';
    }

    function defaultText(field) {
      return Object.hasOwn(field, 'default') ? formatCell(field.default) : '';
    }

    function enumText(field) {
      return Array.isArray(field.values) ? field.values.join(', ') : '';
    }

    function fieldFlags(field) {
      return [
        field.readOnly ? 'read-only' : '',
        field.derived || field.computed ? 'derived/computed' : '',
      ].filter(Boolean).join(', ');
    }

    function uiHintText(field) {
      if (!field.ui || typeof field.ui !== 'object') {
        return '';
      }
      return Object.entries(field.ui)
        .map(([key, value]) => key + ':' + formatCell(value))
        .join(', ');
    }

    function exampleView(example, kind) {
      const element = document.createElement('div');
      element.className = EXAMPLE_CLASS;
      const copyText = kind === 'rest' ? restCopyText(example) : example.query;
      const payload = JSON.stringify({ kind, ...example });
      element.innerHTML = '<div class="' + EXAMPLE_HEAD_CLASS + '"><div><strong class="text-sm font-semibold text-slate-100"></strong><div data-example-meta class="' + MUTED_CLASS + '"></div></div><div class="' + ROW_CLASS + '"><button type="button" data-load-example="">Load</button><button type="button" data-copy-example>Copy</button></div></div><pre class="' + CODE_CLASS + '"></pre>';
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
      if (els.restPath.value === REST_BATCH_PATH || els.restPath.value.endsWith('/batch')) {
        recordBatchResult(String(response.status), response.statusText || 'Batch request completed.');
      }
      await loadSelectedData();
    }

    async function runGraphql() {
      const reason = graphqlDisabledReason();
      if (reason) {
        els.graphqlOutput.textContent = pretty({ error: { message: reason } });
        return;
      }
      const payload = {
        query: els.graphqlQuery.value,
        variables: parseJson(els.graphqlVariables.value, {}),
      };
      if (els.graphqlOperationName.value.trim()) {
        payload.operationName = els.graphqlOperationName.value.trim();
      }
      const response = await fetch(GRAPHQL_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
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

    function resourcePagePath(resource) {
      const path = resourcePath(resource);
      if (resource.kind === 'document') {
        return path;
      }
      return appendQuery(path, {
        offset: state.page.offset,
        limit: state.page.limit,
      });
    }

    function appendQuery(path, params) {
      const [base, query = ''] = String(path).split('?');
      const searchParams = new URLSearchParams(query);
      for (const [key, value] of Object.entries(params)) {
        searchParams.set(key, String(value));
      }
      const next = searchParams.toString();
      return next ? base + '?' + next : base;
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
        return '<div class="mb-3 rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-400"><strong class="text-slate-100">Relations</strong><div>No explicit relations declared.</div></div>';
      }

      const rows = relations.map((relation) => '<tr><td class="' + TD_CLASS + '">' + escapeHtml(relation.name) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(relation.sourceField) + '</td><td class="' + TD_CLASS + '">' + escapeHtml(relation.targetResource + '.' + relation.targetField) + '</td><td class="' + TD_CLASS + '"><code>expand=' + escapeHtml(relation.name) + '</code></td></tr>').join('');
      return '<div class="mb-3"><h4 class="mb-2 text-sm font-bold tracking-normal text-slate-100">Relations</h4><div class="' + TABLE_WRAP_CLASS + '"><table class="' + TABLE_CLASS + '"><thead><tr><th class="' + TH_CLASS + '">Name</th><th class="' + TH_CLASS + '">Source</th><th class="' + TH_CLASS + '">Target</th><th class="' + TH_CLASS + '">REST</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }

    function cellHtml(resource, record, column, index) {
      const relation = relationForField(resource, column);
      const value = record?.[column];
      if (!relation || value === undefined || value === null || value === '') {
        if (value && typeof value === 'object') {
          return nestedValueHtml(value, index, column);
        }
        return escapeHtml(formatCell(value));
      }

      const target = state.resources.find((candidate) => candidate.name === relation.targetResource);
      const targetPath = target ? resourcePath(target) : joinPaths(REST_BASE_PATH, '/' + relation.targetResource);
      const href = targetPath + '/' + encodeURIComponent(value);
      return '<a data-relation-link href="' + escapeHtml(href) + '" class="font-semibold text-cyan-300 hover:underline">' + escapeHtml(formatCell(value)) + '</a><button type="button" class="ml-2 ' + BUTTON_CLASS + '" data-json-detail data-record-index="' + index + '" data-field="' + escapeHtml(column) + '">Related</button>';
    }

    function nestedValueHtml(value, index, field) {
      const kind = Array.isArray(value) ? 'array' : 'object';
      const size = Array.isArray(value) ? value.length : Object.keys(value).length;
      return '<button type="button" class="' + BUTTON_CLASS + '" data-json-detail data-record-index="' + index + '" data-field="' + escapeHtml(field) + '">' + kind + ' ' + size + '</button>';
    }

    function routeText(resource) {
      return ' · ' + resourcePath(resource);
    }

    function storeText(resource) {
      if (resource.store?.name && resource.store?.driver) {
        return resource.store.name + ' · ' + resource.store.driver;
      }
      if (resource.store?.name) {
        return resource.store.name;
      }
      return 'default store';
    }

    function writeBadgeText(resource) {
      if (resource.actions?.create?.available || resource.actions?.patch?.available || resource.actions?.replace?.available) {
        return 'read/write';
      }
      if (resource.actions?.read?.available) {
        return 'read-only';
      }
      return 'route disabled';
    }

    function diagnosticsForResource(resource) {
      const name = String(resource?.name || '').toLowerCase();
      return (state.manifest?.diagnostics || []).filter((diagnostic) => {
        const haystack = [
          diagnostic.resource,
          diagnostic.resourceName,
          diagnostic.file,
          diagnostic.message,
          diagnostic.code,
        ].filter(Boolean).join(' ').toLowerCase();
        return name && haystack.includes(name);
      });
    }

    function recentResources() {
      try {
        const parsed = JSON.parse(localStorage.getItem('db:recentResources') || '[]');
        return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
      } catch {
        return [];
      }
    }

    function rememberRecentResource(name) {
      const next = [name, ...recentResources().filter((item) => item !== name)].slice(0, 6);
      localStorage.setItem('db:recentResources', JSON.stringify(next));
    }

    function textNode(value) {
      return document.createTextNode(String(value));
    }

    function textBadge(text, className) {
      const element = document.createElement('span');
      element.className = className === 'warning' ? WARNING_PILL_CLASS : PILL_CLASS;
      element.textContent = text;
      return element;
    }

    function textBadgeHtml(text) {
      return '<span class="' + PILL_CLASS + '">' + escapeHtml(text) + '</span>';
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
      rememberRecentResource(name);
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
      if (!window.EventSource || state.liveEventsConnected) {
        return;
      }
      if (state.manifest?.capabilities?.liveEvents === false) {
        appendLogItem('info', 'Live event', 'Live events are disabled.');
        return;
      }

      const events = new EventSource(EVENTS_PATH);
      state.liveEventsConnected = true;
      appendLogItem('live event', 'Live event', 'Connected to ' + EVENTS_PATH + '.');
      events.addEventListener('db', (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === 'connected') {
          appendLogItem('live event', 'Live event', 'Resource event stream connected.');
          return;
        }

        const selectedName = state.selected?.name;
        appendLogItem('live event', 'Live event', payload.type || 'resource event');
        els.subtitle.textContent = payload.type === 'synced-with-errors'
          ? 'Files changed; reloaded with source errors'
          : 'Files changed; reloaded';
        boot(selectedName).catch(showFatal);
      });
    }

    function connectRuntimeLog() {
      const logPath = state.manifest?.api?.log;
      if (!window.EventSource || !logPath || state.runtimeLogConnected) {
        return;
      }
      const events = new EventSource(logPath);
      state.runtimeLogConnected = true;
      appendLogItem('request trace', 'Request trace', 'Connected to runtime log stream.');
      const handleLogEvent = (event) => {
        const payload = parseJson(event.data, {});
        const message = [
          payload.type || 'request trace',
          payload.route,
          payload.operation,
          payload.status,
          payload.durationMs === undefined ? '' : payload.durationMs + 'ms',
        ].filter(Boolean).join(' · ');
        appendLogItem('request trace', 'Request trace', message || 'Runtime log event.');
      };
      events.addEventListener('db-log', handleLogEvent);
      events.onmessage = handleLogEvent;
    }

    function appendLogItem(kind, label, message) {
      state.logItems = [{
        kind,
        label,
        message,
        at: new Date().toISOString(),
      }, ...state.logItems].slice(0, 50);
      renderLogView();
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

        setImportStatus('Imported and opened ' + result.resource + '.', 'success');
        recordImportResult('success', 'Imported resource ' + result.resource + '.');
        await boot(result.resource);
        showTab('data');
      } catch (error) {
        setImportStatus(error.message, 'error');
        recordImportResult('error', error.message);
      } finally {
        els.csvFile.value = '';
      }
    }

    function setImportStatus(message, kind) {
      els.csvImportStatus.textContent = message;
      els.csvImportStatus.className = kind === 'error'
        ? 'mt-3 text-xs font-medium text-red-300'
        : kind === 'success'
          ? 'mt-3 text-xs font-medium text-cyan-300'
          : 'mt-3 text-xs text-slate-400';
    }

    function showArea(name) {
      state.activeArea = name || 'data';
      document.querySelectorAll('[data-app-area]').forEach((button) => {
        button.className = button.dataset.area === state.activeArea ? ACTIVE_APP_RAIL_BUTTON_CLASS : APP_RAIL_BUTTON_CLASS;
      });
      document.querySelectorAll('[data-area-panel]').forEach((panel) => {
        panel.classList.toggle('hidden', panel.id !== 'area-' + state.activeArea);
      });
      els.areaLabel.textContent = areaLabel(state.activeArea);
    }

    function areaLabel(name) {
      return {
        connections: 'Connections',
        data: 'Data',
        query: 'Query',
        schema: 'Schema',
        operations: 'Operations',
        logs: 'Logs',
        settings: 'Settings',
      }[name] || 'Data';
    }

    function showQueryMode(name) {
      state.queryMode = name || 'resource';
      document.querySelectorAll('[data-query-mode]').forEach((button) => {
        button.className = button.dataset.queryMode === state.queryMode ? ACTIVE_TAB_CLASS : TAB_CLASS;
      });
      document.querySelectorAll('[data-query-panel]').forEach((panel) => {
        panel.classList.toggle('hidden', panel.id !== 'query-mode-' + state.queryMode);
      });
      renderQueryWorkspace();
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

    function schemaDisplayValue(value) {
      if (Array.isArray(value)) {
        return value.map(schemaDisplayValue);
      }
      if (!value || typeof value !== 'object') {
        return redactAbsolutePathText(value);
      }

      return Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'source')
        .map(([key, entry]) => [key, schemaDisplayValue(entry)]));
    }

    function redactAbsolutePathText(value) {
      if (typeof value !== 'string') {
        return value;
      }
      return value.replace(/\\/(?:Users|private|tmp|var)\\/[^\\s"'{}\\[\\],]+\\/db\\//g, 'db/');
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
