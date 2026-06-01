import { access } from 'node:fs/promises';
import path from 'node:path';
import { dbError, listChoices } from '../../errors.js';
import { resolveFrom } from '../../fs-utils.js';

const FORK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

type ConfigRecord = Record<string, any>;
type ConfigPath = readonly string[];

type ForkEntry = true | string | null | undefined | ConfigRecord;
type RawForks = ForkEntry[] | Record<string, ForkEntry>;

type ForkParentConfig = ConfigRecord & {
  cwd: string;
  forks?: Record<string, ConfigRecord>;
  stateDir: string;
  types?: ConfigRecord;
};

type DbLike = {
  config: ForkParentConfig;
  forkDbs?: Map<string, unknown>;
};

type OpenDbForFork = (options: ConfigRecord) => Promise<unknown>;

export function isValidForkName(name: unknown): boolean {
  return FORK_NAME_PATTERN.test(String(name ?? ''));
}

export function normalizeForks(config: ForkParentConfig, rawForks: RawForks = {}): Record<string, ConfigRecord> {
  const entries = Array.isArray(rawForks)
    ? rawForks.map((name) => [String(name), true])
    : Object.entries(rawForks ?? {});

  return Object.fromEntries(entries.map(([name, rawEntry]) => {
    const entry = normalizeForkEntry(rawEntry);
    const sourceDirValue = entry.sourceDir ?? entry.dbDir ?? `./db.forks/${name}`;
    const stateDirValue = forkOutputValue(entry, 'stateDir', ['stateDir'], path.join(config.stateDir, 'forks', name));
    const sourceDir = resolveFrom(config.cwd, sourceDirValue as string);
    const stateDir = resolveFrom(config.cwd, stateDirValue as string);
    const typeOptions = normalizeForkTypes(config, entry, stateDir);
    const outputs = {
      ...entry.outputs,
      stateDir,
      types: typeOptions.outFile,
      committedTypes: typeOptions.commitOutFile,
    };

    return [name, {
      ...config,
      ...entry,
      name,
      dbDir: sourceDir,
      sourceDir,
      stateDir,
      outputs,
      types: typeOptions,
      forks: {},
    }];
  }));
}

export function forkConfigForName(config: ForkParentConfig, name: unknown): ConfigRecord {
  const forkName = String(name ?? '');
  if (!isValidForkName(forkName)) {
    throw dbError(
      'FORK_NAME_INVALID',
      `Invalid db fork name "${forkName}".`,
      {
        status: 400,
        hint: 'Use a folder-style name with letters, numbers, underscores, or hyphens, such as "legacy-demo".',
        details: {
          fork: forkName,
        },
      },
    );
  }

  const forkConfig = config.forks?.[forkName];
  if (!forkConfig) {
    throw dbError(
      'FORK_NOT_FOUND',
      `Unknown db fork "${forkName}".`,
      {
        status: 404,
        hint: `Configure one of: ${listChoices(Object.keys(config.forks ?? {}))}.`,
        details: {
          fork: forkName,
          availableForks: Object.keys(config.forks ?? {}),
        },
      },
    );
  }

  return forkConfig;
}

export async function loadForkDb(parentDb: DbLike, forkName: string, openDb: OpenDbForFork): Promise<unknown> {
  parentDb.forkDbs ??= new Map();
  if (parentDb.forkDbs.has(forkName)) {
    return parentDb.forkDbs.get(forkName);
  }

  const forkConfig = forkConfigForName(parentDb.config, forkName);
  const forkDb = await openDb({
    ...forkConfig,
    allowSourceErrors: true,
  });
  parentDb.forkDbs.set(forkName, forkDb);
  return forkDb;
}

export async function forkSourceExists(forkConfig: { sourceDir: string }): Promise<boolean> {
  try {
    await access(forkConfig.sourceDir);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function normalizeForkEntry(rawEntry: ForkEntry): ConfigRecord {
  if (rawEntry === true || rawEntry === null || rawEntry === undefined) {
    return {};
  }

  if (typeof rawEntry === 'string') {
    return {
      dbDir: rawEntry,
    };
  }

  if (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)) {
    return rawEntry;
  }

  return {};
}

function normalizeForkTypes(config: ForkParentConfig, entry: ConfigRecord, stateDir: string): ConfigRecord {
  const entryTypes = entry.types ?? {};
  const outFileValue = forkOutputValue(entry, 'types', ['types', 'outFile'], path.join(stateDir, 'types/index.d.ts'));
  const commitOutFileValue = forkOutputValue(entry, 'committedTypes', ['types', 'commitOutFile'], null);
  const outFile = outFileValue && resolveFrom(config.cwd, outFileValue as string);
  const commitOutFile = commitOutFileValue && resolveFrom(config.cwd, commitOutFileValue as string);

  return {
    ...config.types,
    ...entryTypes,
    outFile,
    commitOutFile,
  };
}

function forkOutputValue(entry: ConfigRecord, outputKey: string, legacyPath: ConfigPath, fallback: string | null): unknown {
  const outputPath = ['outputs', outputKey];
  if (hasOwnPath(entry, outputPath)) {
    return getPath(entry, outputPath);
  }

  if (hasOwnPath(entry, legacyPath)) {
    return getPath(entry, legacyPath);
  }

  return fallback;
}

function hasOwnPath(config: unknown, pathParts: ConfigPath): boolean {
  let current = config;
  for (const pathPart of pathParts) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, pathPart)) {
      return false;
    }
    current = current[pathPart];
  }

  return current !== undefined;
}

function getPath(config: unknown, pathParts: ConfigPath): unknown {
  let current = config;
  for (const pathPart of pathParts) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[pathPart];
  }

  return current;
}

function isPlainObject(value: unknown): value is ConfigRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
