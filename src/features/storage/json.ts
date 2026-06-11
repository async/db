import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile as nodeReadFile, rm as nodeRm, stat as nodeStat, writeFile as nodeWriteFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { dbError } from '../../errors.js';
import { dbFileSystem, nodeFileSystem, type DbFileSystem } from '../fs/index.js';
import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';
import { updateSourceMetadataResource, type SourceMetadata } from './source-metadata.js';
import {
  appendWalEntry,
  flushWalFsyncs,
  readWal,
  replayWal,
  rotateWal,
  walContentHash,
  walPathFor,
  type WalDelta,
  type WalFsyncPolicy,
} from './wal.js';

type RuntimeConfig = {
  stateDir: string;
  cwd: string;
  defaults?: {
    applyOnSafeMigration?: boolean;
  };
  __asyncDbScope?: {
    fork?: string | null;
    branch?: string;
    rootStateDir?: string;
  };
  fs?: DbFileSystem;
  [key: string]: unknown;
};

type RuntimeResource = {
  name: string;
  kind?: string;
  dataHash?: string | null;
  dataPath?: string | null;
  dataFormat?: unknown;
  [key: string]: unknown;
};

type ResourceWriteOperation<T> = () => T | Promise<T>;

const writeQueues = new Map<string, Promise<unknown>>();

type FileStorageOptions = {
  kind: 'file';
  root: string;
};

type S3StorageOptions = {
  kind: 's3';
  bucket: string;
  prefix?: string;
  client?: unknown;
  encryption?: unknown;
};

type JsonStoreEncryptionOptions = {
  /**
   * Encryption key: a 32-byte Buffer/Uint8Array, or any passphrase string
   * (hashed with SHA-256 into a 256-bit key), or a sync/async function
   * returning either. Files are sealed with AES-256-GCM.
   */
  key: string | Uint8Array | (() => string | Uint8Array | Promise<string | Uint8Array>);
  algorithm?: 'aes-256-gcm';
};

type JsonStoreOptions = {
  storage?: FileStorageOptions | S3StorageOptions;
  durability?: 'current' | 'versioned' | 'wal' | string;
  /** Keep at most this many version snapshots per resource when durability is "versioned" or "wal". Defaults to 10. */
  maxVersions?: number;
  /** WAL flush policy when durability is "wal". Defaults to "everysec". */
  fsync?: WalFsyncPolicy;
  encryption?: JsonStoreEncryptionOptions | null;
};

export const jsonRuntimeCapabilities = {
  writable: true,
  persistence: 'local-file',
  atomicity: 'resource',
  liveEvents: true,
  staticExport: false,
  production: 'small-local',
};

export function fileStorage(root: string): FileStorageOptions {
  return {
    kind: 'file',
    root,
  };
}

/**
 * @experimental Declarative S3 storage options for the JSON store. The
 * built-in runtime does not implement an S3 backend yet; selecting it fails at
 * runtime with JSON_STORAGE_BACKEND_UNAVAILABLE. Use fileStorage(), or a
 * custom store adapter, for production data.
 */
export function s3Storage(options: Omit<S3StorageOptions, 'kind'>): S3StorageOptions {
  return {
    kind: 's3',
    ...options,
  };
}

export function jsonStore(options: JsonStoreOptions = {}) {
  return ({ config, storeName }: { config: RuntimeConfig; resources: RuntimeResource[]; storeName: string }) => {
    const storage = options.storage ?? fileStorage(config.__asyncDbScope?.rootStateDir ?? config.stateDir);
    if (storage.kind !== 'file') {
      return unsupportedObjectStorageAdapter(storeName, storage, options);
    }
    const fileBackend = storage;
    const rootDirectory = options.storage ? 'resources' : 'state';
    const codec = jsonEncryptionCodec(options.encryption, storeName);
    const versioned = options.durability === 'versioned';
    const maxVersions = options.maxVersions ?? DEFAULT_MAX_JSON_STATE_VERSIONS;

    function statePath(resource: RuntimeResource): string {
      return jsonStoreStatePath(config, fileBackend, resource.name, rootDirectory);
    }

    if (options.durability === 'wal' && codec) {
      throw dbError(
        'JSON_WAL_ENCRYPTION_UNSUPPORTED',
        `JSON store "${storeName}" cannot combine durability "wal" with encryption yet.`,
        {
          status: 500,
          hint: 'WAL entries are plaintext JSONL today; use durability "versioned" with encryption, or wal without encryption.',
          details: { store: storeName },
        },
      );
    }

    const wal = options.durability === 'wal'
      ? createWalController({
          config,
          durability: {
            durability: 'wal',
            maxVersions,
            fsync: (options as { fsync?: WalFsyncPolicy }).fsync,
          },
          canonicalPathFor: statePath,
          walScope: storeName === 'json' ? '' : storeName,
        })
      : null;

    if (wal) {
      return {
        name: storeName,
        capabilities: {
          ...jsonRuntimeCapabilities,
          durability: 'wal',
          encryption: null,
          layout: 'resource-files',
        },
        statePath,
        async hydrate(resources: RuntimeResource[]) {
          await recoverJsonStateDir(jsonResourceDir({
            root: storageRoot(config, fileBackend),
            rootDirectory,
            scope: config.__asyncDbScope,
          }), dbFileSystem(config));
          for (const resource of resources) {
            await wal.recover(resource);
          }
        },
        readResource(resource: RuntimeResource, fallback: unknown) {
          return wal.read(resource, fallback);
        },
        writeResource(resource: RuntimeResource, value: unknown) {
          return wal.fullWrite(resource, value);
        },
        writeResourceDelta(resource: RuntimeResource, value: unknown, delta: WalDelta) {
          return wal.writeDelta(resource, value, delta);
        },
        withResourceWrite<T>(resource: RuntimeResource, operation: ResourceWriteOperation<T>) {
          return withJsonStateWrite(statePath(resource), operation, jsonStateWriteOptions(config));
        },
        close() {
          return wal.close();
        },
      };
    }

    return {
      name: storeName,
      capabilities: {
        ...jsonRuntimeCapabilities,
        durability: options.durability ?? 'current',
        encryption: codec ? codec.algorithm : null,
        layout: 'resource-files',
      },
      statePath,
      async hydrate() {
        await recoverJsonStateDir(jsonResourceDir({
          root: storageRoot(config, fileBackend),
          rootDirectory,
          scope: config.__asyncDbScope,
        }), dbFileSystem(config));
      },
      readResource(resource: RuntimeResource, fallback: unknown) {
        return codec
          ? readEncryptedJsonState(statePath(resource), fallback, codec, dbFileSystem(config))
          : readJsonState(statePath(resource), fallback, dbFileSystem(config));
      },
      writeResource(resource: RuntimeResource, value: unknown) {
        if (codec) {
          return writeEncryptedJsonState(statePath(resource), value, codec, {
            fs: dbFileSystem(config),
            versioned,
            maxVersions,
          });
        }
        return versioned
          ? atomicWriteJsonVersioned(statePath(resource), value, { fs: dbFileSystem(config), maxVersions })
          : writeJsonState(statePath(resource), value, dbFileSystem(config));
      },
      withResourceWrite<T>(resource: RuntimeResource, operation: ResourceWriteOperation<T>) {
        return withJsonStateWrite(statePath(resource), operation, jsonStateWriteOptions(config));
      },
    };
  };
}

