import { dbError } from './errors.js';

const DEFAULT_READ_POLICY = 'cache-first';
const DEFAULT_WRITE_POLICY = 'merge-and-invalidate';
const DEFAULT_EVENT_POLICY = 'invalidate';
const CACHE_READ_POLICIES = new Set(['cache-first', 'cache-and-network', 'network-first', 'network-only', 'cache-only']);

type CacheReadPolicy = 'cache-first' | 'cache-and-network' | 'network-first' | 'network-only' | 'cache-only';
type CacheWritePolicy = 'merge-and-invalidate' | 'invalidate' | 'refetch' | string;
type CacheEventPolicy = 'invalidate' | 'refetch' | false | string;

type CacheResourceKind = 'collection' | 'document' | string;

type CacheManifestResource = Record<string, unknown> & {
  name: string;
  kind: CacheResourceKind;
  idField: string;
  routePath: string;
  typeName?: string;
};

type CacheManifest = Record<string, unknown> & {
  generatedAt?: string;
  collections?: Record<string, unknown>;
  documents?: Record<string, unknown>;
  api?: {
    log?: string;
    events?: string;
    [key: string]: unknown;
  };
};

type ClientCacheStorageContext = {
  baseNamespace: string;
  manifestFingerprint: string | null;
  namespace: string;
};

type ClientCacheStorage = {
  load?(context: ClientCacheStorageContext): unknown | Promise<unknown>;
  save?(snapshot: ClientCacheSnapshot, context: ClientCacheStorageContext): unknown | Promise<unknown>;
  clear?(context: ClientCacheStorageContext): unknown | Promise<unknown>;
};

type ClientCacheSnapshot = {
  namespace?: string;
  manifestFingerprint?: string | null;
  manifest?: unknown;
  queries?: unknown[];
  resources?: Record<string, unknown>;
  entities?: Record<string, unknown>;
  [key: string]: unknown;
};

type ClientCacheConfigInput = {
  enabled?: boolean;
  readPolicy?: string;
  writePolicy?: CacheWritePolicy;
  eventPolicy?: CacheEventPolicy;
  manifest?: CacheManifest | null;
  storage?: ClientCacheStorage | 'memory' | null;
};

type ClientCacheFactoryOptions = {
  cache?: boolean | ClientCacheConfigInput | null;
  cacheNamespace?: unknown;
  fetchManifest?: () => unknown | Promise<unknown>;
  createEventSource?: (path: string) => CacheEventSource | null | undefined;
  restBasePath?: string;
};

type NormalizedCacheConfig = {
  enabled: boolean;
  readPolicy: CacheReadPolicy;
  writePolicy: CacheWritePolicy;
  eventPolicy: CacheEventPolicy;
  manifest: CacheManifest | null;
  storage: ClientCacheStorage | 'memory' | null;
};

type CacheEventSource = {
  addEventListener?: (type: string, listener: (event: CacheEvent) => void) => unknown;
  on?: (type: string, listener: (event: CacheEvent) => void) => unknown;
};

type CacheEvent = {
  data?: string;
  [key: string]: unknown;
};

type RestCacheRequest = Record<string, unknown> & {
  method?: string;
  path?: string;
};

type RestCacheResult = Record<string, unknown> & {
  status?: number;
  body?: unknown;
};

type GraphqlCacheRequest = Record<string, unknown> & {
  query?: string;
  variables?: unknown;
  operationName?: string;
};

type GraphqlCacheResult = Record<string, unknown> & {
  data?: unknown;
  errors?: unknown[];
};

type CacheRequestOptions = {
  cache?: false | string | {
    readPolicy?: string;
    [key: string]: unknown;
  };
};

type QueryMeta = {
  resources: Set<string>;
  lists: Set<string>;
};

type QueryEntry = {
  value: unknown;
  stale: boolean;
  resources: Set<string>;
  lists: Set<string>;
  refetch: (() => Promise<unknown>) | null;
};

type InvalidateOptions = {
  staleRecords?: boolean;
  staleLists?: boolean;
  refetch?: boolean;
};

