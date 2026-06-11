import { createHash } from 'node:crypto';
import path from 'node:path';
import { dbError, listChoices } from '../../errors.js';
import { dbFileSystem } from '../../features/fs/index.js';
import {
  atomicWriteJsonVersioned,
  backupMetaPath,
  listJsonStateVersions,
  readJsonState,
  restoreJsonStateVersion,
  statePathForResource,
  withJsonStateWrite,
  writeJsonState,
} from '../../features/storage/json.js';
import { loadProjectSchema } from '../../schema.js';

type CliConfig = {
  cwd: string;
  stateDir: string;
  fs?: never;
  [key: string]: unknown;
};

type ProjectResource = {
  name: string;
  [key: string]: unknown;
};

type BackupBundle = {
  kind: 'async-db-backup';
  version: 1;
  createdAt: string;
  resources: Record<string, unknown>;
  hashes: Record<string, string>;
};

export async function runBackup(config: CliConfig, args: string[]): Promise<void> {
  const out = flagValue(args, '--out')
    ?? path.join(config.cwd, `db-backup-${backupTimestamp()}.json`);
  const fs = dbFileSystem(config);
  const project = await loadProjectSchema(config) as { resources: ProjectResource[] };

  const bundle: BackupBundle = {
    kind: 'async-db-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    resources: {},
    hashes: {},
  };

  const missing: string[] = [];
  for (const resource of project.resources) {
    const statePath = statePathForResource(config, resource.name);
    const value = await readJsonState<unknown>(statePath, undefined, fs);
    if (value === undefined) {
      missing.push(resource.name);
      continue;
    }
    bundle.resources[resource.name] = value;
    bundle.hashes[resource.name] = stateHash(value);
  }

  await writeJsonState(path.resolve(config.cwd, out), bundle, fs);
  await writeJsonState(backupMetaPath(config), {
    lastBackupAt: bundle.createdAt,
    file: path.resolve(config.cwd, out),
    resources: Object.keys(bundle.resources).length,
  }, fs);

  console.log(JSON.stringify({
    file: path.relative(config.cwd, path.resolve(config.cwd, out)),
    createdAt: bundle.createdAt,
    resources: Object.keys(bundle.resources),
    skippedWithoutState: missing,
  }, null, 2));
}

export async function runRestore(config: CliConfig, args: string[]): Promise<void> {
  const fromFile = flagValue(args, '--from');
  if (fromFile) {
    await restoreFromBundle(config, fromFile, args);
    return;
  }

  const resourceName = args.find((arg) => !arg.startsWith('-'));
  if (!resourceName) {
    throw new Error('Usage: async-db restore <resource> [--list] [--version <id|latest>] | async-db restore --from <backup.json> [--resource <name>] [--dry-run]');
  }

  const statePath = statePathForResource(config, resourceName);
  const fs = dbFileSystem(config);

  if (args.includes('--list')) {
    const versions = await listJsonStateVersions(statePath, fs);
    console.log(JSON.stringify({
      resource: resourceName,
      versions: versions.map((version) => ({
        version: version.file,
        at: new Date(version.at).toISOString(),
      })),
    }, null, 2));
    return;
  }

  const version = flagValue(args, '--version') ?? 'latest';
  const restored = await withJsonStateWrite(
    statePath,
    () => restoreJsonStateVersion(statePath, version, { fs }),
    { fs, crossProcessLock: true },
  );
  console.log(JSON.stringify({
    resource: resourceName,
    restored: restored.file,
    at: new Date(restored.at).toISOString(),
  }, null, 2));
}

async function restoreFromBundle(config: CliConfig, fromFile: string, args: string[]): Promise<void> {
  const fs = dbFileSystem(config);
  const bundlePath = path.resolve(config.cwd, fromFile);
  const bundle = await readJsonState<BackupBundle | undefined>(bundlePath, undefined, fs);
  if (!bundle || bundle.kind !== 'async-db-backup' || !bundle.resources) {
    throw dbError(
      'BACKUP_BUNDLE_INVALID',
      `${fromFile} is not an async-db backup bundle.`,
      {
        status: 400,
        hint: 'Create bundles with `async-db backup --out <file>`.',
        details: { file: bundlePath },
      },
    );
  }

  const only = flagValue(args, '--resource');
  const dryRun = args.includes('--dry-run');
  const names = Object.keys(bundle.resources).filter((name) => !only || name === only);
  if (only && names.length === 0) {
    throw dbError(
      'BACKUP_RESOURCE_NOT_FOUND',
      `Backup bundle has no resource "${only}".`,
      {
        status: 404,
        hint: `Use one of: ${listChoices(Object.keys(bundle.resources))}.`,
        details: { file: bundlePath, resource: only },
      },
    );
  }

  const plan: Array<{ resource: string; action: 'restore' | 'unchanged' }> = [];
  for (const name of names) {
    const statePath = statePathForResource(config, name);
    const current = await readJsonState<unknown>(statePath, undefined, fs);
    const unchanged = current !== undefined && stateHash(current) === (bundle.hashes?.[name] ?? stateHash(bundle.resources[name]));
    plan.push({ resource: name, action: unchanged ? 'unchanged' : 'restore' });

    if (dryRun || unchanged) {
      continue;
    }
    // Snapshot-then-write so a bundle restore is itself undoable per resource.
    await withJsonStateWrite(
      statePath,
      () => atomicWriteJsonVersioned(statePath, bundle.resources[name], { fs }),
      { fs, crossProcessLock: true },
    );
  }

  console.log(JSON.stringify({
    from: path.relative(config.cwd, bundlePath),
    createdAt: bundle.createdAt,
    dryRun,
    plan,
  }, null, 2));
}

function stateHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');
}

function backupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
}