function storageRoot(config: RuntimeConfig, storage: FileStorageOptions): string {
  return path.isAbsolute(storage.root)
    ? storage.root
    : path.resolve(config.cwd, storage.root);
}

function jsonStateWriteOptions(config: RuntimeConfig): JsonStateWriteOptions {
  return {
    fs: dbFileSystem(config),
    crossProcessLock: !config.fs,
  };
}

type JsonDurabilityConfig = {
  durability?: string;
  maxVersions?: number;
  fsync?: WalFsyncPolicy;
  checkpointMs?: number;
  maxWalEntries?: number;
};

/**
 * Store adapters read durability settings from their `stores.<name>` config
 * block, so `stores: { json: { driver: 'json', durability: 'wal' } }` turns
 * on write-ahead logging without a custom store factory.
 */
export function jsonDurabilityConfigFor(config: RuntimeConfig, storeName: string): JsonDurabilityConfig {
  const stores = (config as { stores?: Record<string, unknown> }).stores;
  const storeConfig = stores?.[storeName];
  if (!storeConfig || typeof storeConfig !== 'object') {
    return {};
  }
  const record = storeConfig as JsonDurabilityConfig;
  return {
    durability: record.durability,
    maxVersions: record.maxVersions,
    fsync: record.fsync,
    checkpointMs: record.checkpointMs,
    maxWalEntries: record.maxWalEntries,
  };
}

function jsonDurabilityConfig(config: RuntimeConfig): JsonDurabilityConfig {
  return jsonDurabilityConfigFor(config, 'json');
}

function jsonStateWriterFor(config: RuntimeConfig): (filePath: string, value: unknown, fs: DbFileSystem) => Promise<boolean> {
  const durability = jsonDurabilityConfig(config);
  // Both 'versioned' and 'wal' keep checkpoint history; 'wal' adds the log.
  if (durability.durability !== 'versioned' && durability.durability !== 'wal') {
    return (filePath, value, fs) => writeJsonState(filePath, value, fs);
  }
  return (filePath, value, fs) => atomicWriteJsonVersioned(filePath, value, {
    fs,
    maxVersions: durability.maxVersions ?? DEFAULT_MAX_JSON_STATE_VERSIONS,
  });
}

/**
 * Per-adapter write-ahead-log controller: appends acknowledged deltas, serves
 * reads as checkpoint-plus-replay, debounces pretty checkpoints, and rotates
 * log generations bound to checkpoint content hashes.
 */
