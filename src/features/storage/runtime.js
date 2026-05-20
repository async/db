import { dbError, listChoices } from '../../errors.js';
import { resourceConfigValue } from '../../names.js';
import { createJsonRuntimeAdapter } from './json.js';
import { createMemoryRuntimeAdapter } from './memory.js';
import { createSourceRuntimeAdapter } from './source.js';
import { createStaticRuntimeAdapter } from './static.js';
import { createRuntimeEventHub } from './events.js';

export function createRuntime(config, resources) {
  const events = createRuntimeEventHub();
  const adapters = new Map();
  const storeDefinitions = new Map();
  const customStoreQueues = new Map();
  let closed = false;

  for (const adapter of builtinAdapters(config)) {
    adapters.set(adapter.name, adapter);
  }

  for (const [storeName, storeDefinition] of Object.entries(config.stores ?? {})) {
    if (storeName === 'default' || typeof storeDefinition === 'string' || storeDefinition?.driver) {
      continue;
    }

    const store = typeof storeDefinition === 'function'
      ? storeDefinition({ config, resources, storeName })
      : storeDefinition;
    if (store) {
      storeDefinitions.set(storeName, store);
      adapters.set(storeName, customStoreAdapter(storeName, store, customStoreQueues));
    }
  }

  return {
    events,
    adapterNames() {
      return [...adapters.keys()];
    },
    strategyFor(resource) {
      const resourceConfig = resourceConfigValue(config.resources, resource.name);
      const storeName = resourceConfig?.store ?? config.stores?.default ?? 'json';
      const configured = storeDefinitions.has(storeName)
        ? storeName
        : config.stores?.[storeName] ?? storeName;
      if (!adapters.has(storeName) && config.stores?.[storeName] === undefined) {
        throw missingStoreError(resource, storeName, config, adapters);
      }
      return typeof configured === 'string' ? configured : configured?.driver ?? storeName;
    },
    adapterFor(resource) {
      const strategy = this.strategyFor(resource);
      const adapter = adapters.get(strategy);
      if (!adapter) {
        throw dbError(
          'STORE_DRIVER_NOT_FOUND',
          `Store driver "${strategy}" is not registered for resource "${resource.name}".`,
          {
            status: 500,
            hint: `Register one of: ${listChoices([...adapters.keys()])}.`,
            details: {
              resource: resource.name,
              store: strategy,
              availableStores: [...adapters.keys()],
            },
          },
        );
      }
      return adapter;
    },
    async hydrate() {
      const byAdapter = new Map();
      for (const resource of resources) {
        const adapter = this.adapterFor(resource);
        const group = byAdapter.get(adapter) ?? [];
        group.push(resource);
        byAdapter.set(adapter, group);
      }

      for (const [adapter, adapterResources] of byAdapter) {
        await adapter.hydrate?.(adapterResources);
      }
    },
    emit(change) {
      return events.emit(change);
    },
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      for (const adapter of new Set(adapters.values())) {
        await adapter.close?.();
      }
      events.close();
    },
  };
}

function customStoreAdapter(storeName, store, queues) {
  return {
    name: store.name ?? storeName,
    capabilities: store.capabilities,
    statePath(resource) {
      return store.statePath?.(resource);
    },
    hydrate(resources) {
      return store.hydrate?.(resources);
    },
    readResource(resource, fallback) {
      if (store.readResource) {
        return store.readResource(resource, fallback);
      }
      return store.read(resource, fallback);
    },
    writeResource(resource, value) {
      if (store.writeResource) {
        return store.writeResource(resource, value);
      }
      return store.write(resource, value);
    },
    withResourceWrite(resource, operation) {
      if (store.withResourceWrite) {
        return store.withResourceWrite(resource, operation);
      }
      const queueKey = `${storeName}:${resource.name}`;
      const previous = queues.get(queueKey) ?? Promise.resolve();
      const current = previous.then(operation, operation);
      const stored = current.catch(() => {});
      queues.set(queueKey, stored);
      stored.finally(() => {
        if (queues.get(queueKey) === stored) {
          queues.delete(queueKey);
        }
      });
      return current;
    },
    close() {
      return store.close?.();
    },
  };
}

function missingStoreError(resource, storeName, config, adapters) {
  const availableStores = [
    ...new Set([
      ...adapters.keys(),
      ...Object.keys(config.stores ?? {}).filter((name) => name !== 'default'),
    ]),
  ];

  return dbError(
    'STORE_NOT_FOUND',
    `Store "${storeName}" is not configured for resource "${resource.name}".`,
    {
      status: 500,
      hint: `Configure stores.${storeName}, choose stores.default, or use one of: ${listChoices(availableStores)}.`,
      details: {
        resource: resource.name,
        store: storeName,
        availableStores,
      },
    },
  );
}

function builtinAdapters(config) {
  return [
    createJsonRuntimeAdapter(config),
    createMemoryRuntimeAdapter(config),
    createSourceRuntimeAdapter(config),
    createStaticRuntimeAdapter(config),
  ];
}
