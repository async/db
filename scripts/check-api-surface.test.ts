import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateApiSurfaceCheck,
  isPublicSurfaceFile,
  normalizeGitPath,
} from './check-api-surface.js';

test('api surface check fails when public package files change without the ledger', () => {
  const result = evaluateApiSurfaceCheck({
    changedFiles: [
      'src/index.d.ts',
      'src/features/runtime/collection.ts',
      'test/runtime/package-api.test.ts',
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.apiSurfaceChanged, false);
  assert.deepEqual(result.publicSurfaceFiles, [
    'src/features/runtime/collection.ts',
    'src/index.d.ts',
  ]);
  assert.match(result.message, /API_SURFACE\.md did not change/u);
});

test('api surface check passes when the ledger changes with public files', () => {
  const result = evaluateApiSurfaceCheck({
    changedFiles: [
      'API_SURFACE.md',
      'package.json',
      'src/sqlite-compat.ts',
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.apiSurfaceChanged, true);
  assert.deepEqual(result.publicSurfaceFiles, [
    'package.json',
    'src/sqlite-compat.ts',
  ]);
});

test('api surface check ignores docs, tests, scripts, and examples', () => {
  const result = evaluateApiSurfaceCheck({
    changedFiles: [
      'docs/package-api.md',
      'scripts/check-api-surface.ts',
      'src/runtime.test.ts',
      'test/package/exports.test.ts',
      'examples/basic/README.md',
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.publicSurfaceFiles.length, 0);
});

test('api surface matcher tracks public integration and config surfaces', () => {
  assert.equal(isPublicSurfaceFile('src/cli/commands/integrate.ts'), true);
  assert.equal(isPublicSurfaceFile('src/features/integrate/sqlite-inspector.ts'), true);
  assert.equal(isPublicSurfaceFile('src/integrations/sqlite.ts'), true);
  assert.equal(isPublicSurfaceFile('src/config-public.ts'), true);
  assert.equal(isPublicSurfaceFile('src/sqlite.test.ts'), false);
});

test('api surface paths normalize to git-style paths', () => {
  assert.equal(normalizeGitPath('.\\src\\index.d.ts'), 'src/index.d.ts');
  assert.equal(normalizeGitPath('./API_SURFACE.md'), 'API_SURFACE.md');
});
