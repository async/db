import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(file));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(file);
    }
  }
  return files;
}

test('@async/json engine sources do not import @async/db platform modules', async () => {
  const jsonSourceRoot = path.resolve('../json/src');
  const files = await sourceFiles(jsonSourceRoot);
  assert.ok(files.length > 0, 'expected @async/json source files');

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /from\s+['"]@async\/db(?:\/|['"])/u, path.relative(jsonSourceRoot, file));
    assert.doesNotMatch(text, /from\s+['"](?:\.\.\/)+db\//u, path.relative(jsonSourceRoot, file));
  }
});
