import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedVersion: string | undefined;

export async function readPackageVersion(): Promise<string> {
  if (cachedVersion) {
    return cachedVersion;
  }

  const packageFile = path.resolve(
    fileURLToPath(new URL('../..', import.meta.url)),
    'package.json',
  );
  const pkg = JSON.parse(await readFile(packageFile, 'utf8')) as { version?: string };
  cachedVersion = pkg.version ?? '0.0.0';
  return cachedVersion;
}
