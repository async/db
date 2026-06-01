import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dbError } from '../../errors.js';
import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';
import { updateSourceMetadataResource, type SourceMetadata } from './source-metadata.js';

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

type RecordFilesLayout = {
  mode: 'record-files';
  key: string;
};

type JsonStoreOptions = {
  storage?: FileStorageOptions | S3StorageOptions;
  durability?: 'current' | 'versioned' | string;
  encryption?: unknown;
  resources?: Record<string, RecordFilesLayout>;
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

export function s3Storage(options: Omit<S3StorageOptions, 'kind'>): S3StorageOptions {
  return {
    kind: 's3',
    ...options,
  };
}

export function recordFiles(options: { key: string }): RecordFilesLayout {
  return {
    mode: 'record-files',
    key: options.key,
  };
}

export function jsonStore(options: JsonStoreOptions = {}) {
  return ({ config, storeName }: { config: RuntimeConfig; resources: RuntimeResource[]; storeName: string }) => {
    const storage = options.storage ?? fileStorage(config.stateDir);
    if (storage.kind !== 'file') {
      return unsupportedObjectStorageAdapter(storeName, storage, options);
    }
    const fileBackend = storage;

    function statePath(resource: RuntimeResource): string {
      return jsonStoreStatePath(config, fileBackend, resource.name);
    }

    return {
      name: storeName,
      capabilities: {
        ...jsonRuntimeCapabilities,
        durability: options.durability ?? 'current',
        encryption: options.encryption ?? null,
        layout: {
          resources: options.resources ?? {},
        },
      },
      statePath,
      readResource(resource: RuntimeResource, fallback: unknown) {
        return readJsonState(statePath(resource), fallback);
      },
      writeResource(resource: RuntimeResource, value: unknown) {
        return writeJsonState(statePath(resource), value);
      },
      withResourceWrite<T>(resource: RuntimeResource, operation: ResourceWriteOperation<T>) {
        return withJsonStateWrite(statePath(resource), operation);
      },
    };
  };
}

export function createJsonRuntimeAdapter(config: RuntimeConfig) {
  return {
    name: 'json',
    capabilities: jsonRuntimeCapabilities,
    statePath(resource: RuntimeResource) {
      return statePathForResource(config, resource.name);
    },
    async hydrate(resources: RuntimeResource[]) {
      await mkdir(jsonResourceStateDir(config), { recursive: true });
      const sourceMetadataPath = path.join(jsonResourceStateDir(config), '.sources.json');
      const sourceMetadata = await readJsonState(sourceMetadataPath, { resources: {} });
      sourceMetadata.resources ??= {};

      for (const resource of resources) {
        await syncJsonResourceState(config, resource, sourceMetadata);
      }
      await writeJsonState(sourceMetadataPath, sourceMetadata);
    },
    readResource(resource: RuntimeResource, fallback: unknown) {
      return readJsonState(statePathForResource(config, resource.name), fallback);
    },
    writeResource(resource: RuntimeResource, value: unknown) {
      return writeJsonState(statePathForResource(config, resource.name), value);
    },
    withResourceWrite<T>(resource: RuntimeResource, operation: ResourceWriteOperation<T>) {
      return withJsonStateWrite(statePathForResource(config, resource.name), operation);
    },
  };
}

export function statePathForResource(config: RuntimeConfig, resourceName: string | { name: string }): string {
  const name = typeof resourceName === 'string'
    ? resourceName
    : (resourceName as { name?: string }).name;
  return path.join(jsonResourceStateDir(config), `${name}.json`);
}

function jsonResourceStateDir(config: RuntimeConfig): string {
  return config.__asyncDbScope?.fork
    ? path.join(config.stateDir, 'resources')
    : path.join(config.stateDir, 'state');
}

function jsonStoreStatePath(config: RuntimeConfig, storage: FileStorageOptions, resourceName: string): string {
  const root = path.isAbsolute(storage.root)
    ? storage.root
    : path.resolve(config.cwd, storage.root);
  const scope = config.__asyncDbScope;
  if (scope?.fork) {
    return path.join(root, 'forks', scope.fork, 'branches', scope.branch ?? 'main', 'resources', `${resourceName}.json`);
  }
  return path.join(root, 'resources', `${resourceName}.json`);
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
      layout: {
        resources: options.resources ?? {},
      },
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

export async function readJsonState<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
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

export async function writeJsonState(filePath: string, value: unknown): Promise<boolean> {
  return atomicWriteJson(filePath, value);
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<boolean> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if ((await readFile(filePath, 'utf8')) === text) {
      return false;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  try {
    await writeFile(tempPath, text, 'utf8');
    await rename(tempPath, filePath);
    return true;
  } catch (error) {
    try {
      await rm(tempPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
}

export function withJsonStateWrite<T>(filePath: string, operation: ResourceWriteOperation<T>): Promise<T> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const stored = current.catch(() => {});
  writeQueues.set(filePath, stored);

  stored.finally(() => {
    if (writeQueues.get(filePath) === stored) {
      writeQueues.delete(filePath);
    }
  });

  return current;
}

export async function syncJsonResourceState(config: RuntimeConfig, resource: RuntimeResource, sourceMetadata: SourceMetadata): Promise<void> {
  const statePath = statePathForResource(config, resource.name);
  const existing = await readJsonState(statePath, undefined);
  const metadata = sourceMetadata.resources[resource.name];
  const sourceChanged = resource.dataHash
    && metadata?.hash !== resource.dataHash;

  if (existing === undefined || sourceChanged) {
    await writeJsonState(statePath, applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config));
    updateSourceMetadata(sourceMetadata, config, resource);
    return;
  }

  if (config.defaults?.applyOnSafeMigration !== false) {
    await writeJsonState(statePath, applyDefaultsToSeed(existing, resource, config));
  }

  updateSourceMetadata(sourceMetadata, config, resource);
}

function updateSourceMetadata(sourceMetadata: SourceMetadata, config: RuntimeConfig, resource: RuntimeResource): void {
  updateSourceMetadataResource(sourceMetadata, config, resource);
}
