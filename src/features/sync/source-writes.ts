import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeText } from '../../fs-utils.js';
import { resourceConfigValue } from '../../names.js';

type SyncConfig = {
  cwd: string;
  resources?: Record<string, unknown>;
  stores?: Record<string, unknown>;
};

type SyncResource = {
  name: string;
  seed?: unknown;
  generatedIds?: boolean;
  dataFormat?: string;
  dataPath?: string | null;
  dataHash?: string;
};

type StoreConfig = {
  store?: string;
  driver?: string;
};

export async function writeGeneratedIdsToSources(config: SyncConfig, resources: SyncResource[], logs: string[]): Promise<void> {
  for (const resource of resources) {
    if (!usesSourceFileStore(config, resource) || !resource.generatedIds || resource.dataFormat !== 'json' || !resource.dataPath) {
      continue;
    }

    const text = `${JSON.stringify(resource.seed, null, 2)}\n`;
    await writeText(resource.dataPath, text);
    resource.dataHash = createHash('sha256').update(text).digest('hex');
    resource.generatedIds = false;
    logs.push(`Updated ${path.relative(config.cwd, resource.dataPath)} with generated ids`);
  }
}

function usesSourceFileStore(config: SyncConfig, resource: SyncResource): boolean {
  const resourceConfig = storeRecord(resourceConfigValue(config.resources, resource.name));
  const storeName = String(resourceConfig?.store ?? config.stores?.default ?? 'json');
  const configured = config.stores?.[storeName] ?? storeName;
  const configuredRecord = storeRecord(configured);
  const driver = typeof configured === 'string' ? configured : configuredRecord?.driver ?? storeName;
  return driver === 'sourceFile';
}

function storeRecord(value: unknown): StoreConfig | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as StoreConfig : null;
}