type CacheState = {
  manifest: CacheManifest | null;
  resources: Map<string, CacheManifestResource>;
  resourcesByTypeName: Map<string, CacheManifestResource>;
  collectionsBySingularName: Map<string, CacheManifestResource>;
  queries: Map<string, QueryEntry>;
  entities: Map<string, Map<string, unknown>>;
  inflight: Map<string, Promise<unknown>>;
  subscribers: Map<string, Set<(event: { data: unknown; stale: boolean; source: 'cache' }) => unknown>>;
  eventSources: CacheEventSource[];
  storage: ClientCacheStorage | null;
  storageNamespace: string;
  storageLoaded: boolean;
  storagePromise: Promise<void> | null;
  manifestPromise: Promise<CacheManifest> | null;
};

type PublicClientCacheApi = {
  enabled: boolean;
  clear(): void;
  invalidate(resourceName?: string | null): void;
  snapshot(): ClientCacheSnapshot;
  watch(request: unknown, callback: (event: { data: unknown; stale: boolean; source: 'cache' }) => unknown): () => void;
};

type ClientCacheController = {
  enabled: boolean;
  publicApi: PublicClientCacheApi;
  executeRestRead(
    request: RestCacheRequest,
    network: () => RestCacheResult | Promise<RestCacheResult>,
    requestOptions?: CacheRequestOptions,
  ): Promise<RestCacheResult | null>;
  executeGraphqlRead(
    request: GraphqlCacheRequest,
    network: () => GraphqlCacheResult | Promise<GraphqlCacheResult>,
    requestOptions?: CacheRequestOptions,
  ): Promise<GraphqlCacheResult | null>;
  recordRestWrite(request: RestCacheRequest, result: RestCacheResult): void;
  recordGraphqlWrite(result: GraphqlCacheResult): void;
};

type IndexedDbCacheStorageOptions = {
  name?: string;
  storeName?: string;
  key?: string;
  indexedDB?: IDBFactory;
};

