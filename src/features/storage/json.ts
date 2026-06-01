import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';
import { updateSourceMetadataResource, type SourceMetadata } from './source-metadata.js';

type RuntimeConfig = {
  stateDir: string;
  cwd: string;
  defaults?: {
    applyOnSafeMigration?: boolean;
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

export const jsonRuntimeCapabilities = {
  writable: true,
  persistence: 'local-file',
  atomicity: 'resource',
  liveEvents: true,
  staticExport: false,
  production: 'small-local',
};

export function createJsonRuntimeAdapter(config: RuntimeConfig) {
  return {
    name: 'json',
    capabilities: jsonRuntimeCapabilities,
    statePath(resource: RuntimeResource) {
      return statePathForResource(config, resource.name);
    },
    async hydrate(resources: RuntimeResource[]) {
      await mkdir(path.join(config.stateDir, 'state'), { recursive: true });
      const sourceMetadataPath = path.join(config.stateDir, 'state', '.sources.json');
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
  return path.join(config.stateDir, 'state', `${name}.json`);
}

export async function readJsonState<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
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
