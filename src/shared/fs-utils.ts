import path from 'node:path';
import { dbFileSystem, type DbFileSystem } from '../features/fs/index.js';

type NodeFsError = Error & {
  code?: string;
};

export async function readText(filePath: string, fs?: DbFileSystem): Promise<string> {
  return dbFileSystem({ fs }).readFile(filePath, 'utf8') as Promise<string>;
}

export async function writeText(filePath: string, content: string, fs?: DbFileSystem): Promise<boolean> {
  const fileSystem = dbFileSystem({ fs });
  await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
  try {
    if ((await fileSystem.readFile(filePath, 'utf8')) === content) {
      return false;
    }
  } catch (error) {
    const fsError = error as NodeFsError;
    if (fsError.code !== 'ENOENT') {
      throw error;
    }
  }
  await fileSystem.writeFile(filePath, content, 'utf8');
  return true;
}

export function resolveFrom(baseDir: string, maybeRelative: string): string {
  if (path.isAbsolute(maybeRelative)) {
    return maybeRelative;
  }

  return path.resolve(baseDir, maybeRelative);
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}