export function createClientCache(options: ClientCacheFactoryOptions = {}): ClientCacheController {
  const config = normalizeCacheConfig(options.cache);
  if (!config.enabled) {
    return disabledClientCache();
  }

  const state: CacheState = {
    manifest: config.manifest ?? null,
    resources: new Map(),
    resourcesByTypeName: new Map(),
    collectionsBySingularName: new Map(),
    queries: new Map(),
    entities: new Map(),
    inflight: new Map(),
    subscribers: new Map(),
    eventSources: [],
    storage: normalizeStorage(config.storage),
    storageNamespace: normalizeCacheNamespace(options.cacheNamespace),
    storageLoaded: false,
    storagePromise: null,
    manifestPromise: null,
  };

  if (state.manifest) {
    indexManifest(state, state.manifest);
  }

  async function ensureManifest() {
    await ensureStorageLoaded(state);
    if (state.manifest) {
      connectEventSources(state, config, options);
      return state.manifest;
    }

    state.manifestPromise ??= Promise.resolve()
      .then(() => options.fetchManifest())
      .then((manifest) => {
        const nextManifest = manifest as CacheManifest;
        state.manifest = nextManifest;
        indexManifest(state, nextManifest);
        connectEventSources(state, config, options);
        return nextManifest;
      })
      .finally(() => {
        state.manifestPromise = null;
      });

    return state.manifestPromise;
  }

  async function executeRestRead(request, network, requestOptions = {}) {
    const policy = readPolicyFor(requestOptions, config.readPolicy);
    if (!policy) {
      return network();
    }

    await ensureManifest();
    const key = queryKey('rest', request);
    const target = restTargetForRequest(state, request, options);
    function writeNetworkResult(result) {
      if (!shouldCacheRestResult(result)) {
        return result;
      }
      const meta = createQueryMeta();
      const normalizedBody = target
        ? normalizeResourceValue(state, target.resource, result.body, meta)
        : normalizeAnyValue(state, result.body, meta);
      writeQuery(state, key, {
        ...result,
        body: normalizedBody,
      }, meta, () => fetchOnce(key, network).then(writeNetworkResult));
      return result;
    }

    return executeRead({
      key,
      policy,
      network,
      readCached: () => readQuery(state, key),
      writeResult: writeNetworkResult,
    });
  }

  async function executeGraphqlRead(request, network, requestOptions = {}) {
    const policy = readPolicyFor(requestOptions, config.readPolicy);
    if (!policy) {
      return network();
    }

    await ensureManifest();
    const key = queryKey('graphql', request);
    function writeNetworkResult(result) {
      if (!shouldCacheGraphqlResult(result)) {
        return result;
      }
      const meta = createQueryMeta();
      const normalizedData = normalizeGraphqlData(state, result.data, meta);
      writeQuery(state, key, {
        ...result,
        data: normalizedData,
      }, meta, () => fetchOnce(key, network).then(writeNetworkResult));
      return result;
    }

    return executeRead({
      key,
      policy,
      network,
      readCached: () => readQuery(state, key),
      writeResult: writeNetworkResult,
    });
  }

  async function executeRead({ key, policy, network, readCached, writeResult }) {
    if (policy === 'network-first') {
      try {
        const result = await fetchOnce(key, network);
        return writeResult(result);
      } catch (error) {
        const cached = readCached();
        if (cached) {
          return cached.value;
        }
        throw error;
      }
    }

    if (policy !== 'network-only') {
      const cached = readCached();
      if (cached && !cached.stale) {
        if (policy === 'cache-and-network') {
          void fetchOnce(key, network).then(writeResult, () => {});
        }
        return cached.value;
      }
      if (policy === 'cache-only') {
        return cached?.value ?? null;
      }
    }

    const result = await fetchOnce(key, network);
    return writeResult(result);
  }

  function fetchOnce(key, network) {
    if (state.inflight.has(key)) {
      return state.inflight.get(key);
    }

    const promise = Promise.resolve()
      .then(network)
      .finally(() => {
        state.inflight.delete(key);
      });
    state.inflight.set(key, promise);
    return promise;
  }

  function recordRestWrite(request, result) {
    if (!isSuccessfulRestWrite(request, result)) {
      return;
    }

    const target = restTargetForRequest(state, request, options);
    if (!target) {
      invalidateQueries(state, null, { staleRecords: true, refetch: config.writePolicy === 'refetch' });
      return;
    }

    if (config.writePolicy === 'invalidate') {
      invalidateQueries(state, target.resource.name, { staleRecords: true });
      return;
    }

    const meta = createQueryMeta();
    if (request.method === 'DELETE') {
      if (target.id !== undefined) {
        deleteEntity(state, target.resource.name, target.id);
      }
      invalidateQueries(state, target.resource.name, {
        staleRecords: true,
        refetch: config.writePolicy === 'refetch',
      });
      scheduleStorageSave(state);
      return;
    }

    normalizeResourceValue(state, target.resource, result.body, meta);
    invalidateQueries(state, target.resource.name, config.writePolicy === 'refetch'
      ? { staleRecords: true, refetch: true }
      : { staleLists: true });
    scheduleStorageSave(state);
  }

  function recordGraphqlWrite(result) {
    if (!shouldCacheGraphqlResult(result)) {
      return;
    }

    if (config.writePolicy === 'invalidate') {
      const meta = createQueryMeta();
      collectGraphqlResources(state, result.data, meta);
      invalidateMetaResources(state, meta, { staleRecords: true });
      return;
    }

    const meta = createQueryMeta();
    normalizeGraphqlData(state, result.data, meta);
    invalidateMetaResources(state, meta, config.writePolicy === 'refetch'
      ? { staleRecords: true, refetch: true }
      : { staleLists: true });
    scheduleStorageSave(state);
  }

  const publicApi = {
    enabled: true,
    clear() {
      state.queries.clear();
      state.entities.clear();
      void state.storage?.clear?.(storageContext(state));
      notifySubscribers(state);
    },
    invalidate(resourceName) {
      invalidateQueries(state, resourceName, { staleRecords: true });
    },
    snapshot() {
      return snapshotForStorage(state);
    },
    watch(request, callback) {
      const key = watchKey(request);
      const subscribers = state.subscribers.get(key) ?? new Set();
      subscribers.add(callback);
      state.subscribers.set(key, subscribers);

      const cached = readQuery(state, key);
      if (cached) {
        callback({
          data: cached.value,
          stale: cached.stale,
          source: 'cache',
        });
      }

      return () => {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          state.subscribers.delete(key);
        }
      };
    },
  };

  return {
    enabled: true,
    publicApi,
    executeRestRead,
    executeGraphqlRead,
    recordRestWrite,
    recordGraphqlWrite,
  };
}

