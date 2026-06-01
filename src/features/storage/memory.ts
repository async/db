import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';

type RuntimeConfig = Record<string, unknown>;

type RuntimeResource = {
  name: string;
  [key: string]: unknown;
};

type ResourceWriteOperation<T> = () => T | Promise<T>;

export const memoryRuntimeCapabilities = {
  writable: true,
  persistence: 'memory',
  atomicity: 'process',
  liveEvents: true,
  staticExport: false,
  production: false,
};

export function createMemoryRuntimeAdapter(config: RuntimeConfig) {
  const values = new Map<string, unknown>();
  const queues = new Map<string, Promise<unknown>>();

  return {
    name: 'memory',
    capabilities: memoryRuntimeCapabilities,
    async hydrate(resources: RuntimeResource[]) {
      for (const resource of resources) {
        values.set(resource.name, clone(applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config)));
      }
    },
    async readResource(resource: RuntimeResource, fallback: unknown) {
      return values.has(resource.name) ? clone(values.get(resource.name)) : clone(fallback);
    },
    async writeResource(resource: RuntimeResource, value: unknown) {
      values.set(resource.name, clone(value));
    },
    withResourceWrite<T>(resource: RuntimeResource, operation: ResourceWriteOperation<T>): Promise<T> {
      const previous = queues.get(resource.name) ?? Promise.resolve();
      const current = previous.then(operation, operation);
      const stored = current.catch(() => {});
      queues.set(resource.name, stored);
      stored.finally(() => {
        if (queues.get(resource.name) === stored) {
          queues.delete(resource.name);
        }
      });
      return current;
    },
  };
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}
