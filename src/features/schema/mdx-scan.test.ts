import assert from 'node:assert/strict';
import test from 'node:test';
import { componentRoot, disallowedComponents, scanMdxBody } from './mdx-scan.js';

test('scanMdxBody reports capitalized JSX tags and ignores html tags', () => {
  const scan = scanMdxBody([
    '# Title',
    '',
    '<Callout level="warn">Careful.</Callout>',
    '',
    '<div className="plain">html stays invisible</div>',
  ].join('\n'));

  assert.deepEqual(scan.components, ['Callout']);
  assert.deepEqual(scan.imports, []);
  assert.deepEqual(scan.exports, []);
});

test('scanMdxBody handles self-closing, dotted, and repeated tags', () => {
  const scan = scanMdxBody([
    '<Tabs.Item value="a" />',
    '<Tabs.Item value="b" />',
    '<Wrap><Chip /></Wrap>',
  ].join('\n'));

  assert.deepEqual(scan.components, ['Chip', 'Tabs.Item', 'Wrap']);
  assert.equal(componentRoot('Tabs.Item'), 'Tabs');
  assert.equal(componentRoot('Chip'), 'Chip');
});

test('scanMdxBody skips fenced code blocks including tilde fences and info strings', () => {
  const scan = scanMdxBody([
    'Use it like this:',
    '',
    '```jsx',
    '<Marquee speed={9} />',
    '```',
    '',
    '~~~~mdx',
    '<AlsoSkipped />',
    '~~~~',
    '',
    '<Kept />',
  ].join('\n'));

  assert.deepEqual(scan.components, ['Kept']);
});

test('scanMdxBody skips inline code spans including multi-backtick spans', () => {
  const scan = scanMdxBody([
    'Write `<Marquee>` to scroll, or `` literal `<Nested>` backticks ``.',
    'A `Promise<T>` in prose stays invisible too.',
    '<Real />',
  ].join('\n'));

  assert.deepEqual(scan.components, ['Real']);
});

test('scanMdxBody skips html and mdx comments', () => {
  const scan = scanMdxBody([
    '<!-- <Hidden /> -->',
    '{/* <AlsoHidden /> */}',
    '<Shown />',
  ].join('\n'));

  assert.deepEqual(scan.components, ['Shown']);
});

test('scanMdxBody does not report literal tags inside attribute strings but does report attribute expressions', () => {
  const scan = scanMdxBody([
    '<Note title="<Fake>" icon={<Star />}>',
    'body',
    '</Note>',
  ].join('\n'));

  assert.deepEqual(scan.components, ['Note', 'Star']);
});

test('scanMdxBody consumes multi-line tags and scans their children', () => {
  const scan = scanMdxBody([
    '<Hero',
    '  title="Welcome"',
    '  size={42}',
    '>',
    '  <Badge label="new" />',
    '</Hero>',
  ].join('\n'));

  assert.deepEqual(scan.components, ['Badge', 'Hero']);
});

test('scanMdxBody inventories imports and treats their locals as components', () => {
  const scan = scanMdxBody([
    "import Chart from './chart.js';",
    "import { Callout as Note, CodeTabs } from '@acme/docs-ui';",
    "import * as Widgets from './widgets.js';",
    "import './side-effect.css';",
    '',
    '<Chart data={[1, 2]} />',
    '<Note level="info">hi</Note>',
    '<Widgets.Spark />',
  ].join('\n'));

  assert.deepEqual(scan.imports, ['./chart.js', './side-effect.css', './widgets.js', '@acme/docs-ui']);
  assert.deepEqual(scan.components, ['Chart', 'Note', 'Widgets.Spark']);
  assert.deepEqual(disallowedComponents(scan, []), []);
});

test('scanMdxBody inventories multi-line imports', () => {
  const scan = scanMdxBody([
    'import {',
    '  Callout,',
    '  CodeTabs,',
    "} from './components.js'",
    '',
    '<Callout />',
  ].join('\n'));

  assert.deepEqual(scan.imports, ['./components.js']);
  assert.deepEqual(disallowedComponents(scan, []), []);
});

test('scanMdxBody inventories exports and scans their JSX', () => {
  const scan = scanMdxBody([
    'export const banner = <Warn level="high" />;',
    'export function helper() { return 1; }',
    'export { banner as topBanner };',
    '',
    '<banner.nope />',
  ].join('\n'));

  assert.deepEqual(scan.exports, ['banner', 'helper', 'topBanner']);
  assert.deepEqual(scan.components, ['Warn']);
});

test('scanMdxBody ignores autolinks and closing tags', () => {
  const scan = scanMdxBody([
    'Visit <https://example.com> for details.',
    '<Panel>',
    'text',
    '</Panel>',
  ].join('\n'));

  assert.deepEqual(scan.components, ['Panel']);
});

test('scanMdxBody returns empty results for plain markdown', () => {
  const scan = scanMdxBody('# Hello\n\nJust prose with a [link](./somewhere.md).\n');

  assert.deepEqual(scan, { components: [], imports: [], exports: [], localNames: [] });
});

test('disallowedComponents allows roots, full names, and document-local names', () => {
  const scan = scanMdxBody([
    "import Chart from './chart.js'",
    '',
    '<Callout />',
    '<Tabs.Item />',
    '<Chart />',
    '<Marquee speed={9} />',
  ].join('\n'));

  assert.deepEqual(disallowedComponents(scan, ['Callout', 'Tabs']), ['Marquee']);
  assert.deepEqual(disallowedComponents(scan, ['Callout', 'Tabs.Item', 'Marquee']), []);
});
