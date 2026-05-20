import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function makeProject() {
  const cwd = await mkdtemp(path.join(tmpdir(), 'async-db-test-'));
  await mkdir(path.join(cwd, 'db'), { recursive: true });
  await mkdir(path.join(cwd, 'node_modules/@async'), { recursive: true });
  await symlink(path.resolve('.'), path.join(cwd, 'node_modules/@async/db'), 'dir');
  return cwd;
}

export async function writeFixture(cwd, filename, content) {
  await writeFile(path.join(cwd, 'db', filename), `${content}\n`, 'utf8');
}

export async function writeConfig(cwd, content) {
  await writeFile(path.join(cwd, 'db.config.mjs'), `${content}\n`, 'utf8');
}
