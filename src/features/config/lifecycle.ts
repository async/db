import path from 'node:path';
import { parseJsonc } from '../../jsonc.js';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';

/**
 * The lifecycle file is the machine-managed half of configuration: written
 * only by CLI ceremonies (`promote`, `reseed`), committed beside db.config.js,
 * and merged into config at load time. Human intent stays in db.config.js;
 * lifecycle facts (phase, engine, durability, pinned seed hash) live here so
 * promotion never has to rewrite user-owned JavaScript.
 */
export const LIFECYCLE_FILE = 'db.lifecycle.jsonc';

export type LifecycleResourceEntry = {
  phase: 'production';
  store: string;
  /** Source data file hash captured at promotion; sync refuses to silently reseed past it. */
  seedHash?: string | null;
  promotedAt?: string;
};

export type LifecycleFile = {
  resources?: Record<string, LifecycleResourceEntry>;
  stores?: Record<string, Record<string, unknown>>;
};

export function lifecyclePath(cwd: string): string {
  return path.join(cwd, LIFECYCLE_FILE);
}

export async function readLifecycleFile(cwd: string, fs: DbFileSystem = dbFileSystem()): Promise<LifecycleFile | null> {
  try {
    const text = await fs.readFile(lifecyclePath(cwd), 'utf8') as string;
    return parseJsonc<LifecycleFile>(text, LIFECYCLE_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeLifecycleFile(cwd: string, lifecycle: LifecycleFile, fs: DbFileSystem = dbFileSystem()): Promise<void> {
  const header = '// Managed by async-db (promote/reseed). Commit this file; edit via the CLI.\n';
  await fs.writeFile(lifecyclePath(cwd), `${header}${JSON.stringify(lifecycle, null, 2)}\n`, 'utf8');
}

type ConfigRecord = Record<string, unknown> & {
  resources?: Record<string, unknown>;
  stores?: Record<string, unknown>;
  lifecycle?: LifecycleFile;
};

/**
 * Merge lifecycle facts under user config: explicit db.config.js choices win,
 * lifecycle supplies store selection and durability defaults for promoted
 * resources, and the raw file is exposed as config.lifecycle for status,
 * doctor, and the seed guard.
 */
export function applyLifecycleToConfig(config: ConfigRecord, lifecycle: LifecycleFile | null): void {
  if (!lifecycle) {
    return;
  }
  config.lifecycle = lifecycle;

  const resources = config.resources ??= {};
  for (const [name, entry] of Object.entries(lifecycle.resources ?? {})) {
    const existing = (resources as Record<string, Record<string, unknown> | undefined>)[name];
    (resources as Record<string, unknown>)[name] = {
      store: entry.store,
      ...(typeof existing === 'object' ? existing : {}),
    };
  }

  const stores = config.stores ??= {};
  for (const [name, storeConfig] of Object.entries(lifecycle.stores ?? {})) {
    const existing = (stores as Record<string, unknown>)[name];
    (stores as Record<string, unknown>)[name] = {
      ...storeConfig,
      ...(typeof existing === 'object' && existing !== null ? existing as Record<string, unknown> : {}),
    };
  }
}

export function lifecycleEntryFor(config: ConfigRecord, resourceName: string): LifecycleResourceEntry | undefined {
  return config.lifecycle?.resources?.[resourceName];
}
