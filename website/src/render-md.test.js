import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, extractTitle, extractHeadings } from './render-md.js';
import { rewriteMarkdownLink } from './link-map.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('renderMarkdown converts headings, code blocks, and tables', () => {
  const markdown = [
    '# Getting Started',
    '',
    'Use `async-db init` then read [Configuration](./configuration.md).',
    '',
    '```bash',
    'pnpm exec async-db serve',
    '```',
    '',
    '| Key | Default |',
    '| --- | --- |',
    '| graphql.enabled | false |',
  ].join('\n');

  const html = renderMarkdown(markdown);
  assert.match(html, /<h1 id="getting-started">Getting Started<\/h1>/);
  assert.match(html, /<code[^>]*>async-db init<\/code>/);
  assert.match(html, /href="\.\/configuration\.html"/);
  assert.match(html, /<pre[^>]*>[\s\S]*pnpm exec async-db serve/);
  assert.match(html, /<table[\s\S]*graphql\.enabled/);
});

test('rewriteMarkdownLink maps allowlisted docs and examples', () => {
  assert.equal(rewriteMarkdownLink('./configuration.md'), './configuration.html');
  assert.equal(rewriteMarkdownLink('./generated-files.md#generated-types'), './generated-files.html#generated-types');
  assert.equal(rewriteMarkdownLink('./advanced/overview.md'), './advanced/overview.html');
  assert.equal(rewriteMarkdownLink('../configuration.md', { linkContext: 'advanced' }), '../configuration.html');
  assert.match(rewriteMarkdownLink('../examples/basic/README.md'), /github\.com\/async\/db\/blob\/main\/examples\/basic\/README\.md/);
});

test('renderMarkdown converts GitHub-style admonitions', () => {
  const markdown = [
    '> [!NOTE]',
    '> GraphQL is opt-in.',
    '',
    '> [!WARNING]',
    '> Refs are not secrets.',
  ].join('\n');
  const html = renderMarkdown(markdown);
  assert.match(html, /role="note"/);
  assert.match(html, />Note</);
  assert.match(html, />Warning</);
  assert.match(html, /GraphQL is opt-in/);
});

test('rewriteMarkdownLink sends excluded docs to GitHub and fails unknown targets in strict mode', () => {
  assert.match(rewriteMarkdownLink('./architecture.md', { strict: true }), /blob\/main\/docs\/architecture\.md/);
  assert.throws(() => rewriteMarkdownLink('./no-such-page.md', { strict: true }), /not a known docs page/);
});

test('extractTitle and extractHeadings read manual snippets', async () => {
  const configuration = await readFile(path.join(repoRoot, 'docs/configuration.md'), 'utf8');
  assert.match(extractTitle(configuration), /Configuration/i);
  const headings = extractHeadings(configuration);
  assert.ok(headings.some((heading) => heading.level === 2));
});

test('renderMarkdown renders package-api fenced code labels', async () => {
  const packageApi = await readFile(path.join(repoRoot, 'docs/package-api.md'), 'utf8');
  const slice = packageApi.split('\n').slice(0, 80).join('\n');
  const html = renderMarkdown(slice);
  assert.match(html, /<pre[\s\S]*<code/);
});
