import { dbError } from '../../errors.js';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';
import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';
import { atomicWriteJson, createWalController, jsonDurabilityConfigFor, readJsonState, withJsonStateWrite } from './json.js';
import { updateSourceMetadataResource, type SourceMetadata } from './source-metadata.js';
import type { WalDelta } from './wal.js';

type RuntimeConfig = {
  cwd: string;
  fs?: DbFileSystem;
  [key: string]: unknown;
};

type RuntimeResource = {
  name: string;
  dataPath?: string | null;
  dataFormat?: string | null;
  [key: string]: unknown;
};

type WritableSourceResource = RuntimeResource & {
  dataPath: string;
  dataFormat: 'json';
};

type ResourceWriteOperation<T> = () => T | Promise<T>;

export const sourceRuntimeCapabilities = {
  writable: true,
  persistence: 'source-file',
  atomicity: 'resource',
  liveEvents: true,
  staticExport: false,
  production: false,
};

export function createSourceRuntimeAdapter(config: RuntimeConfig) {
  const fallbacks = new Map<string, unknown>();
  const durability = jsonDurabilityConfigFor(config as never, 'sourceFile');
  // Draft mode with Redis-style guarantees: acknowledge through a hidden WAL
  // under .db/, then debounce the pretty rewrite of the db/ source file the
  // human is looking at. A hand edit supersedes the log via base-hash checks.
  const wal = durability.durability === 'wal'
    ? createWalController({
        config: config as never,
        durability,
        canonicalPathFor: (resource) => (resource as { dataPath: string }).dataPath,
        walScope: 'sourceFile',
      })
    : null;

  return {
    name: 'sourceFile',
    capabilities: {
      ...sourceRuntimeCapabilities,
      durability: wal ? 'wal' : 'current',
    },
    async hydrate(resources: RuntimeResource[]) {
      for (const resource of resources) {
        assertWritableSource(resource);
        fallbacks.set(resource.name, structuredClone(applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config)));
        if (wal) {
          await wal.recover(resource);
        }
      }
    },
    readResource(resource: RuntimeResource, fallback: unknown) {
      assertWritableSource(resource);
      const seeded = fallbacks.has(resource.name) ? structuredClone(fallbacks.get(resource.name)) : fallback;
      if (wal) {
        return wal.read(resource, seeded);
      }
      return readJsonState(resource.dataPath, seeded, dbFileSystem(config));
    },
    writeResource(resource: RuntimeResource, value: unknown) {
      assertWritableSource(resource);
      if (wal) {
        return wal.fullWrite(resource, value);
      }
      return atomicWriteJson(resource.dataPath, value, dbFileSystem(config));
    },
    writeResourceDelta: wal
      ? (resource: RuntimeResource, value: unknown, delta: WalDelta) => {
          assertWritableSource(resource);
          return wal.writeDelta(resource, value, delta);
        }
      : undefined,
    withResourceWrite<T>(resource: RuntimeResource, operation: ResourceWriteOperation<T>) {
      assertWritableSource(resource);
      return withJsonStateWrite(resource.dataPath, operation, {
        fs: dbFileSystem(config),
        crossProcessLock: !config.fs,
      });
    },
    close() {
      return wal?.close();
    },
  };
}

export async function writeSourceMetadata(config: RuntimeConfig, resources: RuntimeResource[], sourceMetadata: SourceMetadata): Promise<void> {
  for (const resource of resources) {
    updateSourceMetadata(sourceMetadata, config, resource);
  }
}

function assertWritableSource(resource: RuntimeResource): asserts resource is WritableSourceResource {
  if (resource.dataPath && resource.dataFormat === 'json') {
    return;
  }

  throw dbError(
    'STORE_SOURCE_NOT_WRITABLE',
    `Resource "${resource.name}" cannot use the sourceFile store because it is not backed by a plain JSON data file.`,
    {
      status: 400,
      hint: 'Use store "sourceFile" only for resources loaded from db/*.json data files.',
      details: {
        resource: resource.name,
        dataFormat: resource.dataFormat,
        dataPath: resource.dataPath,
      },
    },
  );
}

function updateSourceMetadata(sourceMetadata: SourceMetadata, config: RuntimeConfig, resource: RuntimeResource): void {
  updateSourceMetadataResource(sourceMetadata, config, resource);
}
