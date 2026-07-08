const basePath = window.DATABASE_DASHBOARD_BASE_PATH ?? '';

const state = {
  payload: null,
  activeResource: 'orders',
  activeTab: 'data',
  selectedRecordId: null,
  search: '',
  queryPreset: 'recent',
  queryStatus: 'Ready',
};

const els = {
  resources: document.querySelector('[data-resources]'),
  content: document.querySelector('[data-content]'),
  title: document.querySelector('[data-title]'),
  breadcrumb: document.querySelector('[data-breadcrumb]'),
  search: document.querySelector('[data-search]'),
  presets: document.querySelector('[data-presets]'),
  sql: document.querySelector('[data-sql]'),
  inspectorContext: document.querySelector('[data-inspector-context]'),
  recordSummary: document.querySelector('[data-record-summary]'),
  recordFields: document.querySelector('[data-record-fields]'),
};

const queryPresets = [
  {
    id: 'recent',
    label: 'Example recent orders',
    resource: 'orders',
    sql: 'select id, customerId, productId, total, status\nfrom orders\norder by createdAt desc;',
  },
  {
    id: 'paid',
    label: 'Example paid total',
    resource: 'orders',
    filter(record) {
      return record.status === 'paid';
    },
    sql: "select id, customerId, total, currency\nfrom orders\nwhere status = 'paid';",
  },
  {
    id: 'customers',
    label: 'Example active customers',
    resource: 'users',
    filter(record) {
      return record.status === 'active';
    },
    sql: "select id, name, plan, region\nfrom users\nwhere status = 'active';",
  },
  {
    id: 'inventory',
    label: 'Example inventory',
    resource: 'products',
    sql: 'select id, name, sku, inventory, status\nfrom products\norder by inventory asc;',
  },
];

boot().catch((error) => {
  els.content.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});

function boot() {
  bindEvents();
  renderPresets();
  return loadDashboard();
}

function bindEvents() {
  document.querySelectorAll('[data-refresh]').forEach((button) => {
    button.addEventListener('click', () => {
      void loadDashboard();
    });
  });

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      render();
    });
  });

  els.search.addEventListener('input', () => {
    state.search = els.search.value;
    render();
  });

  document.querySelector('[data-run-query]').addEventListener('click', () => {
    const resource = activeResource();
    state.queryStatus = `${queryRecords(resource).length} row result from ${resource.name}`;
    state.activeTab = 'query';
    render();
  });
}

