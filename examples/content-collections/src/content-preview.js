import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '@async/db';

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = await openDb({ cwd: exampleRoot });
await db.runtime.hydrate();

const [docs, blog] = await Promise.all([
  db.collection('docs').all(),
  db.collection('blog').all(),
]);

const output = [
  '<main>',
  ...docs
    .sort((left, right) => (left.order ?? 100) - (right.order ?? 100))
    .map((record) => renderArticle('doc', record)),
  ...blog.map((record) => renderArticle('blog', {
    ...record,
    href: `/blog/${record.id}`,
  })),
  '</main>',
  '',
].join('\n');

console.log(output);

export function renderArticle(kind, record) {
  const title = escapeHtml(record.title ?? record.id);
  const body = renderMdxPreview(record.body ?? '');
  const href = record.href ? ` data-href="${escapeHtml(record.href)}"` : '';
  return [
    `<article data-kind="${kind}" data-id="${escapeHtml(record.id)}"${href}>`,
    `  <h2>${title}</h2>`,
    `  <p>${escapeHtml(record.summary ?? '')}</p>`,
    `  <div>${body}</div>`,
    '</article>',
  ].join('\n');
}

function renderMdxPreview(source) {
  return String(source)
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (block.startsWith('# ')) {
        return `<h1>${escapeHtml(block.slice(2))}</h1>`;
      }
      if (block.startsWith('## ')) {
        return `<h2>${escapeHtml(block.slice(3))}</h2>`;
      }
      const withoutJsxTags = block.replace(/<\/?[A-Z][^>]*>/gu, '');
      return `<p>${escapeHtml(withoutJsxTags)}</p>`;
    })
    .join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
