import { dbError, listChoices } from '../../errors.js';
import { resourceConfigValue } from '../../names.js';
import { createJsonRuntimeAdapter } from './json.js';
import { createMemoryRuntimeAdapter } from './memory.js';
import { createSourceRuntimeAdapter } from './source.js';
import { createStaticRuntimeAdapter } from './static.js';
import { createRuntimeEventHub } from './events.js';

type RuntimeResource = {
  name: string;
  [key: string]: unknown;
};

type RuntimeConfig = {
  cwd: string;
  stateDir: string;
  resources?: Record<string, unknown>;
  git?: {
    mirror?: unknown;
    [key: string]: unknown;
  };
  stores?: Record<string, unknown>;
  [key: string]: unknown;
};

type RuntimeAdapter = {
  name: string;
  capabilities?: unknown;
  statePath?: (resource: RuntimeResource) => unknown;
  hydrate?: (resources: RuntimeResource[]) => unknown | Promise<unknown>;
  readResource?: (resource: RuntimeResource, fallback: unknown) => unknown | Promise<unknown>;
  writeResource?: (resource: RuntimeResource, value: unknown) => unknown | Promise<unknown>;
  writeResourceDelta?: (resource: RuntimeResource, value: unknown, delta: Record<string, unknown>) => unknown | Promise<unknown>;
  withResourceWrite?: <T>(resource: RuntimeResource, operation: () => T | Promise<T>) => T | Promise<T>;
  close?: () => unknown | Promise<unknown>;
};

type CustomStore = {
  name?: string;
  driver?: string;
  capabilities?: unknown;
  statePath?: (resource: RuntimeResource) => unknown;
  hydrate?: (resources: RuntimeResource[]) => unknown | Promise<unknown>;
  readResource?: (resource: RuntimeResource, fallback: unknown) => unknown | Promise<unknown>;
  get?: (resource: RuntimeResource, fallback: unknown) => unknown | Promise<unknown>;
  read: (resource: RuntimeResource, fallback: unknown) => unknown | Promise<unknown>;
  writeResource?: (resource: RuntimeResource, value: unknown) => unknown | Promise<unknown>;
  writeResourceDelta?: (resource: RuntimeResource, value: unknown, delta: Record<string, unknown>) => unknown | Promise<unknown>;
  set?: (resource: RuntimeResource, value: unknown) => unknown | Promise<unknown>;
  write: (resource: RuntimeResource, value: unknown) => unknown | Promise<unknown>;
  withResourceWrite?: <T>(resource: RuntimeResource, operation: () => T | Promise<T>) => T | Promise<T>;
  close?: () => unknown | Promise<unknown>;
};

type CustomStoreFactory = (context: {
  config: RuntimeConfig;
  resources: RuntimeResource[];
  storeName: string;
}) => CustomStore | null | undefined;

type StoreConfigRecord = {
  driver?: string;
  store?: string;
  [key: string]: unknown;
};

