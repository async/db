import path from 'node:path';
import { dbError, listChoices } from '../../errors.js';
import { dbFileSystem } from '../../features/fs/index.js';
import {
  lifecycleEntryFor,
  readLifecycleFile,
  writeLifecycleFile,
  LIFECYCLE_FILE,
  type LifecycleFile,
} from '../../features/config/lifecycle.js';
import { statePathForResource, withJsonStateWrite, writeJsonState } from '../../features/storage/json.js';
import { applyDefaultsToSeed } from '../../features/sync/defaults.js';
import { seedForRuntimeState } from '../../features/sync/synthetic-seed.js';
import { loadProjectSchema } from '../../schema.js';
import { schemaSourceForResource } from './schema.js';

type CliConfig = {
  cwd: string;
  stateDir: string;
  sourceDir: string;
  stores?: Record<string, unknown>;
  resources?: Record<string, unknown>;
  lifecycle?: LifecycleFile;
  [key: string]: unknown;
};

type ProjectResource = {
  name: string;
  kind?: string;
  schemaPath?: string | null;
  dataHash?: string | null;
  dataPath?: string | null;
  [key: string]: unknown;
};

type Project = {
  resources: ProjectResource[];
};

/**
 * `async-db promote <resource>` — the zero-to-production ceremony. The draft
 * file's accumulated data is frozen as the seed (its hash is pinned), the
 * schema is captured if missing, and live writes move to the chosen engine.
 * Everything it decides is written to db.lifecycle.jsonc so the promotion is
 * reviewable in the PR and db.config.js never needs machine edits.
 */
export async function runPromote(config: CliConfig, args: string[]): Promise<void> {
  const resourceName = args.find((arg) => !arg.startsWith('-'));
  if (!resourceName) {
    throw new Error('Usage: async-db promote <resource> [--store json|file|<registered>] [--fsync always|everysec|no] [--dry-run]');
  }

  const project = await loadProjectSchema(config) as Project;
  const resource = requireResource(project, resourceName);
  const store = flagValue(args, '--store') ?? 'json';
  const fsync = flagValue(args, '--fsync') ?? 'everysec';
  const dryRun = args.includes('--dry-run');
  assertKnownStore(config, store);
  if (!['always', 'everysec', 'no'].includes(fsync)) {
    throw new Error(`Unknown --fsync policy "${fsync}". Use always, everysec, or no.`);
  }

  const fs = dbFileSystem(config);
  const actions: string[] = [];

  // 1. Capture the schema the draft data taught, if none is written yet.
  let schemaFile = resource.schemaPath ? path.relative(config.cwd, String(resource.schemaPath)) : null;
  if (!resource.schemaPath) {
    const inferredProject = await loadProjectSchema({
      ...config,
      schema: { ...(config.schema as Record<string, unknown>), source: 'data' },
    }) as Project;
    const inferred = inferredProject.resources.find((candidate) => candidate.name === resource.name);
    if (inferred) {
      schemaFile = path.join(path.relative(config.cwd, config.sourceDir), `${resource.name}.schema.jsonc`);
      actions.push(`write inferred schema to ${schemaFile}`);
      if (!dryRun) {
        await fs.writeFile(
          path.resolve(config.cwd, schemaFile),
          `${JSON.stringify(schemaSourceForResource(inferred as never), null, 2)}\n`,
          'utf8',
        );
      }
    }
  }

  // 2. Freeze the seed: pin the source file hash at this moment.
  const seedHash = resource.dataHash ?? null;
  actions.push(seedHash
    ? `pin seed ${path.relative(config.cwd, String(resource.dataPath ?? ''))} (hash ${String(seedHash).slice(0, 12)}…)`
    : 'no source data file; resource seeds empty');

  // 3. Record the engine and durability choice.
  const lifecycle: LifecycleFile = (await readLifecycleFile(config.cwd, fs)) ?? {};
  lifecycle.resources = {
    ...lifecycle.resources,
    [resource.name]: {
      phase: 'production',
      store: store === 'file' ? 'sourceFile' : store,
      seedHash,
      promotedAt: new Date().toISOString(),
    },
  };
  if (store === 'json' || store === 'file') {
    const storeKey = store === 'file' ? 'sourceFile' : 'json';
    lifecycle.stores = {
      ...lifecycle.stores,
      [storeKey]: {
        ...(lifecycle.stores?.[storeKey] ?? {}),
        driver: storeKey,
        durability: 'wal',
        fsync,
      },
    };
    actions.push(`live writes -> ${store === 'file' ? 'the source file (production file tier)' : '.db/state'} with wal durability (fsync ${fsync})`);
  } else {
    actions.push(`live writes -> registered store "${store}"`);
  }
  actions.push(`update ${LIFECYCLE_FILE}`);

  if (!dryRun) {
    await writeLifecycleFile(config.cwd, lifecycle, fs);
  }

  console.log(JSON.stringify({
    resource: resource.name,
    phase: 'production',
    store: store === 'file' ? 'sourceFile' : store,
    fsync: store === 'json' || store === 'file' ? fsync : undefined,
    seedHash,
    schemaFile,
    dryRun,
    actions,
    guarantees: store === 'json' || store === 'file'
      ? [
          fsync === 'always'
            ? 'acknowledged writes are fsynced to the write-ahead log before returning'
            : fsync === 'everysec'
              ? 'acknowledged writes lose at most ~1s on power loss (wal everysec)'
              : 'wal flushing is left to the OS (fsync: no)',
          'checkpoints are atomic, fsynced, versioned, and crash-recovered by replay',
          'the seed file is frozen: sync will not silently reset production state',
        ]
      : ['the registered store owns durability; the seed file is frozen'],
  }, null, 2));
}

