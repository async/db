import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type NodeFsError = Error & {
  code?: string;
};

export async function readText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}

export async function writeText(filePath: string, content: string): Promise<boolean> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    if ((await readFile(filePath, 'utf8')) === content) {
      return false;
    }
  } catch (error) {
    const fsError = error as NodeFsError;
    if (fsError.code !== 'ENOENT') {
      throw error;
    }
  }
  await writeFile(filePath, content, 'utf8');
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