function connectEventSources(state, config, options) {
  if (config.eventPolicy === false || state.eventSources.length > 0 || typeof options.createEventSource !== 'function') {
    return;
  }

  const logPath = state.manifest?.api?.log;
  const eventsPath = state.manifest?.api?.events;
  if (logPath) {
    const logEvents = options.createEventSource(logPath);
    if (logEvents) {
      addEventListener(logEvents, 'db-log', (event) => {
        const payload = parseEventPayload(event);
        if (payload?.resource) {
          invalidateQueries(state, payload.resource, { staleRecords: true, refetch: config.eventPolicy === 'refetch' });
        }
      });
      state.eventSources.push(logEvents);
    }
  }

  if (eventsPath) {
    const sourceEvents = options.createEventSource(eventsPath);
    if (sourceEvents) {
      addEventListener(sourceEvents, 'db', (event) => {
        const payload = parseEventPayload(event);
        if (!payload || payload.type === 'connected') {
          return;
        }
        state.manifest = null;
        state.resources.clear();
        state.resourcesByTypeName.clear();
        state.collectionsBySingularName.clear();
        invalidateQueries(state, null, { staleRecords: true, refetch: config.eventPolicy === 'refetch' });
      });
      state.eventSources.push(sourceEvents);
    }
  }
}

function addEventListener(source, type, listener) {
  if (typeof source.addEventListener === 'function') {
    source.addEventListener(type, listener);
    return;
  }
  if (typeof source.on === 'function') {
    source.on(type, listener);
  }
}

function parseEventPayload(event) {
  try {
    return JSON.parse(event?.data ?? 'null');
  } catch {
    return null;
  }
}

function disabledClientCache() {
  return {
    enabled: false,
    publicApi: {
      enabled: false,
      clear() {},
      invalidate() {},
      snapshot() {
        return {
          manifest: null,
          queries: [],
          resources: {},
        };
      },
      watch() {
        return () => {};
      },
    },
    async executeRestRead(_request, network) {
      return network();
    },
    async executeGraphqlRead(_request, network) {
      return network();
    },
    recordRestWrite() {},
    recordGraphqlWrite() {},
  };
}

function normalizeCacheConfig(cache) {
  if (cache === true) {
    return {
      enabled: true,
      readPolicy: DEFAULT_READ_POLICY,
      writePolicy: DEFAULT_WRITE_POLICY,
      eventPolicy: DEFAULT_EVENT_POLICY,
      manifest: null,
      storage: 'memory',
    };
  }

  if (!cache || cache.enabled === false) {
    return {
      enabled: false,
    };
  }

  return {
    enabled: true,
    readPolicy: normalizeReadPolicy(cache.readPolicy ?? DEFAULT_READ_POLICY),
    writePolicy: cache.writePolicy ?? DEFAULT_WRITE_POLICY,
    eventPolicy: cache.eventPolicy ?? DEFAULT_EVENT_POLICY,
    manifest: cache.manifest ?? null,
    storage: cache.storage ?? 'memory',
  };
}

function normalizeStorage(storage) {
  if (!storage || storage === 'memory') {
    return null;
  }
  if (typeof storage === 'object') {
    return storage;
  }
  return null;
}

function normalizeCacheNamespace(value) {
  if (value === undefined || value === null || value === '') {
    return 'default';
  }
  if (typeof value === 'string') {
    return value;
  }
  return stableStringify(value);
}

async function ensureStorageLoaded(state) {
  if (state.storageLoaded || !state.storage?.load) {
    state.storageLoaded = true;
    return;
  }

  state.storagePromise ??= Promise.resolve()
    .then(() => state.storage.load(storageContext(state)))
    .then((snapshot) => {
      hydrateStorageSnapshot(state, snapshot);
      state.storageLoaded = true;
    })
    .catch(() => {
      state.storageLoaded = true;
    })
    .finally(() => {
      state.storagePromise = null;
    });

  await state.storagePromise;
}