export function createWalController(options: {
  config: RuntimeConfig;
  canonicalPathFor(resource: RuntimeResource): string;
  durability: JsonDurabilityConfig;
  walScope?: string;
}) {
  const { config, canonicalPathFor } = options;
  const fs = dbFileSystem(config);
  const fsync = options.durability.fsync ?? 'everysec';
  const checkpointMs = Math.max(0, options.durability.checkpointMs ?? 250);
  const maxWalEntries = Math.max(1, options.durability.maxWalEntries ?? 1000);
  const maxVersions = options.durability.maxVersions ?? DEFAULT_MAX_JSON_STATE_VERSIONS;
  const walDir = path.join(jsonResourceStateDir(config), '.wal', options.walScope ?? '');
  const seqs = new Map<string, number>();
  const pending = new Map<string, { value: unknown; resource: RuntimeResource; timer: NodeJS.Timeout | null }>();

  function walPath(resource: RuntimeResource): string {
    return walPathFor(walDir, resource.name);
  }

  async function nextSeq(resource: RuntimeResource): Promise<number> {
    let seq = seqs.get(resource.name);
    if (seq === undefined) {
      const log = await readWal(walPath(resource), fs);
      if (log.baseHash === null && log.entries.length === 0) {
        // First generation for this resource: bind the log to the current
        // checkpoint contents so recovery can prove the entries still apply.
        const text = await currentJsonText(canonicalPathFor(resource), fs);
        await rotateWal(walPath(resource), walContentHash(text), 0, fs);
        seq = 0;
      } else {
        seq = log.entries.length > 0 ? log.entries[log.entries.length - 1].seq : log.baseSeq;
      }
    }
    seq += 1;
    seqs.set(resource.name, seq);
    return seq;
  }

  function scheduleCheckpoint(resource: RuntimeResource, value: unknown, delayMs: number): void {
    const entry = pending.get(resource.name) ?? { value, resource, timer: null };
    entry.value = value;
    entry.resource = resource;
    if (!entry.timer) {
      entry.timer = setTimeout(() => {
        entry.timer = null;
        void checkpoint(resource.name);
      }, delayMs);
      entry.timer.unref?.();
    }
    pending.set(resource.name, entry);
  }

  async function checkpoint(resourceName: string): Promise<void> {
    const entry = pending.get(resourceName);
    if (!entry) {
      return;
    }
    pending.delete(resourceName);
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    const canonical = canonicalPathFor(entry.resource);
    try {
      await withJsonStateWrite(canonical, async () => {
        await atomicWriteJsonVersioned(canonical, entry.value, { fs, maxVersions });
        const text = await currentJsonText(canonical, fs);
        await rotateWal(walPath(entry.resource), walContentHash(text), seqs.get(resourceName) ?? 0, fs);
      }, jsonStateWriteOptions(config));
    } catch (error) {
      // The acknowledged data is safe in the log; retry the checkpoint soon.
      scheduleCheckpoint(entry.resource, entry.value, 1000);
      process.emitWarning(
        `JSON checkpoint failed for "${resourceName}" (will retry): ${(error as Error).message}`,
        { code: 'ASYNC_DB_CHECKPOINT_RETRY', type: 'AsyncDbRecoveryWarning' },
      );
    }
  }

  return {
    async writeDelta(resource: RuntimeResource, value: unknown, delta: WalDelta): Promise<void> {
      const seq = await nextSeq(resource);
      await appendWalEntry(walPath(resource), {
        ...delta,
        seq,
        at: new Date().toISOString(),
        source: 'runtime',
      }, { fsync, fs });
      const log = pending.get(resource.name);
      const entriesSinceBase = seq - (await readWalBaseSeq(resource));
      scheduleCheckpoint(resource, value, entriesSinceBase >= maxWalEntries ? 0 : checkpointMs);
      void log;
    },
    async fullWrite(resource: RuntimeResource, value: unknown): Promise<boolean> {
      // Full-value writes (seeding, sync, replace flows that skip deltas) are
      // already inside the resource lock: checkpoint immediately and rotate.
      cancelPending(resource.name);
      const canonical = canonicalPathFor(resource);
      const changed = await atomicWriteJsonVersioned(canonical, value, { fs, maxVersions });
      const text = await currentJsonText(canonical, fs);
      await rotateWal(walPath(resource), walContentHash(text), seqs.get(resource.name) ?? 0, fs);
      return changed;
    },
    async read(resource: RuntimeResource, fallback: unknown): Promise<unknown> {
      const inFlight = pending.get(resource.name);
      if (inFlight) {
        return inFlight.value;
      }
      const canonical = canonicalPathFor(resource);
      const checkpointValue = await readJsonState<unknown>(canonical, MISSING_STATE, fs);
      const base = checkpointValue === MISSING_STATE ? fallback : checkpointValue;
      const log = await readWal(walPath(resource), fs);
      if (log.entries.length === 0) {
        return base;
      }
      const text = await currentJsonText(canonical, fs);
      if (log.baseHash !== walContentHash(text)) {
        // The canonical file changed underneath this log generation (a human
        // edit): the visible file wins and the stale log is ignored.
        return base;
      }
      return replayWal(base, log.entries);
    },
    async recover(resource: RuntimeResource): Promise<void> {
      const log = await readWal(walPath(resource), fs);
      if (log.entries.length === 0) {
        return;
      }
      const canonical = canonicalPathFor(resource);
      await withJsonStateWrite(canonical, async () => {
        const checkpointValue = await readJsonState<unknown>(canonical, MISSING_STATE, fs);
        const text = await currentJsonText(canonical, fs);
        if (log.baseHash === walContentHash(text)) {
          const replayed = replayWal(checkpointValue === MISSING_STATE ? undefined : checkpointValue, log.entries);
          await atomicWriteJsonVersioned(canonical, replayed, { fs, maxVersions });
        }
        const nextText = await currentJsonText(canonical, fs);
        await rotateWal(walPath(resource), walContentHash(nextText), log.entries.at(-1)?.seq ?? log.baseSeq, fs);
      }, jsonStateWriteOptions(config));
    },
    async close(): Promise<void> {
      const names = [...pending.keys()];
      for (const name of names) {
        await checkpoint(name);
      }
      await flushWalFsyncs();
    },
  };

  function cancelPending(resourceName: string): void {
    const entry = pending.get(resourceName);
    if (entry?.timer) {
      clearTimeout(entry.timer);
    }
    pending.delete(resourceName);
  }

  async function readWalBaseSeq(resource: RuntimeResource): Promise<number> {
    const log = await readWal(walPath(resource), fs);
    return log.baseSeq;
  }
}

