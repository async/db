import { dbError } from '../../errors.js';
import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';

export const staticRuntimeCapabilities = {
  writable: false,
  persistence: 'static',
  atomicity: 'none',
  liveEvents: false,
  staticExport: true,
  production: true,
};

export function createStaticRuntimeAdapter(config) {
  const values = new Map();

  return {
    name: 'static',
    capabilities: staticRuntimeCapabilities,
    async hydrate(resources) {
      for (const resource of resources) {
        values.set(resource.name, structuredClone(applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config)));
      }
    },
    async readResource(resource, fallback) {
      return values.has(resource.name) ? structuredClone(values.get(resource.name)) : structuredClone(fallback);
    },
    async writeResource(resource) {
      throw readOnlyResourceError(resource);
    },
    async withResourceWrite(resource) {
      throw readOnlyResourceError(resource);
    },
  };
}

function readOnlyResourceError(resource) {
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
