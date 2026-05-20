import { access } from 'node:fs/promises';
import path from 'node:path';
import { dbError, listChoices } from '../../errors.js';
import { resolveFrom } from '../../fs-utils.js';

const FORK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isValidForkName(name) {
  return FORK_NAME_PATTERN.test(String(name ?? ''));
}

export function normalizeForks(config, rawForks = {}) {
  const entries = Array.isArray(rawForks)
    ? rawForks.map((name) => [String(name), true])
    : Object.entries(rawForks ?? {});

  return Object.fromEntries(entries.map(([name, rawEntry]) => {
    const entry = normalizeForkEntry(rawEntry);
    const sourceDirValue = entry.sourceDir ?? entry.dbDir ?? `./db.forks/${name}`;
    const stateDirValue = entry.stateDir ?? path.join(config.stateDir, 'forks', name);
    const sourceDir = resolveFrom(config.cwd, sourceDirValue);
    const stateDir = resolveFrom(config.cwd, stateDirValue);
    const typeOptions = normalizeForkTypes(config, entry, stateDir);

    return [name, {
      ...config,
      ...entry,
      name,
      dbDir: sourceDir,
      sourceDir,
      stateDir,
      types: typeOptions,
      forks: {},
    }];
  }));
}

export function forkConfigForName(config, name) {
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

export async function loadForkDb(parentDb, forkName, openDb) {
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

export async function forkSourceExists(forkConfig) {
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

function normalizeForkEntry(rawEntry) {
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

function normalizeForkTypes(config, entry, stateDir) {
  const entryTypes = entry.types ?? {};
  const outFile = Object.prototype.hasOwnProperty.call(entryTypes, 'outFile')
    ? resolveFrom(config.cwd, entryTypes.outFile)
    : path.join(stateDir, 'types/index.ts');
  const commitOutFile = Object.prototype.hasOwnProperty.call(entryTypes, 'commitOutFile')
    ? entryTypes.commitOutFile && resolveFrom(config.cwd, entryTypes.commitOutFile)
    : null;

  return {
    ...config.types,
    ...entryTypes,
    outFile,
    commitOutFile,
  };
}