export function createRuntime(config: RuntimeConfig, resources: RuntimeResource[]) {
  const events = createRuntimeEventHub();
  const adapters = new Map<string, RuntimeAdapter>();
  const storeDefinitions = new Map<string, CustomStore>();
  const customStoreQueues = new Map<string, Promise<unknown>>();
  let closed = false;

  for (const adapter of builtinAdapters(config)) {
    adapters.set(adapter.name, adapter);
  }

  const gitMirror = gitMirrorStore(config, resources);
  if (gitMirror) {
    storeDefinitions.set('gitMirror', gitMirror);
    adapters.set('gitMirror', customStoreAdapter('gitMirror', gitMirror, customStoreQueues));
  }

  for (const [storeName, storeDefinition] of Object.entries(config.stores ?? {})) {
    if (storeName === 'default' || typeof storeDefinition === 'string' || storeRecord(storeDefinition)?.driver) {
      continue;
    }

    const store = typeof storeDefinition === 'function'
      ? (storeDefinition as CustomStoreFactory)({ config, resources, storeName })
      : storeDefinition as CustomStore | null | undefined;
    if (store) {
      storeDefinitions.set(storeName, store);
      adapters.set(storeName, customStoreAdapter(storeName, store, customStoreQueues));
    }
  }

  return {
    events,
    adapterNames(): string[] {
      return [...adapters.keys()];
    },
    strategyFor(resource: RuntimeResource): string {
      const resourceConfig = storeRecord(resourceConfigValue(config.resources, resource.name));
      const storeName = String(resourceConfig?.store ?? defaultStoreForResource(config, resource));
      return strategyForStoreName(resource, storeName, config, adapters, storeDefinitions);
    },
    adapterForStore(resource: RuntimeResource, storeName: string): RuntimeAdapter {
      const strategy = strategyForStoreName(resource, storeName, config, adapters, storeDefinitions);
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
      return protectGitMirrorWrites(config, resource, adapter);
    },
    adapterFor(resource: RuntimeResource): RuntimeAdapter {
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
      return protectGitMirrorWrites(config, resource, adapter);
    },
    async hydrate(): Promise<void> {
      const byAdapter = new Map<RuntimeAdapter, RuntimeResource[]>();
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
    emit(change: Record<string, unknown>) {
      return events.emit(change);
    },
    async close(): Promise<void> {
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

function defaultStoreForResource(config: RuntimeConfig, resource: RuntimeResource): string {
  if (isGitBackedResource(resource)) {
    return gitMirrorStoreName(config);
  }
  return String(config.stores?.default ?? 'json');
}

function gitMirrorStoreName(config: RuntimeConfig): string {
  const mirror = config.git?.mirror;
  if (!mirror) {
    return String(config.stores?.default ?? 'json');
  }
  if (typeof mirror === 'function' || isCustomStore(mirror)) {
    return 'gitMirror';
  }
  const record = storeRecord(mirror);
  return String(record?.store ?? record?.driver ?? config.stores?.default ?? 'json');
}

function gitMirrorWrites(config: RuntimeConfig): string {
  const mirror = config.git?.mirror;
  if (mirror && (typeof mirror === 'object' || typeof mirror === 'function') && !Array.isArray(mirror)) {
    const record = mirror as Record<string, unknown>;
    if (typeof record.writes === 'string') {
      return record.writes;
    }
    const gitMirror = record.gitMirror;
    if (gitMirror && typeof gitMirror === 'object' && !Array.isArray(gitMirror) && typeof (gitMirror as Record<string, unknown>).writes === 'string') {
      return String((gitMirror as Record<string, unknown>).writes);
    }
  }
  return 'receipt';
}

function protectGitMirrorWrites(config: RuntimeConfig, resource: RuntimeResource, adapter: RuntimeAdapter): RuntimeAdapter {
  if (!isGitBackedResource(resource) || gitMirrorWrites(config) === 'through') {
    return adapter;
  }

  const writeError = () => dbError(
    'GIT_WRITE_DRIVER_REQUIRED',
    `Git-backed resource "${resource.name}" cannot be written through a receipt-mode mirror without a Git write driver.`,
    {
      status: 409,
      hint: 'Configure git.mirror: sqliteMirror({ writes: "through" }) for durable local outbox writes, or route writes through @async/github-app so Git commits and receipts update the mirror.',
      details: {
        resource: resource.name,
        source: storeRecord(resource.source),
        mirrorWrites: gitMirrorWrites(config),
      },
    },
  );

  return {
    ...adapter,
    writeResource() {
      throw writeError();
    },
    writeResourceDelta() {
      throw writeError();
    },
  };
}

function gitMirrorStore(config: RuntimeConfig, resources: RuntimeResource[]): CustomStore | null {
  const mirror = config.git?.mirror;
  if (!mirror || (!isCustomStore(mirror) && typeof mirror !== 'function')) {
    return null;
  }
  return typeof mirror === 'function'
    ? (mirror as CustomStoreFactory)({ config, resources, storeName: 'gitMirror' }) ?? null
    : mirror;
}

function isGitBackedResource(resource: RuntimeResource): boolean {
  return storeRecord(resource.source)?.kind === 'git-files';
}

function isCustomStore(value: unknown): value is CustomStore {
  const record = storeRecord(value);
  return Boolean(record && (typeof record.readResource === 'function' || typeof record.read === 'function'));
}

function strategyForStoreName(
  resource: RuntimeResource,
  storeName: string,
  config: RuntimeConfig,
  adapters: Map<string, RuntimeAdapter>,
  storeDefinitions: Map<string, CustomStore>,
): string {
  const configured = storeDefinitions.has(storeName)
    ? storeName
    : config.stores?.[storeName] ?? storeName;
  if (!adapters.has(storeName) && config.stores?.[storeName] === undefined) {
    throw missingStoreError(resource, storeName, config, adapters);
  }
  const configuredRecord = storeRecord(configured);
  return typeof configured === 'string' ? configured : configuredRecord?.driver ?? storeName;
}

function customStoreAdapter(storeName: string, store: CustomStore, queues: Map<string, Promise<unknown>>): RuntimeAdapter {
  return {
    name: store.name ?? storeName,
    capabilities: store.capabilities,
    statePath(resource: RuntimeResource) {
      return store.statePath?.(resource);
    },
    hydrate(resources: RuntimeResource[]) {
      return store.hydrate?.(resources);
    },
    readResource(resource: RuntimeResource, fallback: unknown) {
      if (store.readResource) {
        return store.readResource(resource, fallback);
      }
      if (store.get) {
        return store.get(resource, fallback);
      }
      return store.read(resource, fallback);
    },
    writeResource(resource: RuntimeResource, value: unknown) {
      if (store.writeResource) {
        return store.writeResource(resource, value);
      }
      if (store.set) {
        return store.set(resource, value);
      }
      return store.write(resource, value);
    },
    withResourceWrite<T>(resource: RuntimeResource, operation: () => T | Promise<T>) {
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

function missingStoreError(
  resource: RuntimeResource,
  storeName: string,
  config: RuntimeConfig,
  adapters: Map<string, RuntimeAdapter>,
): Error {
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

function builtinAdapters(config: RuntimeConfig): RuntimeAdapter[] {
  return [
    createJsonRuntimeAdapter(config),
    createMemoryRuntimeAdapter(config),
    createSourceRuntimeAdapter(config),
    createStaticRuntimeAdapter(config),
  ];
}

function storeRecord(value: unknown): StoreConfigRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as StoreConfigRecord : null;
}
