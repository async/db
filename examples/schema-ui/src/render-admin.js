import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const fieldTemplates = [
  {
    component: 'text',
    view({ fieldName, field }) {
      return `<span data-field="${escapeHtml(fieldName)}">{{ ${escapeHtml(fieldName)} }}</span>${hint(field)}`;
    },
    editor({ fieldName, field }) {
      return `<input name="${escapeHtml(fieldName)}" type="text" ${required(field)}>${hint(field)}`;
    },
  },
  {
    component: 'email',
    view({ fieldName, field }) {
      return `<a href="mailto:{{ ${escapeHtml(fieldName)} }}">{{ ${escapeHtml(fieldName)} }}</a>${hint(field)}`;
    },
    editor({ fieldName, field }) {
      return `<input name="${escapeHtml(fieldName)}" type="email" ${required(field)}>${hint(field)}`;
    },
  },
  {
    component: 'textarea',
    view({ fieldName, field }) {
      return `<p data-field="${escapeHtml(fieldName)}">{{ ${escapeHtml(fieldName)} }}</p>${hint(field)}`;
    },
    editor({ fieldName, field }) {
      return `<textarea name="${escapeHtml(fieldName)}" ${required(field)}></textarea>${hint(field)}`;
    },
  },
  {
    component: 'markdown',
    view({ fieldName, field }) {
      return `<article data-field="${escapeHtml(fieldName)}">{{ rendered ${escapeHtml(fieldName)} }}</article>${hint(field)}`;
    },
    editor({ fieldName, field }) {
      return `<textarea name="${escapeHtml(fieldName)}" data-editor="markdown" ${required(field)}></textarea>${hint(field)}`;
    },
  },
  {
    component: 'segmented-control',
    view({ fieldName, field }) {
      return `<span data-field="${escapeHtml(fieldName)}">{{ ${escapeHtml(fieldName)} }}</span>${hint(field)}`;
    },
    editor({ fieldName, field }) {
      return `<fieldset>${legend(field)}${options(field).map((value) => (
        `<label><input type="radio" name="${escapeHtml(fieldName)}" value="${escapeHtml(value)}"> ${escapeHtml(value)}</label>`
      )).join('')}</fieldset>${hint(field)}`;
    },
  },
  {
    component: 'relationSelect',
    view({ fieldName, field }) {
      const relation = field.relation?.name ?? fieldName;
      return `<a href="#${escapeHtml(relation)}-{{ ${escapeHtml(fieldName)} }}">{{ ${escapeHtml(relation)} label }}</a>${hint(field)}`;
    },
    editor({ fieldName, field }) {
      const source = field.ui?.optionsFrom ?? field.relation?.to ?? 'records';
      return `<select name="${escapeHtml(fieldName)}" data-options-from="${escapeHtml(source)}" ${required(field)}></select>${hint(field)}`;
    },
  },
];

const templateByComponent = new Map(fieldTemplates.map((template) => [template.component, template]));
const fallbackTemplate = templateByComponent.get('text');

/** @param {unknown} schemaManifest */
export function renderSchemaUiHtml(schemaManifest) {
  return renderCms(schemaManifest);
}

/** @param {URL | string} manifestUrl */
export async function readManifest(manifestUrl) {
  const raw = await readFile(manifestUrl, 'utf8');
  return JSON.parse(raw);
}

function renderCms(schemaManifest) {
  const collections = Object.values(schemaManifest.collections ?? {});
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Schema UI Example</title>
</head>
<body>
  <main>
    <h1>Schema UI Example</h1>
    <p>This HTML is generated from src/generated/db.schema.json.</p>
${collections.map(renderCollection).join('\n')}
  </main>
</body>
</html>`;
}

function renderCollection(resource) {
  const title = resource.editor?.title ?? resource.name;
  const description = resource.editor?.description ?? resource.description ?? '';
  const fields = Object.entries(resource.fields ?? {});
  return `    <section data-resource="${escapeHtml(resource.name)}">
      <header>
        <h2>${escapeHtml(title)}</h2>
        ${description ? `<p>${escapeHtml(description)}</p>` : ''}
      </header>
      <div class="cms-view">
        <h3>View template</h3>
${fields.map(([fieldName, field]) => renderField('view', fieldName, field)).join('\n')}
      </div>
      <form class="cms-editor">
        <h3>Editor template</h3>
${fields.map(([fieldName, field]) => renderField('editor', fieldName, field)).join('\n')}
      </form>
    </section>`;
}

function renderField(mode, fieldName, field) {
  const component = field.ui?.component ?? 'text';
  const template = templateByComponent.get(component) ?? fallbackTemplate;
  const label = field.ui?.label ?? labelFromFieldName(fieldName);
  const body = template[mode]({ fieldName, field });

  return `        <template data-mode="${mode}" data-component="${escapeHtml(component)}" data-field="${escapeHtml(fieldName)}">
          <label>${escapeHtml(label)}</label>
          ${body}
        </template>`;
}

function required(field) {
  return field.required ? 'required' : '';
}

function legend(field) {
  return `<legend>${escapeHtml(field.ui?.label ?? 'Choose one')}</legend>`;
}

function options(field) {
  return Array.isArray(field.values) ? field.values : [];
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isPrimaryModule() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
}

if (isPrimaryModule()) {
  const manifestUrl = new URL('./generated/db.schema.json', import.meta.url);
  const manifest = await readManifest(manifestUrl);
  console.log(renderSchemaUiHtml(manifest));
}