async function loadDashboard() {
  state.queryStatus = 'Loading local runtime';
  renderShellLoading();
  const response = await fetch(`${basePath}/api/dashboard`, {
    headers: {
      accept: 'application/json',
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Dashboard request failed: ${response.status}`);
  }
  state.payload = payload;
  if (!resourceByName(state.activeResource)) {
    state.activeResource = payload.resources.find((resource) => resource.kind === 'collection')?.name ?? payload.resources[0]?.name;
  }
  state.selectedRecordId = firstRecordId(activeResource());
  state.queryStatus = 'Ready';
  render();
}

function renderShellLoading() {
  els.breadcrumb.textContent = 'Opening local @async/db runtime...';
}

function render() {
  if (!state.payload) {
    return;
  }

  renderResources();
  renderTabs();
  renderPresets();
  renderQuery();
  renderMain();
  renderInspector();
}

function renderResources() {
  const resources = collectionResources();
  els.resources.innerHTML = `
    <div class="section-title">Tables <span>${resources.length}</span></div>
    ${resources.map((resource) => {
      const count = recordsFor(resource).length;
      const selected = resource.name === state.activeResource;
      return `<button class="resource-button" data-resource="${escapeHtml(resource.name)}" aria-current="${selected ? 'true' : 'false'}">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"></path><path d="M4 10h16"></path><path d="M9 10v9"></path></svg>
        <span class="resource-name">${escapeHtml(resource.name)}</span>
        <span class="resource-count">${count}</span>
      </button>`;
    }).join('')}
  `;

  els.resources.querySelectorAll('[data-resource]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeResource = button.dataset.resource;
      state.selectedRecordId = firstRecordId(activeResource());
      render();
    });
  });
}

function renderTabs() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.tab === state.activeTab));
  });
}

function renderPresets() {
  els.presets.innerHTML = queryPresets.map((preset) => (
    `<button class="preset" data-preset="${escapeHtml(preset.id)}" aria-pressed="${preset.id === state.queryPreset ? 'true' : 'false'}">${escapeHtml(preset.label)}</button>`
  )).join('');

  els.presets.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = queryPresets.find((candidate) => candidate.id === button.dataset.preset);
      if (!preset) {
        return;
      }
      state.queryPreset = preset.id;
      state.activeResource = preset.resource;
      state.selectedRecordId = firstRecordId(activeResource());
      render();
    });
  });
}

function renderQuery() {
  const preset = queryPresets.find((candidate) => candidate.id === state.queryPreset) ?? queryPresets[0];
  els.sql.value = preset.sql;
}

function renderMain() {
  const resource = activeResource();
  const records = filteredRecords(resource);
  els.title.textContent = `${titleCase(resource.name)} example data`;
  els.breadcrumb.textContent = `Database Dashboard Example / ${resource.name} / ${records.length} visible rows`;

  if (state.activeTab === 'schema') {
    renderSchema(resource);
    return;
  }

  if (state.activeTab === 'query') {
    renderQueryResult(resource, queryRecords(resource));
    return;
  }

  if (state.activeTab === 'notes') {
    renderNotes(resource);
    return;
  }

  renderData(resource, records);
}

function renderData(resource, records) {
  els.content.innerHTML = `
    <div class="panel-pad">
      ${renderExampleSummary()}
      ${renderTable(resource, records)}
    </div>
  `;
  bindRows();
}

function renderQueryResult(resource, records) {
  els.content.innerHTML = `
    <div class="panel-pad">
      <div class="data-frame">
        <div class="table-head">
          <div>
            <h2>Query result</h2>
            <p>${escapeHtml(state.queryStatus)}. Presets run against local seeded records in this example.</p>
          </div>
          <span class="value-chip">${records.length} rows</span>
        </div>
        ${renderTableMarkup(resource, records)}
      </div>
    </div>
  `;
  bindRows();
}

function renderSchema(resource) {
  const resources = collectionResources();
  els.content.innerHTML = `
    <div class="panel-pad">
      <div class="schema-list">
        ${resources.map((item) => {
          const fields = Object.entries(item.fields ?? {});
          return `<article class="schema-card">
            <h3>${escapeHtml(item.name)}</h3>
            <p class="muted-line">${escapeHtml(item.description || `${fields.length} fields`)}</p>
            <div class="field-list">
              ${fields.map(([fieldName, field]) => `<div class="field-row">
                <strong>${escapeHtml(fieldName)}</strong>
                <span>${escapeHtml(field.type ?? 'unknown')}${field.required ? ' required' : ''}${field.relation ? ` -> ${escapeHtml(field.relation.to)}` : ''}</span>
              </div>`).join('')}
            </div>
          </article>`;
        }).join('')}
      </div>
    </div>
  `;
  state.selectedRecordId = firstRecordId(resource);
}

function renderNotes(resource) {
  const diagnostics = state.payload.diagnostics ?? [];
  const notes = [
    {
      title: 'Example runtime mirror',
      detail: `${collectionResources().length} collections synced from db/*.schema.jsonc into .db/state.`,
    },
    {
      title: 'Same runtime as built-in viewer',
      detail: `Open ${resource.routePath}.json or the built-in viewer to inspect the same records.`,
    },
    {
      title: diagnostics.length ? 'Example diagnostics reported' : 'Example schema clean',
      detail: diagnostics.length ? `${diagnostics.length} diagnostics available from schema load.` : 'No schema diagnostics were returned for this example.',
    },
  ];

  els.content.innerHTML = `
    <div class="panel-pad">
      <div class="note-list">
        ${notes.map((note) => `<article class="note-card">
          <h3>${escapeHtml(note.title)}</h3>
          <p class="muted-line">${escapeHtml(note.detail)}</p>
        </article>`).join('')}
      </div>
    </div>
  `;
}

function renderExampleSummary() {
  const orders = recordsByName('orders');
  const users = recordsByName('users');
  const products = recordsByName('products');
  const paidRevenue = orders
    .filter((order) => order.status === 'paid')
    .reduce((sum, order) => sum + Number(order.total ?? 0), 0);

  return `<div class="metric-row">
    <div class="metric"><span>Example resources</span><strong>${collectionResources().length}</strong></div>
    <div class="metric"><span>Example orders</span><strong>${orders.length}</strong></div>
    <div class="metric"><span>Example customers</span><strong>${users.length}</strong></div>
    <div class="metric"><span>Example paid total</span><strong>${formatCurrency(paidRevenue)}</strong></div>
  </div>`;
}

function renderTable(resource, records) {
  return `<div class="data-frame">
    <div class="table-head">
      <div>
        <h2>${escapeHtml(resource.name)}</h2>
        <p>${escapeHtml(resource.description || 'Local collection records')}</p>
      </div>
      <span class="value-chip">${records.length} rows</span>
    </div>
    ${renderTableMarkup(resource, records)}
  </div>`;
}

function renderTableMarkup(resource, records) {
  if (records.length === 0) {
    return '<div class="empty-state">No matching rows.</div>';
  }

  const columns = tableColumns(resource, records);
  return `<table class="grid-table">
    <thead>
      <tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${records.map((record) => {
        const id = recordId(resource, record);
        return `<tr data-row-id="${escapeHtml(id)}" aria-selected="${id === state.selectedRecordId ? 'true' : 'false'}">
          ${columns.map((column) => `<td>${formatCell(record[column], column)}</td>`).join('')}
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function bindRows() {
  els.content.querySelectorAll('[data-row-id]').forEach((row) => {
    row.addEventListener('click', () => {
      state.selectedRecordId = row.dataset.rowId;
      render();
    });
  });
}

function renderInspector() {
  const resource = activeResource();
  const record = selectedRecord(resource);
  if (!record) {
    els.inspectorContext.textContent = `No ${resource.name} row selected.`;
    els.recordSummary.innerHTML = '<p class="muted-line">Select a row from the data grid.</p>';
    els.recordFields.innerHTML = '';
    return;
  }

  const id = recordId(resource, record);
  const title = record.name ?? record.title ?? record.id ?? id;
  els.inspectorContext.textContent = `${resource.name} / ${id}`;
  els.recordSummary.innerHTML = `
    <div class="summary-title">
      <strong>${escapeHtml(title)}</strong>
      ${record.status ? `<span class="value-chip" data-tone="${escapeHtml(record.status)}">${escapeHtml(record.status)}</span>` : ''}
    </div>
    <div class="relation-list">${renderRelations(resource, record)}</div>
  `;
  els.recordFields.innerHTML = Object.entries(record).map(([key, value]) => `
    <div class="kv-row">
      <dt>${escapeHtml(key)}</dt>
      <dd>${escapeHtml(formatValue(value))}</dd>
    </div>
  `).join('');
}

function renderRelations(resource, record) {
  const relations = resource.relations ?? [];
  if (relations.length === 0) {
    return '<span>No relations</span>';
  }

  return relations.map((relation) => {
    const target = recordsByName(relation.targetResource ?? relation.to)
      .find((candidate) => String(candidate[relation.targetField ?? relation.toField ?? 'id']) === String(record[relation.sourceField]));
    const label = target?.name ?? target?.id ?? record[relation.sourceField] ?? 'missing';
    return `<span>${escapeHtml(relation.name)}: ${escapeHtml(label)}</span>`;
  }).join('');
}

function collectionResources() {
  return (state.payload?.resources ?? []).filter((resource) => resource.kind === 'collection');
}

function resourceByName(name) {
  return (state.payload?.resources ?? []).find((resource) => resource.name === name);
}

function activeResource() {
  return resourceByName(state.activeResource) ?? collectionResources()[0];
}

function recordsByName(name) {
  const records = state.payload?.records?.[name] ?? [];
  return Array.isArray(records) ? records : [records];
}

function recordsFor(resource) {
  return recordsByName(resource.name);
}

function filteredRecords(resource) {
  const query = state.search.trim().toLowerCase();
  const records = recordsFor(resource);
  if (!query) {
    return records;
  }
  return records.filter((record) => JSON.stringify(record).toLowerCase().includes(query));
}

function queryRecords(resource) {
  const preset = queryPresets.find((candidate) => candidate.id === state.queryPreset);
  const records = filteredRecords(resource);
  if (!preset?.filter) {
    return records;
  }
  return records.filter(preset.filter);
}

function selectedRecord(resource) {
  const records = filteredRecords(resource);
  return records.find((record) => recordId(resource, record) === state.selectedRecordId) ?? records[0] ?? null;
}

function firstRecordId(resource) {
  const record = recordsFor(resource)[0];
  return record ? recordId(resource, record) : null;
}

function recordId(resource, record) {
  return String(record?.[resource.idField ?? 'id'] ?? record?.id ?? '');
}

function tableColumns(resource, records) {
  const fieldColumns = Object.keys(resource.fields ?? {});
  const recordColumns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return (fieldColumns.length > 0 ? fieldColumns : recordColumns).slice(0, 7);
}

function formatCell(value, column) {
  if (value === undefined || value === null || value === '') {
    return '<span class="cell-muted">null</span>';
  }
  if (column === 'status' || column === 'plan' || column === 'category') {
    return `<span class="value-chip" data-tone="${escapeHtml(String(value))}">${escapeHtml(String(value))}</span>`;
  }
  if (typeof value === 'number' && (column === 'total' || column === 'price')) {
    return escapeHtml(formatCurrency(value));
  }
  return escapeHtml(formatValue(value));
}

function formatValue(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value);
  }
  return String(value ?? 'null');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function titleCase(value) {
  return String(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