/** Derived phase per resource — computed, never stored, so it cannot drift. */
export async function runStatus(config: CliConfig, args: string[]): Promise<void> {
  const project = await loadProjectSchema(config) as Project;
  const rows = project.resources.map((resource) => {
    const entry = lifecycleEntryFor(config, resource.name);
    const resourceConfig = (config.resources?.[resource.name] ?? {}) as { store?: string };
    const store = entry?.store ?? resourceConfig.store ?? String((config.stores as { default?: string } | undefined)?.default ?? 'json');
    const storeConfig = (config.stores?.[store] ?? {}) as { durability?: string; fsync?: string };

    // Content collections (static store) are born canonical: the files are
    // simultaneously seed, live data, and contract. Git is their durability
    // layer, so the draft/production ladder does not apply to them.
    const phase = store === 'static'
      ? 'content (files)'
      : entry
        ? `production (${entry.store === 'sourceFile' ? 'file' : entry.store})`
        : store === 'sourceFile'
          ? 'draft'
          : `dev (${store})`;
    const seedDrift = Boolean(entry?.seedHash && resource.dataHash && resource.dataHash !== entry.seedHash);

    return {
      resource: resource.name,
      kind: resource.kind,
      phase,
      store,
      durability: storeConfig.durability ?? 'current',
      fsync: storeConfig.durability === 'wal' ? storeConfig.fsync ?? 'everysec' : undefined,
      schema: Boolean(resource.schemaPath),
      seedPinned: Boolean(entry?.seedHash),
      seedDrift,
      next: store === 'static'
        ? undefined
        : entry
          ? (seedDrift ? `seed drifted — async-db reseed ${resource.name} --force if intended` : undefined)
          : `promote when ready: async-db promote ${resource.name}`,
    };
  });

  if (args.includes('--json')) {
    console.log(JSON.stringify({ resources: rows }, null, 2));
    return;
  }

  for (const row of rows) {
    const durability = row.durability === 'wal' ? `wal ${row.fsync}` : row.durability;
    const flags = [
      row.schema ? 'schema' : 'no schema',
      row.seedPinned ? (row.seedDrift ? 'seed DRIFTED' : 'seed pinned') : null,
    ].filter(Boolean).join(' · ');
    console.log(`${row.resource.padEnd(20)} ${row.phase.padEnd(22)} ${durability.padEnd(14)} ${flags}${row.next ? `\n${' '.repeat(20)} ↳ ${row.next}` : ''}`);
  }
}

/** Explicitly re-apply the seed to live state and re-pin its hash. */
export async function runReseed(config: CliConfig, args: string[]): Promise<void> {
  const resourceName = args.find((arg) => !arg.startsWith('-'));
  if (!resourceName) {
    throw new Error('Usage: async-db reseed <resource> --force');
  }
  if (!args.includes('--force')) {
    throw dbError(
      'RESEED_REQUIRES_FORCE',
      `Reseeding "${resourceName}" replaces its live state with the seed file.`,
      {
        status: 400,
        hint: 'Run async-db reseed with --force when you mean it; back up or version state first if unsure.',
        details: { resource: resourceName },
      },
    );
  }

  const project = await loadProjectSchema(config) as Project;
  const resource = requireResource(project, resourceName);
  const fs = dbFileSystem(config);
  const statePath = statePathForResource(config, resource.name);
  await withJsonStateWrite(statePath, async () => {
    await writeJsonState(statePath, applyDefaultsToSeed(seedForRuntimeState(resource as never, config as never), resource as never, config as never), fs);
  }, { fs, crossProcessLock: !config.fs });

  const lifecycle = (await readLifecycleFile(config.cwd, fs)) ?? {};
  const entry = lifecycle.resources?.[resource.name];
  if (entry) {
    entry.seedHash = resource.dataHash ?? null;
    await writeLifecycleFile(config.cwd, lifecycle, fs);
  }

  console.log(JSON.stringify({
    resource: resource.name,
    reseeded: true,
    seedHash: resource.dataHash ?? null,
    statePath: path.relative(config.cwd, statePath),
  }, null, 2));
}

function requireResource(project: Project, name: string): ProjectResource {
  const resource = project.resources.find((candidate) => candidate.name === name);
  if (!resource) {
    throw dbError(
      'LIFECYCLE_UNKNOWN_RESOURCE',
      `Unknown resource "${name}".`,
      {
        status: 404,
        hint: `Use one of: ${listChoices(project.resources.map((candidate) => candidate.name))}.`,
        details: { resource: name },
      },
    );
  }
  return resource;
}

function assertKnownStore(config: CliConfig, store: string): void {
  if (store === 'json' || store === 'file' || store === 'sourceFile') {
    return;
  }
  if (config.stores && Object.prototype.hasOwnProperty.call(config.stores, store)) {
    return;
  }
  throw dbError(
    'PROMOTE_UNKNOWN_STORE',
    `Cannot promote to unknown store "${store}".`,
    {
      status: 400,
      hint: 'Use json, file, or a store name registered under stores in db.config.js.',
      details: {
        store,
        availableStores: ['json', 'file', ...Object.keys(config.stores ?? {})],
      },
    },
  );
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 || index + 1 >= args.length ? undefined : args[index + 1];
}