export function createJsonRuntimeAdapter(config: RuntimeConfig) {
  const durability = jsonDurabilityConfig(config);
  const write = jsonStateWriterFor(config);
  const wal = durability.durability === 'wal'
    ? createWalController({
        config,
        durability,
        canonicalPathFor: (resource) => statePathForResource(config, resource.name),
      })
    : null;

  return {
    name: 'json',
    capabilities: {
      ...jsonRuntimeCapabilities,
      durability: durability.durability === 'wal'
        ? 'wal'
        : durability.durability === 'versioned' ? 'versioned' : 'current',
    },
    statePath(resource: RuntimeResource) {
      return statePathForResource(config, resource.name);
    },
    async hydrate(resources: RuntimeResource[]) {
      const fs = dbFileSystem(config);
      await fs.mkdir(jsonResourceStateDir(config), { recursive: true });
      // Sweep crash leftovers (orphan temp files, dead-owner locks) before
      // hydration touches any state file.
      await recoverJsonStateDir(jsonResourceStateDir(config), fs);
      if (wal) {
        for (const resource of resources) {
          await wal.recover(resource);
        }
      }
      const sourceMetadataPath = path.join(jsonResourceStateDir(config), '.sources.json');
      const sourceMetadata = await readJsonState(sourceMetadataPath, { resources: {} }, fs);
      sourceMetadata.resources ??= {};

      for (const resource of resources) {
        await syncJsonResourceState(config, resource, sourceMetadata);
      }
      await writeJsonState(sourceMetadataPath, sourceMetadata, fs);
    },
    readResource(resource: RuntimeResource, fallback: unknown) {
      if (wal) {
        return wal.read(resource, fallback);
      }
      return readJsonState(statePathForResource(config, resource.name), fallback, dbFileSystem(config));
    },
    writeResource(resource: RuntimeResource, value: unknown) {
      if (wal) {
        return wal.fullWrite(resource, value);
      }
      return write(statePathForResource(config, resource.name), value, dbFileSystem(config));
    },
    writeResourceDelta: wal
      ? (resource: RuntimeResource, value: unknown, delta: WalDelta) => wal.writeDelta(resource, value, delta)
      : undefined,
    withResourceWrite<T>(resource: RuntimeResource, operation: ResourceWriteOperation<T>) {
      return withJsonStateWrite(statePathForResource(config, resource.name), operation, jsonStateWriteOptions(config));
    },
    close() {
      return wal?.close();
    },
  };
}

export function statePathForResource(config: RuntimeConfig, resourceName: string | { name: string }): string {
  const name = typeof resourceName === 'string'
    ? resourceName
    : (resourceName as { name?: string }).name;
  return jsonResourcePath({
    root: config.__asyncDbScope?.rootStateDir ?? config.stateDir,
    rootDirectory: 'state',
    scope: config.__asyncDbScope,
    resourceName: name,
  });
}

function jsonResourceStateDir(config: RuntimeConfig): string {
  return jsonResourceDir({
    root: config.__asyncDbScope?.rootStateDir ?? config.stateDir,
    rootDirectory: 'state',
    scope: config.__asyncDbScope,
  });
}

function jsonStoreStatePath(
  config: RuntimeConfig,
  storage: FileStorageOptions,
  resourceName: string,
  rootDirectory: 'state' | 'resources',
): string {
  const root = path.isAbsolute(storage.root)
    ? storage.root
    : path.resolve(config.cwd, storage.root);
  return jsonResourcePath({
    root,
    rootDirectory,
    scope: config.__asyncDbScope,
    resourceName,
  });
}

function jsonResourcePath(options: {
  root: string;
  rootDirectory: 'state' | 'resources';
  scope?: RuntimeConfig['__asyncDbScope'];
  resourceName: string;
}): string {
  return path.join(jsonResourceDir(options), `${options.resourceName}.json`);
}

function jsonResourceDir(options: {
  root: string;
  rootDirectory: 'state' | 'resources';
  scope?: RuntimeConfig['__asyncDbScope'];
}): string {
  const { root, rootDirectory, scope } = options;
  if (scope?.fork) {
    return path.join(root, 'forks', scope.fork, 'branches', scope.branch ?? 'main', 'resources');
  }
  return path.join(root, rootDirectory);
}

function unsupportedObjectStorageAdapter(storeName: string, storage: S3StorageOptions, options: JsonStoreOptions) {
  const error = () => dbError(
    'JSON_STORAGE_BACKEND_UNAVAILABLE',
    `JSON store "${storeName}" cannot use "${storage.kind}" storage in this runtime yet.`,
    {
      status: 500,
      hint: 'Use fileStorage() for the built-in runtime today, or provide a custom object-storage adapter that implements read/write semantics.',
      details: {
        store: storeName,
        storage: storage.kind,
      },
    },
  );
  return {
    name: storeName,
    capabilities: {
      ...jsonRuntimeCapabilities,
      persistence: 'object-storage',
      durability: options.durability ?? 'versioned',
      encryption: storage.encryption ?? options.encryption ?? null,
      layout: 'resource-files',
    },
    readResource() {
      throw error();
    },
    writeResource() {
      throw error();
    },
    withResourceWrite<T>(_resource: RuntimeResource, operation: ResourceWriteOperation<T>) {
      throw error();
    },
  };
}

export async function readJsonState<T>(filePath: string, fallback: T, fs: DbFileSystem = dbFileSystem()): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8') as string);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    if (error instanceof SyntaxError) {
      throw dbError(
        'JSON_STATE_INVALID',
        `JSON state file is not valid JSON: ${filePath}`,
        {
          status: 500,
          hint: 'Restore this file from a known-good snapshot, delete it to rehydrate from seed data when safe, or fix the JSON syntax before restarting.',
          details: {
            filePath,
            parserMessage: error.message,
          },
        },
      );
    }
    throw error;
  }
}

