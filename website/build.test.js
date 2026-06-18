import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDocsBuild } from './build.js';
import { ALLOWED_ADVANCED_IDS, ALLOWED_PAGE_IDS } from './src/link-map.js';
import { loadAllExamples } from './src/examples-loader.js';
import { LEVEL_ORDER } from './src/examples-meta.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('docs build renders all allowlisted pages and passes link validation', async () => {
  const result = await runDocsBuild(['--check']);
  assert.equal(result.ok, true);
  assert.equal(result.pages, ALLOWED_PAGE_IDS.size);
  assert.equal(result.advanced, ALLOWED_ADVANCED_IDS.size);
  assert.equal(result.examples, 1);
});

test('docs build includes data-files page id and examples explorer page', async () => {
  assert.ok(ALLOWED_PAGE_IDS.has('data-files-and-schemas'));
  assert.equal(ALLOWED_PAGE_IDS.has('fixtures-and-schemas'), false);
});

test('examples loader discovers every example ordered by complexity', async () => {
  const examples = await loadAllExamples(repoRoot);
  assert.equal(examples.length, 22);

  const levelIndexes = examples.map((example) => LEVEL_ORDER.indexOf(example.level));
  assert.deepEqual(levelIndexes, [...levelIndexes].sort((a, b) => a - b));

  for (const example of examples) {
    assert.ok(example.intro.length > 0, `${example.id} is missing a README intro`);
    assert.ok(example.files.length > 0, `${example.id} has no files`);
    assert.equal(example.files[0].path, 'README.md', `${example.id} should open on README.md`);
  }
});