function hydrateStorageSnapshot(state, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return;
  }
  if (snapshot.manifest && !state.manifest) {
    state.manifest = cloneValue(snapshot.manifest);
    indexManifest(state, state.manifest);
  }
  if (snapshot.entities && typeof snapshot.entities === 'object') {
    for (const [resourceName, records] of Object.entries(snapshot.entities)) {
      state.entities.set(resourceName, new Map(Object.entries(records ?? {}).map(([id, value]) => [id, cloneValue(value)])));
    }
  }
  if (Array.isArray(snapshot.queries)) {
    for (const entry of snapshot.queries) {
      if (!entry?.key) {
        continue;
      }
      state.queries.set(entry.key, {
        value: cloneValue(entry.value),
        stale: Boolean(entry.stale),
        resources: new Set(entry.resources ?? []),
        lists: new Set(entry.lists ?? []),
        refetch: null,
      });
    }
  }
}

function scheduleStorageSave(state) {
  if (!state.storage?.save || !state.storageLoaded) {
    return;
  }
  void Promise.resolve(state.storage.save(snapshotForStorage(state), storageContext(state))).catch(() => {});
}

function snapshotForStorage(state) {
  const context = storageContext(state);
  return {
    namespace: context.namespace,
    manifestFingerprint: context.manifestFingerprint,
    manifest: cloneValue(state.manifest),
    queries: [...state.queries.entries()].map(([key, entry]) => ({
      key,
      value: cloneValue(entry.value),
      stale: Boolean(entry.stale),
      resources: [...entry.resources],
      lists: [...entry.lists],
    })),
    resources: Object.fromEntries([...state.entities.entries()].map(([resourceName, records]) => [
      resourceName,
      Object.fromEntries([...records.entries()].map(([id, value]) => [id, denormalizeValue(state, value)])),
    ])),
    entities: Object.fromEntries([...state.entities.entries()].map(([resourceName, records]) => [
      resourceName,
      Object.fromEntries([...records.entries()].map(([id, value]) => [id, cloneValue(value)])),
    ])),
  };
}

function storageContext(state) {
  const baseNamespace = `async-db:${state.storageNamespace}`;
  const manifestFingerprint = state.manifest ? stableManifestFingerprint(state.manifest) : null;
  return {
    baseNamespace,
    manifestFingerprint,
    namespace: manifestFingerprint ? `${baseNamespace}:${manifestFingerprint}` : baseNamespace,
  };
}

function normalizeReadPolicy(value) {
  const policy = String(value ?? DEFAULT_READ_POLICY);
  if (CACHE_READ_POLICIES.has(policy)) {
    return policy;
  }
  return DEFAULT_READ_POLICY;
}

function readPolicyFor(requestOptions, defaultPolicy) {
  const option = requestOptions?.cache;
  if (option === false) {
    return null;
  }
  if (typeof option === 'string') {
    return normalizeReadPolicy(option);
  }
  if (option && typeof option === 'object' && option.readPolicy) {
    return normalizeReadPolicy(option.readPolicy);
  }
  return defaultPolicy;
}

function indexManifest(state, manifest) {
  state.resources.clear();
  state.resourcesByTypeName.clear();
  state.collectionsBySingularName.clear();

  for (const [name, resource] of Object.entries(manifest?.collections ?? {})) {
    const normalized = normalizeManifestResource(name, 'collection', resource);
    state.resources.set(name, normalized);
    if (normalized.typeName) {
      state.resourcesByTypeName.set(normalized.typeName, normalized);
      state.collectionsBySingularName.set(lowerFirst(normalized.typeName), normalized);
    }
  }

  for (const [name, resource] of Object.entries(manifest?.documents ?? {})) {
    const normalized = normalizeManifestResource(name, 'document', resource);
    state.resources.set(name, normalized);
    if (normalized.typeName) {
      state.resourcesByTypeName.set(normalized.typeName, normalized);
    }
  }
}

function normalizeManifestResource(name, kind, resource) {
  return {
    ...resource,
    name,
    kind,
    idField: resource.idField ?? 'id',
    routePath: resource.routePath ?? `/${name}`,
  };
}