export async function writeJsonState(filePath: string, value: unknown, fs: DbFileSystem = dbFileSystem()): Promise<boolean> {
  return atomicWriteJson(filePath, value, fs);
}

export async function atomicWriteJson(filePath: string, value: unknown, fs: DbFileSystem = dbFileSystem()): Promise<boolean> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (await currentJsonText(filePath, fs) === text) {
    return false;
  }
  await writeJsonTextAtomic(filePath, text, fs);
  return true;
}

async function currentJsonText(filePath: string, fs: DbFileSystem): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8') as string;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    return null;
  }
}

async function writeJsonTextAtomic(filePath: string, text: string, fs: DbFileSystem): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  try {
    await fs.writeFile(tempPath, text, 'utf8');
    // Flush file contents before the rename so a crash or power loss cannot
    // publish an empty or partially written state file under the final name.
    await fs.fsync?.(tempPath);
    await fs.rename(tempPath, filePath);
    try {
      // Also flush the directory entry so the rename itself survives a crash.
      // Best-effort: directory fsync is unsupported on some platforms (Windows).
      await fs.fsync?.(path.dirname(filePath));
    } catch {
      // Durability of the rename record is best-effort by platform.
    }
  } catch (error) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
}

export const DEFAULT_MAX_JSON_STATE_VERSIONS = 10;

export type JsonStateVersion = {
  /** Version file name inside the versions directory. */
  file: string;
  /** Absolute path of the version snapshot. */
  path: string;
  /** Snapshot creation time in ms since epoch, parsed from the file name. */
  at: number;
};

/**
 * Version snapshots for one state file live in a hidden sibling directory:
 * `.db/state/users.json` keeps history under `.db/state/.versions/users/`.
 * The location follows the state file, so forks and branches keep their own
 * independent histories.
 */
export function jsonStateVersionsDir(filePath: string): string {
  return path.join(path.dirname(filePath), '.versions', path.basename(filePath).replace(/\.json$/, ''));
}

/**
 * Atomic write that first snapshots the previous file contents into the
 * versions directory, then prunes history to `maxVersions`. This implements
 * `durability: 'versioned'` for the JSON store.
 */
export async function atomicWriteJsonVersioned(
  filePath: string,
  value: unknown,
  options: { fs?: DbFileSystem; maxVersions?: number } = {},
): Promise<boolean> {
  const fs = options.fs ?? dbFileSystem();
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const currentText = await currentJsonText(filePath, fs);
  if (currentText === text) {
    return false;
  }

  if (currentText !== null) {
    await snapshotJsonStateVersion(filePath, currentText, fs);
  }
  await writeJsonTextAtomic(filePath, text, fs);
  await pruneJsonStateVersions(filePath, options.maxVersions ?? DEFAULT_MAX_JSON_STATE_VERSIONS, fs);
  return true;
}

