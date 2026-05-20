/**
 * Minimal SSR HTML from schema manifest metadata plus collection records.
 * @param {unknown} manifest
 * @param {Record<string, unknown[]>} recordsByCollection
 */
export function renderHomePage(manifest, recordsByCollection) {
  const collections = Object.values(manifest.collections ?? {}).filter((c) => c.kind === 'collection');
  const links = collections.map((resource) => {
    const count = recordsByCollection[resource.name]?.length ?? 0;
    return `<li><a href="/cms/${escapeHtml(resource.name)}">${escapeHtml(resource.editor?.title ?? resource.name)}</a> — ${count} record${count === 1 ? '' : 's'}</li>`;
  });

  return pageShell({
    title: 'Schema UI · CMS home',
    body: `
    <h1>CMS home</h1>
    <p>Resources from <code>src/generated/jsondb.schema.json</code>, records loaded from the jsondb mirror.</p>
    <ul>${links.join('\n')}</ul>
    <p><a href="/templates">Static component templates</a> (no live data).</p>`,
  });
}

/**
 * @param {unknown} manifest
 * @param {string} collectionName
 * @param {unknown[]} records
 */
export function renderCollectionListPage(manifest, collectionName, records) {
  const resource = manifest.collections?.[collectionName];
  if (!resource || resource.kind !== 'collection') {
    return null;
  }

  const title = resource.editor?.title ?? collectionName;
  const rows = records.map((record) => {
    const id = record?.[resource.idField ?? 'id'];
    const label = pickListLabel(record, resource);
    return `<li><a href="/cms/${escapeHtml(collectionName)}/${encodeURIComponent(String(id))}">${escapeHtml(label)}</a> <small>(<code>${escapeHtml(String(id))}</code>)</small></li>`;
  });

  return pageShell({
    title: `Schema UI · ${title}`,
    body: `
    <p><a href="/">← Home</a></p>
    <h1>${escapeHtml(title)}</h1>
    ${resource.editor?.description ? `<p>${escapeHtml(resource.editor.description)}</p>` : ''}
    <ul>${rows.join('\n')}</ul>`,
  });
}

/**
 * @param {unknown} manifest
 * @param {string} collectionName
 * @param {Record<string, unknown> | null} record
 * @param {Record<string, unknown[]>} recordsByCollection
 */
export function renderRecordDetailPage(manifest, collectionName, record, recordsByCollection) {
  const resource = manifest.collections?.[collectionName];
  if (!resource || resource.kind !== 'collection' || !record) {
    return null;
  }

  const title = resource.editor?.title ?? collectionName;
  const fields = Object.entries(resource.fields ?? {});
  const viewBlocks = fields.map(([fieldName, field]) => renderFieldBlock('view', fieldName, field, record[fieldName], recordsByCollection));
  const editorBlocks = fields.map(([fieldName, field]) => renderFieldBlock('editor', fieldName, field, record[fieldName], recordsByCollection));

  const id = record[resource.idField ?? 'id'];

  return pageShell({
    title: `Schema UI · ${title} · ${id}`,
    body: `
    <p><a href="/">← Home</a> · <a href="/cms/${escapeHtml(collectionName)}">← ${escapeHtml(title)}</a></p>
    <h1>${escapeHtml(String(record.title ?? record.name ?? id))}</h1>
    ${resource.editor?.description ? `<p>${escapeHtml(resource.editor.description)}</p>` : ''}
    <section class="cms-live-view">
      <h2>Rendered view</h2>
${viewBlocks.join('\n')}
    </section>
    <section class="cms-live-editor">
      <h2>Rendered editor</h2>
      <form method="post" action="#" class="cms-editor-demo">
        <p><small>This example only renders markup; it does not persist edits.</small></p>
${editorBlocks.join('\n')}
      </form>
    </section>`,
  });
}