function restTargetForRequest(state: CacheState, request: RestCacheRequest, options: Pick<ClientCacheFactoryOptions, 'restBasePath'> = {}) {
  const method = String(request.method ?? 'GET').toUpperCase();
  const url = new URL(request.path ?? '/', 'http://db.local');
  const pathname = stripBasePath(url.pathname, options.restBasePath);
  for (const resource of state.resources.values()) {
    const route = resource.routePath ?? `/${resource.name}`;
    const routeJson = `${route}.json`;
    if (pathname === route || pathname === routeJson) {
      return {
        resource,
        kind: resource.kind === 'collection' && method === 'GET' && url.searchParams.has('id') ? 'record' : resource.kind,
        id: resource.kind === 'collection' && url.searchParams.has('id') ? url.searchParams.get('id') : undefined,
      };
    }

    if (resource.kind !== 'collection') {
      continue;
    }

    const prefix = `${route}/`;
    if (pathname.startsWith(prefix)) {
      const rawId = pathname.slice(prefix.length).split('/')[0];
      return {
        resource,
        kind: 'record',
        id: decodeURIComponent(stripFormat(rawId)),
      };
    }
  }

  return null;
}

function stripBasePath(pathname, basePath) {
  if (!basePath) {
    return pathname;
  }
  const base = `/${String(basePath).replace(/^\/+/, '').replace(/\/+$/, '')}`;
  if (pathname === base) {
    return '/';
  }
  if (pathname.startsWith(`${base}/`)) {
    return pathname.slice(base.length);
  }
  return pathname;
}

function stripFormat(value) {
  return String(value ?? '').replace(/\.[A-Za-z][A-Za-z0-9_-]*$/, '');
}

function shouldCacheRestResult(result) {
  return result && typeof result.status === 'number' && result.status >= 200 && result.status < 300;
}

function shouldCacheGraphqlResult(result) {
  return result && (!Array.isArray(result.errors) || result.errors.length === 0);
}

function isSuccessfulRestWrite(request, result) {
  const method = String(request.method ?? 'GET').toUpperCase();
  return method !== 'GET' && shouldCacheRestResult(result);
}

function normalizeGraphqlData(state, data, meta) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return cloneValue(data);
  }

  const normalized = {};
  for (const [key, value] of Object.entries(data)) {
    const resource = graphqlResourceForRoot(state, key, value);
    normalized[key] = resource
      ? normalizeResourceValue(state, resource, value, meta)
      : normalizeAnyValue(state, value, meta);
  }
  return normalized;
}

function collectGraphqlResources(state, value, meta) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectGraphqlResources(state, item, meta);
    }
    return;
  }
  if (!isObject(value)) {
    return;
  }

  const resource = value.__typename ? state.resourcesByTypeName.get(value.__typename) : null;
  if (resource) {
    meta.resources.add(resource.name);
  }
  for (const child of Object.values(value)) {
    collectGraphqlResources(state, child, meta);
  }
}

function invalidateMetaResources(state, meta, options) {
  if (meta.resources.size === 0) {
    invalidateQueries(state, null, options);
    return;
  }
  for (const resourceName of meta.resources) {
    invalidateQueries(state, resourceName, options);
  }
}

function graphqlResourceForRoot(state, key, value) {
  if (state.resources.has(key)) {
    return state.resources.get(key);
  }
  if (state.collectionsBySingularName.has(key)) {
    return state.collectionsBySingularName.get(key);
  }
  const sample = Array.isArray(value) ? value.find(isObject) : value;
  if (sample?.__typename && state.resourcesByTypeName.has(sample.__typename)) {
    return state.resourcesByTypeName.get(sample.__typename);
  }
  return null;
}

function normalizeResourceValue(state, resource, value, meta) {
  meta.resources.add(resource.name);
  if (resource.kind === 'document') {
    const normalized = normalizeAnyValue(state, value, meta);
    setEntity(state, resource.name, '__document', normalized);
    return entityRef(resource.name, '__document');
  }

  if (Array.isArray(value)) {
    meta.lists.add(resource.name);
    return value.map((item) => normalizeRecordValue(state, resource, item, meta));
  }

  return normalizeRecordValue(state, resource, value, meta);
}