async function snapshotJsonStateVersion(filePath: string, text: string, fs: DbFileSystem): Promise<string> {
  const versionsDir = jsonStateVersionsDir(filePath);
  await fs.mkdir(versionsDir, { recursive: true });
  const versionPath = path.join(versionsDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  await fs.writeFile(versionPath, text, 'utf8');
  return versionPath;
}

export async function listJsonStateVersions(filePath: string, fs: DbFileSystem = dbFileSystem()): Promise<JsonStateVersion[]> {
  const versionsDir = jsonStateVersionsDir(filePath);
  let entries: string[];
  try {
    entries = await fs.readdir(versionsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => /^\d+-[a-z0-9]+\.json$/.test(entry))
    .map((entry) => ({
      file: entry,
      path: path.join(versionsDir, entry),
      at: Number(entry.split('-')[0]),
    }))
    .sort((left, right) => right.at - left.at || right.file.localeCompare(left.file));
}

async function pruneJsonStateVersions(filePath: string, maxVersions: number, fs: DbFileSystem): Promise<void> {
  if (!Number.isFinite(maxVersions) || maxVersions < 0) {
    return;
  }
  const versions = await listJsonStateVersions(filePath, fs);
  for (const version of versions.slice(maxVersions)) {
    try {
      await fs.rm(version.path, { force: true });
    } catch {
      // Retention pruning is best-effort; stale snapshots are harmless.
    }
  }
}

/**
 * Replace the live state file with a stored version snapshot. The current
 * contents are snapshotted first, so a restore is itself undoable.
 */
export async function restoreJsonStateVersion(
  filePath: string,
  version: 'latest' | string = 'latest',
  options: { fs?: DbFileSystem; maxVersions?: number } = {},
): Promise<JsonStateVersion> {
  const fs = options.fs ?? dbFileSystem();
  const versions = await listJsonStateVersions(filePath, fs);
  const selected = version === 'latest'
    ? versions[0]
    : versions.find((candidate) => candidate.file === version || String(candidate.at) === version);

  if (!selected) {
    throw dbError(
      'JSON_STATE_VERSION_NOT_FOUND',
      version === 'latest'
        ? `No version snapshots exist for ${filePath}.`
        : `Version "${version}" does not exist for ${filePath}.`,
      {
        status: 404,
        hint: 'List versions with listJsonStateVersions() or `async-db restore <resource> --list`, and enable durability: "versioned" so future writes keep history.',
        details: {
          filePath,
          version,
          availableVersions: versions.map((candidate) => candidate.file),
        },
      },
    );
  }

  const text = await fs.readFile(selected.path, 'utf8') as string;
  const currentText = await currentJsonText(filePath, fs);
  if (currentText !== null && currentText !== text) {
    await snapshotJsonStateVersion(filePath, currentText, fs);
    await pruneJsonStateVersions(filePath, options.maxVersions ?? DEFAULT_MAX_JSON_STATE_VERSIONS, fs);
  }
  await writeJsonTextAtomic(filePath, text, fs);
  return selected;
}

export type JsonStateWriteOptions = {
  /**
   * Guard the write with an on-disk advisory lock so concurrent processes
   * (for example `async-db sync` beside a running server) cannot interleave
   * read-modify-write cycles and lose updates. Defaults to true on the real
   * filesystem; in-memory file systems always skip the on-disk lock.
   */
  crossProcessLock?: boolean;
  /** How long to wait for a held lock before failing. Defaults to 5000ms. */
  lockTimeoutMs?: number;
  /** Age after which an unreadable or ownerless lock is reclaimed. Defaults to 10000ms. */
  lockStaleMs?: number;
  fs?: DbFileSystem;
};

export function withJsonStateWrite<T>(
  filePath: string,
  operation: ResourceWriteOperation<T>,
  options: JsonStateWriteOptions = {},
): Promise<T> {
  const task = lockedJsonStateOperation(filePath, operation, options);
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const current = previous.then(task, task);
  const stored = current.catch(() => {});
  writeQueues.set(filePath, stored);

  stored.finally(() => {
    if (writeQueues.get(filePath) === stored) {
      writeQueues.delete(filePath);
    }
  });

  return current;
}

function lockedJsonStateOperation<T>(
  filePath: string,
  operation: ResourceWriteOperation<T>,
  options: JsonStateWriteOptions,
): () => Promise<T> {
  const useLock = options.crossProcessLock ?? ((options.fs ?? nodeFileSystem) === nodeFileSystem);
  if (!useLock) {
    return async () => await operation();
  }

  return async () => {
    const release = await acquireJsonStateLock(filePath, options);
    try {
      return await operation();
    } finally {
      await release();
    }
  };
}

type JsonStateLockInfo = {
  pid?: number;
  host?: string;
  createdAt?: number;
};

async function acquireJsonStateLock(filePath: string, options: JsonStateWriteOptions): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`;
  const timeoutMs = Math.max(0, options.lockTimeoutMs ?? 5000);
  const staleMs = Math.max(0, options.lockStaleMs ?? 10_000);
  const startedAt = Date.now();
  mkdirSync(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      await nodeWriteFile(lockPath, JSON.stringify({
        pid: process.pid,
        host: hostname(),
        createdAt: Date.now(),
      }), { flag: 'wx' });
      return async () => {
        await nodeRm(lockPath, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }

    const holder = await readJsonStateLock(lockPath);
    if (await reclaimStaleJsonStateLock(lockPath, holder, staleMs)) {
      continue;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw dbError(
        'JSON_STATE_LOCKED',
        `Timed out waiting for the JSON state lock: ${lockPath}`,
        {
          status: 503,
          hint: 'Another process is writing this resource. Retry, stop the other writer, or delete the lock file if its owner process is gone.',
          details: {
            filePath,
            lockPath,
            holder: holder ?? null,
            timeoutMs,
          },
        },
      );
    }

    await sleepMs(5 + Math.random() * 10);
  }
}

async function readJsonStateLock(lockPath: string): Promise<JsonStateLockInfo | null> {
  try {
    return JSON.parse(await nodeReadFile(lockPath, 'utf8') as string);
  } catch {
    // Missing, mid-write, or corrupt lock content; the caller decides by age.
    return null;
  }
}

async function reclaimStaleJsonStateLock(lockPath: string, holder: JsonStateLockInfo | null, staleMs: number): Promise<boolean> {
  const holderPid = Number(holder?.pid);
  const sameHost = !holder?.host || holder.host === hostname();

  if (Number.isInteger(holderPid) && holderPid > 0 && sameHost) {
    if (holderPid !== process.pid && processIsAlive(holderPid)) {
      return false;
    }
    // The lock owner is gone (or it is a leftover from a previous process with
    // this same pid); the in-process queue guarantees we are not holding it.
    await nodeRm(lockPath, { force: true });
    return true;
  }

  // No usable owner pid (corrupt content, mid-write content, or another host):
  // fall back to age. Prefer recorded createdAt; otherwise use file mtime so a
  // freshly created lock that has not finished writing is never reclaimed.
  const referenceTime = Number.isFinite(Number(holder?.createdAt)) && Number(holder?.createdAt) > 0
    ? Number(holder?.createdAt)
    : await lockFileMtime(lockPath);
  if (referenceTime === null) {
    // The lock disappeared between attempts; retry acquisition immediately.
    return true;
  }

  if (Date.now() - referenceTime >= staleMs) {
    await nodeRm(lockPath, { force: true });
    return true;
  }

  return false;
}

async function lockFileMtime(lockPath: string): Promise<number | null> {
  try {
    return (await nodeStat(lockPath)).mtimeMs;
  } catch {
    return null;
  }
}

type JsonEncryptionCodec = {
  algorithm: 'aes-256-gcm';
  resolveKey(): Promise<Buffer>;
};

type EncryptedJsonEnvelope = {
  __asyncDbEncrypted: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
};

function jsonEncryptionCodec(encryption: JsonStoreOptions['encryption'], storeName: string): JsonEncryptionCodec | null {
  if (!encryption) {
    return null;
  }

  if (!encryption.key) {
    throw dbError(
      'JSON_ENCRYPTION_KEY_REQUIRED',
      `JSON store "${storeName}" enables encryption without a key.`,
      {
        status: 500,
        hint: 'Pass encryption: { key } with a 32-byte Buffer, a passphrase string, or a function returning either (for example from an environment variable or secret manager).',
        details: { store: storeName },
      },
    );
  }

  const algorithm = encryption.algorithm ?? 'aes-256-gcm';
  if (algorithm !== 'aes-256-gcm') {
    throw dbError(
      'JSON_ENCRYPTION_ALGORITHM_UNSUPPORTED',
      `JSON store "${storeName}" requested unsupported encryption algorithm "${algorithm}".`,
      {
        status: 500,
        hint: 'Use the default aes-256-gcm algorithm.',
        details: { store: storeName, algorithm },
      },
    );
  }

  let cachedKey: Buffer | null = null;
  return {
    algorithm,
    async resolveKey() {
      if (cachedKey) {
        return cachedKey;
      }
      const raw = typeof encryption.key === 'function' ? await encryption.key() : encryption.key;
      cachedKey = normalizeEncryptionKey(raw, storeName);
      return cachedKey;
    },
  };
}

function normalizeEncryptionKey(raw: string | Uint8Array, storeName: string): Buffer {
  if (raw instanceof Uint8Array) {
    if (raw.byteLength !== 32) {
      throw dbError(
        'JSON_ENCRYPTION_KEY_INVALID',
        `JSON store "${storeName}" received a ${raw.byteLength}-byte binary key; AES-256-GCM needs exactly 32 bytes.`,
        {
          status: 500,
          hint: 'Pass a 32-byte Buffer, or pass a passphrase string to derive a key via SHA-256.',
          details: { store: storeName, keyBytes: raw.byteLength },
        },
      );
    }
    return Buffer.from(raw);
  }
  // Any passphrase string works: derive a 256-bit key deterministically.
  return createHash('sha256').update(String(raw), 'utf8').digest();
}

function isEncryptedJsonEnvelope(value: unknown): value is EncryptedJsonEnvelope {
  return Boolean(value)
    && typeof value === 'object'
    && (value as EncryptedJsonEnvelope).__asyncDbEncrypted === 'aes-256-gcm'
    && typeof (value as EncryptedJsonEnvelope).iv === 'string'
    && typeof (value as EncryptedJsonEnvelope).tag === 'string'
    && typeof (value as EncryptedJsonEnvelope).data === 'string';
}

async function encryptJsonValue(value: unknown, codec: JsonEncryptionCodec): Promise<EncryptedJsonEnvelope> {
  const key = await codec.resolveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value) ?? 'null', 'utf8');
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    __asyncDbEncrypted: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

async function decryptJsonEnvelope(envelope: EncryptedJsonEnvelope, codec: JsonEncryptionCodec, filePath: string): Promise<unknown> {
  const key = await codec.resolveKey();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw dbError(
      'JSON_ENCRYPTION_FAILED',
      `Cannot decrypt JSON state file: ${filePath}`,
      {
        status: 500,
        hint: 'The encryption key does not match this file or the file was tampered with. Use the key that wrote the file, or restore from a backup/version snapshot.',
        details: { filePath },
      },
    );
  }
}

export async function readEncryptedJsonState<T>(
  filePath: string,
  fallback: T,
  codec: JsonEncryptionCodec,
  fs: DbFileSystem = dbFileSystem(),
): Promise<T> {
  const raw = await readJsonState<unknown>(filePath, MISSING_STATE, fs);
  if (raw === MISSING_STATE) {
    return fallback;
  }
  if (isEncryptedJsonEnvelope(raw)) {
    return await decryptJsonEnvelope(raw, codec, filePath) as T;
  }
  // Plaintext files read transparently so existing data can migrate to an
  // encrypted store; the next write seals the file.
  return raw as T;
}

export async function writeEncryptedJsonState(
  filePath: string,
  value: unknown,
  codec: JsonEncryptionCodec,
  options: { fs?: DbFileSystem; versioned?: boolean; maxVersions?: number } = {},
): Promise<boolean> {
  const fs = options.fs ?? dbFileSystem();
  // AES-GCM uses a random IV per write, so ciphertext always differs even for
  // identical values. Compare plaintexts first to keep no-op writes cheap and
  // to avoid churning version history.
  const current = await readJsonState<unknown>(filePath, MISSING_STATE, fs);
  if (current !== MISSING_STATE) {
    const currentValue = isEncryptedJsonEnvelope(current)
      ? await decryptJsonEnvelope(current, codec, filePath).catch(() => MISSING_STATE)
      : current;
    if (currentValue !== MISSING_STATE && JSON.stringify(currentValue) === JSON.stringify(value)) {
      return false;
    }
  }

  const envelope = await encryptJsonValue(value, codec);
  return options.versioned
    ? atomicWriteJsonVersioned(filePath, envelope, { fs, maxVersions: options.maxVersions })
    : atomicWriteJson(filePath, envelope, fs);
}

const MISSING_STATE: unique symbol = Symbol('async-db-missing-state');

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncJsonResourceState(config: RuntimeConfig, resource: RuntimeResource, sourceMetadata: SourceMetadata): Promise<void> {
  const statePath = statePathForResource(config, resource.name);
  const fs = dbFileSystem(config);
  const write = jsonStateWriterFor(config);
  // Serialize with runtime writes (including other processes) so a sync run
  // beside a live server cannot interleave with a read-modify-write cycle.
  await withJsonStateWrite(statePath, async () => {
    const existing = await readJsonStateWithRecovery(statePath, fs);
    const metadata = sourceMetadata.resources[resource.name];
    const sourceChanged = resource.dataHash
      && metadata?.hash !== resource.dataHash;

    // Promoted resources pin their seed hash in db.lifecycle.jsonc. Once a
    // resource is in production, an edited seed file must never silently
    // reset live state; doctor reports the drift and `reseed --force` is the
    // explicit path back.
    const pinnedSeedHash = lifecycleSeedPin(config, resource.name);
    const reseedBlocked = Boolean(
      existing !== undefined
      && pinnedSeedHash
      && resource.dataHash
      && resource.dataHash !== pinnedSeedHash,
    );

    if (existing === undefined || (sourceChanged && !reseedBlocked)) {
      await write(statePath, applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config), fs);
      updateSourceMetadata(sourceMetadata, config, resource);
      return;
    }

    if (config.defaults?.applyOnSafeMigration !== false) {
      await write(statePath, applyDefaultsToSeed(existing, resource, config), fs);
    }

    updateSourceMetadata(sourceMetadata, config, resource);
  }, jsonStateWriteOptions(config));
}

/**
 * Hydration read that prefers availability without destroying evidence: a
 * corrupt state file is quarantined beside the original (never deleted), the
 * newest good version snapshot is restored when one exists, and otherwise the
 * resource rehydrates from seed data while the quarantined bytes stay on disk.
 */
async function readJsonStateWithRecovery(statePath: string, fs: DbFileSystem): Promise<unknown> {
  try {
    return await readJsonState(statePath, undefined, fs);
  } catch (error) {
    if ((error as { code?: string }).code !== 'JSON_STATE_INVALID') {
      throw error;
    }

    const quarantinePath = `${statePath}.corrupt-${Date.now()}`;
    await fs.rename(statePath, quarantinePath);

    const versions = await listJsonStateVersions(statePath, fs);
    if (versions.length > 0) {
      await restoreJsonStateVersion(statePath, 'latest', { fs });
      emitJsonRecoveryWarning(
        `Quarantined corrupt JSON state file to ${quarantinePath} and restored the latest version snapshot (${versions[0].file}).`,
      );
      return await readJsonState(statePath, undefined, fs);
    }

    emitJsonRecoveryWarning(
      `Quarantined corrupt JSON state file to ${quarantinePath}; no version snapshots existed, so the resource rehydrates from seed data. Restore the quarantined file manually if it held runtime edits.`,
    );
    return undefined;
  }
}

function emitJsonRecoveryWarning(message: string): void {
  process.emitWarning(message, { code: 'ASYNC_DB_STATE_RECOVERY', type: 'AsyncDbRecoveryWarning' });
}

function lifecycleSeedPin(config: RuntimeConfig, resourceName: string): string | null {
  const lifecycle = (config as { lifecycle?: { resources?: Record<string, { seedHash?: string | null }> } }).lifecycle;
  const pinned = lifecycle?.resources?.[resourceName]?.seedHash;
  return typeof pinned === 'string' && pinned.length > 0 ? pinned : null;
}

export type JsonStateRecoveryReport = {
  removedTempFiles: string[];
  removedLocks: string[];
};

export const BACKUP_META_FILE = 'backup-meta.json';

/** Bookkeeping file written by `async-db backup`, read by `doctor --production`. */
export function backupMetaPath(config: { stateDir: string }): string {
  return path.join(config.stateDir, BACKUP_META_FILE);
}

const RECOVERY_TEMP_FILE_MIN_AGE_MS = 60_000;

/**
 * Boot-time sweep for a JSON state directory: deletes orphaned atomic-write
 * temp files from crashed processes and reclaims lock files whose owners are
 * gone. Live locks and fresh temp files are left untouched.
 */
export async function recoverJsonStateDir(directory: string, fs: DbFileSystem = dbFileSystem()): Promise<JsonStateRecoveryReport> {
  const report: JsonStateRecoveryReport = {
    removedTempFiles: [],
    removedLocks: [],
  };

  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return report;
    }
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry);
    if (/^\..+\.tmp$/.test(entry)) {
      if (await fileOlderThan(entryPath, RECOVERY_TEMP_FILE_MIN_AGE_MS, fs)) {
        try {
          await fs.rm(entryPath, { force: true });
          report.removedTempFiles.push(entry);
        } catch {
          // Sweep is best-effort; a temp file that cannot be removed is inert.
        }
      }
      continue;
    }

    if (entry.endsWith('.lock')) {
      const holder = await readJsonStateLock(entryPath);
      if (await reclaimStaleJsonStateLock(entryPath, holder, RECOVERY_TEMP_FILE_MIN_AGE_MS)) {
        report.removedLocks.push(entry);
      }
    }
  }

  return report;
}

async function fileOlderThan(filePath: string, ageMs: number, fs: DbFileSystem): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath) as { mtimeMs?: number };
    if (typeof stats.mtimeMs !== 'number') {
      return true;
    }
    return Date.now() - stats.mtimeMs >= ageMs;
  } catch {
    return false;
  }
}

function updateSourceMetadata(sourceMetadata: SourceMetadata, config: RuntimeConfig, resource: RuntimeResource): void {
  updateSourceMetadataResource(sourceMetadata, config, resource);
}
