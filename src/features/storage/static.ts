import { dbError } from '../../errors.js';
import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';

type RuntimeConfig = Record<string, unknown>;

type RuntimeResource = {
  name: string;
  [key: string]: unknown;
};

export const staticRuntimeCapabilities = {
  writable: false,
  persistence: 'static',
  atomicity: 'none',
  liveEvents: false,
  staticExport: true,
  production: true,
};

export function createStaticRuntimeAdapter(config: RuntimeConfig) {
  const values = new Map<string, unknown>();

  return {
    name: 'static',
    capabilities: staticRuntimeCapabilities,
    async hydrate(resources: RuntimeResource[]) {
      for (const resource of resources) {
        values.set(resource.name, structuredClone(applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config)));
      }
    },
    async readResource(resource: RuntimeResource, fallback: unknown) {
      return values.has(resource.name) ? structuredClone(values.get(resource.name)) : structuredClone(fallback);
    },
    async writeResource(resource: RuntimeResource) {
      throw readOnlyResourceError(resource);
    },
    async withResourceWrite(resource: RuntimeResource) {
      throw readOnlyResourceError(resource);
    },
  };
}

function readOnlyResourceError(resource: RuntimeResource): Error {
  return dbError(
    'STORE_RESOURCE_READ_ONLY',
    `Resource "${resource.name}" is configured with a read-only store.`,
    {
      status: 405,
      hint: 'Use a writable store such as "json" or remove the static store strategy for this resource.',
      details: {
        resource: resource.name,
        store: 'static',
      },
    },
  );
}