function normalizeRecordValue(state, resource, value, meta) {
  if (!isObject(value)) {
    return cloneValue(value);
  }

  const normalized = normalizeObjectFields(state, value, meta);
  const id = normalized?.[resource.idField];
  if (id === undefined || id === null || id === '') {
    return normalized;
  }

  setEntity(state, resource.name, id, normalized);
  return entityRef(resource.name, id);
}

function normalizeAnyValue(state, value, meta) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeAnyValue(state, item, meta));
  }

  if (!isObject(value)) {
    return cloneValue(value);
  }

  const resource = value.__typename ? state.resourcesByTypeName.get(value.__typename) : null;
  if (resource?.kind === 'collection' && value[resource.idField] !== undefined) {
    meta.resources.add(resource.name);
    return normalizeRecordValue(state, resource, value, meta);
  }
  if (resource?.kind === 'document') {
    meta.resources.add(resource.name);
    const normalized = normalizeObjectFields(state, value, meta);
    setEntity(state, resource.name, '__document', normalized);
    return entityRef(resource.name, '__document');
  }

  return normalizeObjectFields(state, value, meta);
}

function normalizeObjectFields(state, value, meta) {
  const normalized = {};
  for (const [key, child] of Object.entries(value)) {
    normalized[key] = normalizeAnyValue(state, child, meta);
  }
  return normalized;
}

function setEntity(state, resourceName, id, value) {
  const idKey = String(id);
  const records = state.entities.get(resourceName) ?? new Map();
  const existing = records.get(idKey);
  records.set(idKey, mergeEntity(existing, value));
  state.entities.set(resourceName, records);
}

function deleteEntity(state, resourceName, id) {
  const records = state.entities.get(resourceName);
  records?.delete(String(id));
}

function mergeEntity(existing, value) {
  if (!isObject(existing) || !isObject(value)) {
    return cloneValue(value);
  }
  return {
    ...existing,
    ...cloneValue(value),
  };
}

function entityRef(resource, id) {
  return {
    __dbRef: {
      resource,
      id: String(id),
    },
  };
}

function createQueryMeta() {
  return {
    resources: new Set(),
    lists: new Set(),
  };
}

function writeQuery(state, key, value, meta, refetch = null) {
  state.queries.set(key, {
    value,
    stale: false,
    resources: new Set(meta.resources),
    lists: new Set(meta.lists),
    refetch,
  });
  scheduleStorageSave(state);
  notifySubscribers(state, key);
}

function readQuery(state, key) {
  const entry = state.queries.get(key);
  if (!entry) {
    return null;
  }

  return {
    stale: entry.stale,
    value: denormalizeValue(state, entry.value),
  };
}

function invalidateQueries(state: CacheState, resourceName: string | null, options: InvalidateOptions = {}) {
  for (const [key, entry] of state.queries.entries()) {
    const touchesResource = !resourceName || entry.resources.has(resourceName);
    if (!touchesResource) {
      continue;
    }

    const stale = !resourceName
      || options.staleRecords
      || (options.staleLists && entry.lists.has(resourceName));
    if (stale) {
      entry.stale = true;
    }
    notifySubscribers(state, key);
    if (stale && options.refetch && state.subscribers.has(key) && typeof entry.refetch === 'function') {
      void entry.refetch();
    }
  }
  scheduleStorageSave(state);
}

function denormalizeValue(state, value) {
  if (Array.isArray(value)) {
    return value.map((item) => denormalizeValue(state, item));
  }

  if (!isObject(value)) {
    return cloneValue(value);
  }

  if (value.__dbRef) {
    const record = state.entities.get(value.__dbRef.resource)?.get(String(value.__dbRef.id));
    return record ? denormalizeValue(state, record) : null;
  }

  const denormalized = {};
  for (const [key, child] of Object.entries(value)) {
    denormalized[key] = denormalizeValue(state, child);
  }
  return denormalized;
}

