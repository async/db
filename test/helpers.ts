import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function makeProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'async-db-test-'));
  await mkdir(path.join(cwd, 'db'), { recursive: true });
  await mkdir(path.join(cwd, 'node_modules/@async'), { recursive: true });
  await symlink(path.resolve('.'), path.join(cwd, 'node_modules/@async/db'), 'dir');
  return cwd;
}

export async function writeFixture(cwd: string, filename: string, content: string): Promise<void> {
  await writeFile(path.join(cwd, 'db', filename), `${content}\n`, 'utf8');
}

export async function writeConfig(cwd: string, content: string): Promise<void> {
  await writeFile(path.join(cwd, 'db.config.mjs'), `${content}\n`, 'utf8');
}