function pageShell({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.45; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
    code { font-size: 0.9em; }
    section { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #ddd; }
    .field-block { margin: 1rem 0; }
    .field-block label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
    .field-block small { display: block; color: #555; margin-top: 0.25rem; }
    article[data-markdown] { white-space: pre-wrap; border-left: 3px solid #ccc; padding-left: 1rem; }
  </style>
</head>
<body>
  <main>
${body}
  </main>
</body>
</html>`;
}

function pickListLabel(record, resource) {
  if (!record || typeof record !== 'object') {
    return '';
  }
  if (typeof record.title === 'string') {
    return record.title;
  }
  if (typeof record.name === 'string') {
    return record.name;
  }
  const idField = resource.idField ?? 'id';
  return String(record[idField] ?? '');
}

/**
 * @param {'view' | 'editor'} mode
 */
function renderFieldBlock(mode, fieldName, field, value, recordsByCollection) {
  const component = field.ui?.component ?? 'text';
  const label = field.ui?.label ?? labelFromFieldName(fieldName);
  const inner = mode === 'view'
    ? renderViewField(component, fieldName, field, value, recordsByCollection)
    : renderEditorField(component, fieldName, field, value, recordsByCollection);

  return `      <div class="field-block" data-component="${escapeHtml(component)}" data-field="${escapeHtml(fieldName)}">
        <label>${escapeHtml(label)}</label>
        ${inner}
      </div>`;
}

function renderViewField(component, fieldName, field, value, recordsByCollection) {
  switch (component) {
    case 'email': {
      const text = scalarText(value);
      return `<a href="mailto:${escapeHtml(text)}">${escapeHtml(text)}</a>${hint(field)}`;
    }
    case 'textarea':
      return `<p>${escapeHtml(scalarText(value))}</p>${hint(field)}`;
    case 'markdown':
      return `<article data-markdown data-field="${escapeHtml(fieldName)}">${escapeHtml(scalarText(value))}</article>${hint(field)}`;
    case 'segmented-control':
      return `<span>${escapeHtml(scalarText(value))}</span>${hint(field)}`;
    case 'relationSelect':
      return `${relationAnchor(field, value, recordsByCollection)}${hint(field)}`;
    case 'text':
    default:
      if (field.ui?.readonly) {
        return `<span><code>${escapeHtml(scalarText(value))}</code></span>${hint(field)}`;
      }
      return `<span>${escapeHtml(scalarText(value))}</span>${hint(field)}`;
  }
}

function renderEditorField(component, fieldName, field, value, recordsByCollection) {
  if (field.ui?.readonly) {
    return `<span><code>${escapeHtml(scalarText(value))}</code></span>${hint(field)}`;
  }

  const req = field.required ? 'required' : '';

  switch (component) {
    case 'email':
      return `<input type="email" name="${escapeHtml(fieldName)}" value="${escapeHtml(scalarText(value))}" ${req}>${hint(field)}`;
    case 'textarea':
      return `<textarea name="${escapeHtml(fieldName)}" rows="4" cols="48" ${req}>${escapeHtml(scalarText(value))}</textarea>${hint(field)}`;
    case 'markdown':
      return `<textarea name="${escapeHtml(fieldName)}" rows="10" cols="48" data-editor="markdown" ${req}>${escapeHtml(scalarText(value))}</textarea>${hint(field)}`;
    case 'segmented-control': {
      const vals = Array.isArray(field.values) ? field.values : [];
      const current = scalarText(value);
      const radios = vals.map((option) => (
        `<label><input type="radio" name="${escapeHtml(fieldName)}" value="${escapeHtml(String(option))}" ${current === String(option) ? 'checked' : ''}> ${escapeHtml(String(option))}</label>`
      ));
      return `<fieldset>${radios.join('<br>\n')}</fieldset>${hint(field)}`;
    }
    case 'relationSelect':
      return `${relationSelect(field, fieldName, value, recordsByCollection)}${hint(field)}`;
    case 'text':
    default:
      return `<input type="text" name="${escapeHtml(fieldName)}" value="${escapeHtml(scalarText(value))}" ${req}>${hint(field)}`;
  }
}

function relationAnchor(field, foreignKey, recordsByCollection) {
  const keyText = scalarText(foreignKey);
  if (!field.relation?.to || keyText === '') {
    return `<span>${escapeHtml(keyText)}</span>`;
  }
  const label = relationDisplayLabel(field, foreignKey, recordsByCollection);
  const targetCollection = field.relation.to;
  return `<a href="/cms/${escapeHtml(targetCollection)}/${encodeURIComponent(keyText)}">${escapeHtml(label)}</a>`;
}

function relationSelect(field, fieldName, selectedKey, recordsByCollection) {
  const targetCollection = field.relation?.to ?? field.ui?.optionsFrom;
  const idField = field.relation?.toField ?? 'id';
  const rows = targetCollection ? recordsByCollection[targetCollection] ?? [] : [];
  const current = scalarText(selectedKey);
  const options = [`<option value="">Choose…</option>`].concat(rows.map((row) => {
    const id = row?.[idField];
    const label = row?.name ?? row?.email ?? row?.title ?? String(id ?? '');
    return `<option value="${escapeHtml(String(id ?? ''))}" ${String(id ?? '') === current ? 'selected' : ''}>${escapeHtml(String(label))}</option>`;
  }));
  return `<select name="${escapeHtml(fieldName)}">${options.join('\n')}</select>`;
}

function relationDisplayLabel(field, foreignKey, recordsByCollection) {
  const targetCollection = field.relation?.to;
  const idField = field.relation?.toField ?? 'id';
  if (!targetCollection) {
    return scalarText(foreignKey);
  }
  const rows = recordsByCollection[targetCollection] ?? [];
  const match = rows.find((row) => String(row?.[idField] ?? '') === String(foreignKey ?? ''));
  if (!match) {
    return scalarText(foreignKey);
  }
  return String(match.name ?? match.email ?? match.title ?? foreignKey ?? '');
}

function scalarText(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function hint(field) {
  return field.description ? `<small>${escapeHtml(field.description)}</small>` : '';
}

function labelFromFieldName(fieldName) {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
