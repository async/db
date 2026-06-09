import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkDocsModuleExtensions, evaluateDocsModuleExtensionPolicy } from './check-docs-module-extensions.js';

test('docs module extension check fails on mjs and mts references outside the canonical doc', () => {
  const result = evaluateDocsModuleExtensionPolicy({
    'README.md': 'Use `db.config.mjs` for config.\nCompile from mts when needed.\n',
    'docs/configuration.md': 'Do not list `.mts` here.\n',
    'examples/basic/README.md': 'Run node ./src/demo.mjs\n',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.map((violation) => ({
    file: violation.file,
    line: violation.line,
    match: violation.match,
  })), [
    {
      file: 'docs/configuration.md',
      line: 1,
      match: '.mts',
    },
    {
      file: 'examples/basic/README.md',
      line: 1,
      match: '.mjs',
    },
    {
      file: 'README.md',
      line: 1,
      match: '.mjs',
    },
    {
      file: 'README.md',
      line: 2,
      match: 'mts',
    },
  ]);
  assert.match(result.message, /Docs should default to \.js ESM files/u);
  assert.match(result.message, /docs\/typescript-schema-sources\.md/u);
});

test('docs module extension check allows compatibility discussion only in the canonical doc', () => {
  const result = evaluateDocsModuleExtensionPolicy({
    'README.md': 'Use `db.config.js` for config.\n',
    'docs/typescript-schema-sources.md': `# TypeScript Schema Sources

### Compatibility Extensions

Compatibility: .mjs and .mts are supported discussion terms here.

### TypeScript Authoring

Compile schemas to .schema.js.
`,
    'examples/basic/README.md': 'Use `db/users.schema.js`.\n',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test('docs module extension check rejects compatibility mentions outside the canonical section', () => {
  const result = evaluateDocsModuleExtensionPolicy({
    'docs/typescript-schema-sources.md': `# TypeScript Schema Sources

Mentioning db.schema.mjs in the intro should still fail.

### Compatibility Extensions

Compatibility: .mjs and .mts are supported discussion terms here.

### TypeScript Authoring

Do not mention bare mts here either.
`,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.map((violation) => ({
    file: violation.file,
    line: violation.line,
    match: violation.match,
  })), [
    {
      file: 'docs/typescript-schema-sources.md',
      line: 3,
      match: '.mjs',
    },
    {
      file: 'docs/typescript-schema-sources.md',
      line: 11,
      match: 'mts',
    },
  ]);
});

test('docs module extension check normalizes paths and custom canonical doc paths', () => {
  const result = evaluateDocsModuleExtensionPolicy({
    './docs/module-extensions.md': `# Module Extensions

### Compatibility Extensions

Compatibility: .mjs .mts mjs mts.
`,
    '.\\README.md': 'Use db.config.js.\n',
  }, {
    allowedCompatibilityPath: './docs/module-extensions.md',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.checkedFiles, [
    'README.md',
    'docs/module-extensions.md',
  ]);
});

test('docs module extension check scans only repo docs markdown and mdx files', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'async-db-docs-lint-'));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  await mkdir(path.join(cwd, 'docs/goals'), { recursive: true });
  await mkdir(path.join(cwd, 'docs/design'), { recursive: true });
  await mkdir(path.join(cwd, 'examples/basic'), { recursive: true });
  await mkdir(path.join(cwd, 'src'), { recursive: true });

  await writeFile(path.join(cwd, 'README.md'), 'Use db.config.js.\n', 'utf8');
  await writeFile(path.join(cwd, 'SPEC.md'), 'Use db.schema.js.\n', 'utf8');
  await writeFile(path.join(cwd, 'API_SURFACE.md'), 'Use *.schema.js files.\n', 'utf8');
  await writeFile(path.join(cwd, 'AGENTS.md'), 'Historical internal note: db.config.mjs.\n', 'utf8');
  await writeFile(path.join(cwd, 'CHANGELOG.md'), 'Historical release note: db.config.mjs.\n', 'utf8');
  await writeFile(path.join(cwd, 'docs/index.html'), 'Generated HTML can still mention db.config.mjs.\n', 'utf8');
  await writeFile(path.join(cwd, 'docs/goals/legacy.md'), 'Goal archive can mention db.config.mjs.\n', 'utf8');
  await writeFile(path.join(cwd, 'src/readme.md'), 'Non-doc source markdown can mention db.config.mjs.\n', 'utf8');
  await writeFile(path.join(cwd, 'docs/typescript-schema-sources.md'), `# TypeScript Schema Sources

### Compatibility Extensions

Compatibility: .mjs .mts mjs mts.
`, 'utf8');
  await writeFile(path.join(cwd, 'docs/guide.mdx'), 'Use db.config.js.\n', 'utf8');
  await writeFile(path.join(cwd, 'examples/basic/README.md'), 'Run serve.js.\n', 'utf8');

  const clean = await checkDocsModuleExtensions({ cwd });
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.violations, []);
  assert.deepEqual(clean.checkedFiles, [
    'API_SURFACE.md',
    'README.md',
    'SPEC.md',
    'docs/guide.mdx',
    'docs/typescript-schema-sources.md',
    'examples/basic/README.md',
  ]);

  await writeFile(path.join(cwd, 'examples/basic/README.md'), 'Run serve.mjs.\n', 'utf8');
  const dirty = await checkDocsModuleExtensions({ cwd });
  assert.equal(dirty.ok, false);
  assert.deepEqual(dirty.violations.map((violation) => ({
    file: violation.file,
    match: violation.match,
  })), [
    {
      file: 'examples/basic/README.md',
      match: '.mjs',
    },
  ]);
});
