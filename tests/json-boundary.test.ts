import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

async function sourceFiles(directory: string, extension: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(file, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(file);
    }
  }
  return files;
}

test('@async/json package files do not import @async/db platform modules', async () => {
  const jsonEntry = fileURLToPath(import.meta.resolve('@async/json'));
  const jsonPackageRoot = path.dirname(jsonEntry);
  const files = await sourceFiles(jsonPackageRoot, '.js');
  assert.ok(files.length > 0, 'expected @async/json package files');

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /from\s+['"]@async\/db(?:\/|['"])/u, path.relative(jsonPackageRoot, file));
    assert.doesNotMatch(text, /from\s+['"](?:\.\.\/)+db\//u, path.relative(jsonPackageRoot, file));
  }
});