function notifySubscribers(state, key = null) {
  const keys = key ? [key] : [...state.subscribers.keys()];
  for (const queryKeyValue of keys) {
    const subscribers = state.subscribers.get(queryKeyValue);
    if (!subscribers?.size) {
      continue;
    }

    const cached = readQuery(state, queryKeyValue);
    for (const subscriber of subscribers) {
      subscriber({
        data: cached?.value ?? null,
        stale: cached?.stale ?? true,
        source: 'cache',
      });
    }
  }
}

function watchKey(request) {
  if (request?.kind === 'graphql') {
    return queryKey('graphql', {
      query: request.query,
      variables: request.variables,
      operationName: request.operationName,
    });
  }

  return queryKey('rest', {
    method: request?.method ?? 'GET',
    path: request?.path ?? '/',
  });
}

function queryKey(kind, request) {
  return `${kind}:${stableStringify(omitUndefined(request))}`;
}

function omitUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(omitUndefined);
  }
  if (!isObject(value)) {
    return value;
  }

  return Object.fromEntries(Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .map(([key, entryValue]) => [key, omitUndefined(entryValue)]));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function stableManifestFingerprint(manifest) {
  const string = stableStringify(stripGeneratedAt(manifest));
  let hash = 2166136261;
  for (let index = 0; index < string.length; index += 1) {
    hash ^= string.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stripGeneratedAt(value) {
  if (Array.isArray(value)) {
    return value.map(stripGeneratedAt);
  }
  if (!isObject(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'generatedAt')
    .map(([key, entryValue]) => [key, stripGeneratedAt(entryValue)]));
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function lowerFirst(value) {
  const string = String(value ?? '');
  return string ? `${string[0].toLowerCase()}${string.slice(1)}` : string;
}

export function createIndexedDbCacheStorage(options: IndexedDbCacheStorageOptions = {}): ClientCacheStorage {
  const databaseName = options.name ?? 'async-db-cache';
  const storeName = options.storeName ?? 'snapshots';
  const hasExplicitKey = Object.prototype.hasOwnProperty.call(options, 'key');
  const key = options.key ?? 'default';
  const indexedDb = options.indexedDB ?? globalThis.indexedDB;
  if (!indexedDb) {
    throw dbError(
      'CLIENT_INDEXEDDB_UNAVAILABLE',
      'IndexedDB cache storage is not available in this environment.',
      {
        hint: 'Use cache: { enabled: true, storage: "memory" } or call createIndexedDbCacheStorage() in a browser with IndexedDB.',
      },
    );
  }

  function storageKey(context) {
    if (hasExplicitKey) {
      return key;
    }
    return context?.namespace ?? context?.baseNamespace ?? key;
  }

  function latestKey(context) {
    if (hasExplicitKey || !context?.baseNamespace) {
      return null;
    }
    return `${context.baseNamespace}:latest`;
  }

  async function withStore(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
    const db = await openIndexedDb(indexedDb, databaseName, storeName);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = callback(store);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? transaction.error);
    });
  }

  return {
    async load(context) {
      const indexKey = latestKey(context);
      if (indexKey && !context?.manifestFingerprint) {
        const indexedKey = await withStore('readonly', (store) => store.get(indexKey));
        if (indexedKey) {
          return withStore('readonly', (store) => store.get(indexedKey as IDBValidKey));
        }
      }
      return withStore('readonly', (store) => store.get(storageKey(context)));
    },
    async save(snapshot, context) {
      const selectedKey = storageKey(context);
      await withStore('readwrite', (store) => store.put(snapshot, selectedKey));
      const indexKey = latestKey(context);
      if (indexKey) {
        await withStore('readwrite', (store) => store.put(selectedKey, indexKey));
      }
    },
    async clear(context) {
      const selectedKey = storageKey(context);
      const indexKey = latestKey(context);
      if (indexKey) {
        const indexedKey = await withStore('readonly', (store) => store.get(indexKey));
        if (indexedKey) {
          await withStore('readwrite', (store) => store.delete(indexedKey as IDBValidKey));
        }
        await withStore('readwrite', (store) => store.delete(indexKey));
      }
      await withStore('readwrite', (store) => store.delete(selectedKey));
    },
  };
}

function openIndexedDb(indexedDb: IDBFactory, databaseName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames?.contains?.(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
