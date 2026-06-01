import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dbError } from '../../errors.js';

export type DbScope = {
  fork: string | null;
  branch: string;
  rootStateDir: string;
};

export type RuntimeScopeConfig = {
  cwd: string;
  stateDir: string;
  resources?: Record<string, unknown>;
  __asyncDbScope?: DbScope;
  [key: string]: unknown;
};

export type MigrationLock = {
  name: string;
  resources: string[];
  mode: 'read-only';
  startedAt: string;
};

export function normalizeScopedConfig<TConfig extends RuntimeScopeConfig>(
  config: TConfig,
  scope?: DbScope,
): { config: TConfig; scope: DbScope } {
  const next = {
    ...config,
    resources: cloneConfigResources(config.resources),
  } as TConfig;
  const nextScope = scope ?? next.__asyncDbScope ?? {
    fork: null,
    branch: 'main',
    rootStateDir: config.stateDir,
  };

  next.__asyncDbScope = nextScope;
  applyPersistedRouting(next, nextScope);
  return {
    config: next,
    scope: nextScope,
  };
}

export function scopedConfig(config: RuntimeScopeConfig, scope: DbScope): RuntimeScopeConfig {
  const stateDir = scope.fork
    ? path.join(scope.rootStateDir, 'forks', scope.fork, 'branches', scope.branch)
    : scope.rootStateDir;
  return {
    ...config,
    stateDir,
    __asyncDbScope: scope,
  };
}

export function forkRegistryPath(rootStateDir: string): string {
  return path.join(rootStateDir, 'forks', 'registry.json');
}

export function branchRegistryPath(rootStateDir: string, fork: string): string {
  return path.join(rootStateDir, 'forks', fork, 'branches', 'registry.json');
}

export function snapshotDirForScope(scope: DbScope, snapshotId: string): string {
  return scope.fork
    ? path.join(scope.rootStateDir, 'forks', scope.fork, 'snapshots', snapshotId)
    : path.join(scope.rootStateDir, 'snapshots', snapshotId);
}

export function routingPathForScope(scope: DbScope): string {
  return path.join(branchMetaDirForScope(scope), 'routing.json');
}

export function migrationLocksPathForScope(scope: DbScope): string {
  return path.join(branchMetaDirForScope(scope), 'migration-locks.json');
}

export function loadPersistedMigrationLocks(scope: DbScope): Map<string, MigrationLock> {
  const state = readJsonFileSync(migrationLocksPathForScope(scope), { locks: {} });
  const locks = new Map<string, MigrationLock>();
  for (const [name, value] of Object.entries(configRecord(state.locks))) {
    const lock = configRecord(value);
    if (!Array.isArray(lock.resources)) {
      continue;
    }
    locks.set(name, {
      name,
      resources: lock.resources.map(String),
      mode: 'read-only',
      startedAt: typeof lock.startedAt === 'string' ? lock.startedAt : '',
    });
  }
  return locks;
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function snapshotId(label?: string): string {
  const safeLabel = label
    ? `_${slugPart(label)}`
    : '';
  return `snap_${new Date().toISOString().replace(/[-:.TZ]/g, '')}${safeLabel}_${Math.random().toString(36).slice(2, 8)}`;
}

export function assertValidSnapshotId(id: string): void {
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) {
    return;
  }
  throw dbError(
    'DB_SNAPSHOT_ID_INVALID',
    `Invalid snapshot id "${id}".`,
    {
      status: 400,
      hint: 'Use a snapshot id with letters, numbers, dots, underscores, or hyphens.',
      details: {
        snapshot: id,
      },
    },
  );
}

export function assertValidScopedName(name: string, kind: string): void {
  if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(name ?? ''))) {
    return;
  }
  throw dbError(
    'DB_SCOPE_NAME_INVALID',
    `Invalid ${kind} name "${name}".`,
    {
      status: 400,
      hint: 'Use a folder-style name with letters, numbers, underscores, or hyphens.',
      details: {
        kind,
        name,
      },
    },
  );
}

export function configRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function cloneConfigResources(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([name, config]) => [name, cloneConfigValue(config)]),
  );
}

function branchMetaDirForScope(scope: DbScope): string {
  return scope.fork
    ? path.join(scope.rootStateDir, 'forks', scope.fork, 'branches', scope.branch, 'meta')
    : path.join(scope.rootStateDir, 'meta');
}

function applyPersistedRouting(config: RuntimeScopeConfig, scope: DbScope): void {
  const routes = readJsonFileSync(routingPathForScope(scope), {} as Record<string, string>);
  if (Object.keys(routes).length === 0) {
    return;
  }
  const resourcesConfig = cloneConfigResources(config.resources) ?? {};
  for (const [resourceName, storeName] of Object.entries(routes)) {
    const existing = configRecord(resourcesConfig[resourceName]);
    resourcesConfig[resourceName] = {
      ...existing,
      store: storeName,
    };
  }
  config.resources = resourcesConfig;
}

function readJsonFileSync<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function cloneConfigValue(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : value;
}
