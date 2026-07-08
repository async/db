import { dbFileSystem, type DbFileSystem } from '../fs/index.js';
import { resolveFrom, writeText } from '../../fs-utils.js';
import { resourceConfigValue } from '../../names.js';
import { restFormatMetadata } from '../../rest/formats.js';
import { loadProjectSchema } from '../schema/project.js';
import { renderSchemaManifest } from '../schema/manifest.js';

type ViewerConfig = {
  cwd?: string;
  viewerManifestOutFile?: string | null;
  fs?: DbFileSystem;
  rest?: {
    enabled?: boolean;
    formats?: Record<string, string | ((...args: unknown[]) => unknown) | Record<string, unknown> | null | undefined>;
  };
  graphql?: {
    enabled?: boolean;
    path?: string;
  };
  falcor?: {
    enabled?: boolean;
    path?: string;
  };
  server?: {
    apiBase?: string;
    expose?: Record<string, unknown>;
    viewerLinks?: unknown[];
  };
  operations?: {
    enabled?: boolean;
    acceptRefs?: string;
    outFile?: string | null;
    refsOutFile?: string | null;
    registry?: Record<string, unknown>;
    resolveRef?: unknown;
  };
  outputs?: {
    operationRegistry?: string | null;
    operationRefs?: string | null;
  };
  contracts?: Record<string, unknown>;
  resources?: Record<string, unknown>;
  stores?: Record<string, unknown>;
  git?: {
    mirror?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ViewerRoutes = {
  apiBase?: string;
  viewerPath?: string;
  manifestPath?: string;
  manifestJsonPath?: string;
  manifestHtmlPath?: string;
  manifestMarkdownPath?: string;
  schemaPath?: string;
  eventsPath?: string;
  logPath?: string;
  batchPath?: string;
  importPath?: string;
  graphqlPath?: string;
  falcorPath?: string;
  restBasePath?: string | null;
  resourceBasePath?: string;
  [key: string]: unknown;
};

type NormalizedViewerRoutes = Required<Pick<
  ViewerRoutes,
  | 'apiBase'
  | 'viewerPath'
  | 'manifestPath'
  | 'manifestJsonPath'
  | 'manifestHtmlPath'
  | 'manifestMarkdownPath'
  | 'schemaPath'
  | 'eventsPath'
  | 'logPath'
  | 'batchPath'
  | 'importPath'
  | 'graphqlPath'
  | 'falcorPath'
>> & {
  restBasePath: string;
  resourceBasePath: string;
};

type ViewerResource = {
  name: string;
  kind: 'collection' | 'document' | string;
  typeName?: string;
  routePath: string;
  idField?: string;
  dataPath?: string | null;
  dataFormat?: string | null;
  identity?: {
    fields?: string[];
  };
  source?: unknown;
  writePolicy?: string;
  relations?: unknown[];
  [key: string]: unknown;
};

type SchemaManifestBucket = Record<string, Record<string, unknown>>;

type SchemaManifest = {
  collections?: SchemaManifestBucket;
  documents?: SchemaManifestBucket;
  [key: string]: unknown;
};

type ViewerProject = {
  resources: ViewerResource[];
  diagnostics: unknown[];
};

type GenerateViewerManifestOptions = {
  project?: unknown;
  outFile?: string;
  generatedAt?: string;
  routes?: ViewerRoutes;
};

type RenderViewerManifestOptions = {
  generatedAt?: string;
  routes?: ViewerRoutes;
  diagnostics?: unknown[];
};

type ViewerLink = {
  label: string;
  href: string;
  source: 'built-in' | 'custom';
};

type ViewerManifestDriver =
  | 'json'
  | 'sourceFile'
  | 'sqlite'
  | 'postgres'
  | 'kv'
  | 'redis'
  | 'redisJson'
  | 'memory'
  | 'static'
  | 'gitMirror'
  | 'custom';

type ViewerManifestStoreCapabilities = {
  read: boolean;
  write: boolean;
  create?: boolean;
  patch?: boolean;
  delete?: boolean;
  batch?: boolean;
  importCsv?: boolean;
  query?: boolean;
  sql?: boolean;
  explain?: boolean;
  transactions?: boolean;
  indexes?: boolean;
};

type ViewerManifestStore = {
  name: string;
  driver: ViewerManifestDriver;
  label?: string;
  capabilities: ViewerManifestStoreCapabilities;
  persistence?: 'source-file' | 'runtime-state' | 'external-store' | 'memory' | 'static';
  visibility?: 'safe-summary';
};

type ViewerManifestResourceStore = {
  name: string;
  driver: ViewerManifestDriver;
  effective: boolean;
  writeMode?: 'runtime' | 'source-file' | 'external' | 'readonly' | 'rejected';
  capabilities?: ViewerManifestStoreCapabilities;
};

type ViewerManifestRouteExposureValue = 'open' | 'registered-only' | 'dev' | 'disabled' | false;

type ViewerManifestRouteExposure = {
  rest?: ViewerManifestRouteExposureValue;
  viewer?: ViewerManifestRouteExposureValue;
  schema?: ViewerManifestRouteExposureValue;
  manifest?: ViewerManifestRouteExposureValue;
  graphql?: ViewerManifestRouteExposureValue;
  falcor?: ViewerManifestRouteExposureValue;
  operations?: ViewerManifestRouteExposureValue;
};

type ViewerManifestOperationSummary = {
  enabled: boolean;
  endpoint?: string;
  acceptRefs?: 'name' | 'ref' | 'both';
  contracts?: string[];
  refsAvailable?: boolean;
};

type ViewerManifestAction = {
  available: boolean;
  reason?: string;
};

type ViewerManifestResourceActions = {
  read: ViewerManifestAction;
  create: ViewerManifestAction;
  patch: ViewerManifestAction;
  delete: ViewerManifestAction;
  replace: ViewerManifestAction;
  batch: ViewerManifestAction;
  importCsv: ViewerManifestAction;
  operation: ViewerManifestAction;
  graphql: ViewerManifestAction;
};

type ViewerResourceContext = {
  routeExposure: ViewerManifestRouteExposure;
  operations: ViewerManifestOperationSummary;
};

export async function generateViewerManifest(config: ViewerConfig, options: GenerateViewerManifestOptions = {}) {
  const project = (options.project ?? await loadProjectSchema(config)) as ViewerProject;
  const manifest = renderViewerManifest(project.resources, config, {
    diagnostics: project.diagnostics,
    generatedAt: options.generatedAt,
    routes: options.routes,
  });
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const outFiles = outputFiles(config, options);

  for (const outFile of outFiles) {
    await writeText(outFile, content, dbFileSystem(config));
  }

  return {
    manifest,
    content,
    outFiles,
    diagnostics: project.diagnostics,
  };
}

export function renderViewerManifest(
  resources: ViewerResource[],
  config: ViewerConfig = {},
  options: RenderViewerManifestOptions = {},
) {
  const schemaManifest = renderSchemaManifest(resources as never, config as never) as SchemaManifest;
  const routes = normalizeViewerRoutes(config, options.routes);
  const resourceList = [...resources];
  const restEnabled = config.rest?.enabled !== false;
  const routeExposure = viewerRouteExposure(config, restEnabled);
  const operations = operationSummary(config, routes);
  const stores = storeManifest(config, resourceList);
  const resourceContext = { routeExposure, operations };
  const collections = resourceBucketManifest(schemaManifest.collections, resourceList, routes, config, resourceContext);
  const documents = resourceBucketManifest(schemaManifest.documents, resourceList, routes, config, resourceContext);

  return {
    version: 1,
    kind: 'db.viewerManifest',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    api: {
      viewer: routes.viewerPath,
      manifest: routes.manifestPath,
      manifestJson: routes.manifestJsonPath,
      manifestHtml: routes.manifestHtmlPath,
      manifestMarkdown: routes.manifestMarkdownPath,
      formats: restFormatMetadata(config, routes),
      viewers: viewerLinks(config, routes.viewerPath),
      schema: routes.schemaPath,
      events: routes.eventsPath,
      log: routes.logPath,
      batch: routes.batchPath,
      import: routes.importPath,
      graphql: routes.graphqlPath,
      falcor: routes.falcorPath,
      restBasePath: routes.restBasePath ?? '',
      resourceBasePath: routes.resourceBasePath,
      resources: Object.fromEntries(resourceList.map((resource) => [resource.name, resourceApi(resource, routes)])),
    },
    capabilities: {
      collections: resourceList.some((resource) => resource.kind === 'collection'),
      documents: resourceList.some((resource) => resource.kind === 'document'),
      rest: restEnabled,
      writes: restEnabled,
      restBatch: restEnabled,
      graphql: config.graphql?.enabled !== false,
      falcor: config.falcor?.enabled !== false,
      csvImport: true,
      liveEvents: true,
    },
    stores,
    routeExposure,
    operations,
    collections,
    documents,
    diagnostics: safeDiagnostics(options.diagnostics ?? [], config),
  };
}

function safeDiagnostics(diagnostics: unknown[], config: ViewerConfig): unknown[] {
  const roots = diagnosticRoots(config);
  return diagnostics.map((diagnostic) => safeDiagnosticValue(diagnostic, roots));
}

function diagnosticRoots(config: ViewerConfig): string[] {
  const candidates = [config.cwd];
  if (config.cwd) {
    try {
      candidates.push(resolveFrom(config.cwd, '.'));
    } catch {
      // Ignore invalid cwd values; diagnostics will still be copied without root-relative rewrites.
    }
  }

  return [...new Set(candidates
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => normalizeDiagnosticPath(value))
    .filter((value) => value !== '.' && value !== '/'))]
    .sort((a, b) => b.length - a.length);
}

function safeDiagnosticValue(value: unknown, roots: string[], key = ''): unknown {
  if (typeof value === 'string') {
    return key.toLowerCase().includes('hash') ? '[redacted]' : redactDiagnosticString(value, roots);
  }
  if (Array.isArray(value)) {
    return value.map((item) => safeDiagnosticValue(item, roots));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
    entryKey,
    safeDiagnosticValue(entryValue, roots, entryKey),
  ]));
}

function redactDiagnosticString(value: string, roots: string[]): string {
  let redacted = normalizeDiagnosticPath(value);
  for (const root of roots) {
    redacted = redacted.split(`${root}/`).join('');
    redacted = redacted.split(root).join('.');
  }
  return redacted;
}

function normalizeDiagnosticPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function outputFiles(config: ViewerConfig, options: GenerateViewerManifestOptions): string[] {
  const outFile = options.outFile
    ? resolveFrom(config.cwd ?? '.', options.outFile)
    : config.viewerManifestOutFile;
  return outFile ? [outFile] : [];
}

function resourceBucketManifest(
  bucket: SchemaManifestBucket = {},
  resources: ViewerResource[],
  routes: NormalizedViewerRoutes,
  config: ViewerConfig,
  context: ViewerResourceContext,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(bucket).map(([resourceName, manifest]) => {
    const resource = resources.find((candidate) => candidate.name === resourceName);
    if (!resource) {
      return [resourceName, manifest];
    }

    const store = resourceStoreManifest(resource, config);
    const actions = resourceActions(resource, store, context);
    return [resourceName, {
      ...manifest,
      typeName: resource.typeName,
      routePath: resource.routePath,
      api: resourceApi(resource, routes),
      relations: resource.relations ?? [],
      store,
      actions,
      queryModes: queryModesFor(store, actions),
    }];
  }));
}

function resourceApi(resource: ViewerResource, routes: NormalizedViewerRoutes): Record<string, unknown> {
  const route = joinPaths(routes.restBasePath ?? '', resource.routePath);
  const canonicalRoute = joinPaths(routes.resourceBasePath, resource.routePath);
  if (resource.kind === 'document') {
    return {
      kind: 'document',
      read: route,
      write: route,
      canonical: canonicalRoute,
    };
  }

  return {
    kind: 'collection',
    list: route,
    record: singleIdField(resource) ? `${route}/{${singleIdField(resource)}}` : `${route}/__key`,
    canonicalList: canonicalRoute,
    canonicalRecord: singleIdField(resource) ? `${canonicalRoute}/{${singleIdField(resource)}}` : `${canonicalRoute}/__key`,
    identity: identityFields(resource),
  };
}

function identityFields(resource: ViewerResource): string[] {
  const fields = Array.isArray(resource.identity?.fields)
    ? resource.identity.fields.map(String).filter(Boolean)
    : [];
  return fields.length > 0 ? fields : [String(resource.idField ?? 'id')];
}

function singleIdField(resource: ViewerResource): string | null {
  const fields = identityFields(resource);
  return fields.length === 1 ? fields[0] ?? null : null;
}

function normalizeViewerRoutes(config: ViewerConfig, routes: ViewerRoutes = {}): NormalizedViewerRoutes {
  const apiBase = normalizeBasePath(routes.apiBase ?? config.server?.apiBase ?? '/__db');
  const restBasePath = routes.restBasePath === null
    ? ''
    : normalizeBasePath(routes.restBasePath ?? '');

  return {
    apiBase,
    viewerPath: routes.viewerPath ?? apiBase,
    manifestPath: routes.manifestPath ?? `${apiBase}/manifest`,
    manifestJsonPath: routes.manifestJsonPath ?? `${apiBase}/manifest.json`,
    manifestHtmlPath: routes.manifestHtmlPath ?? `${apiBase}/manifest.html`,
    manifestMarkdownPath: routes.manifestMarkdownPath ?? `${apiBase}/manifest.md`,
    schemaPath: routes.schemaPath ?? `${apiBase}/schema`,
    eventsPath: routes.eventsPath ?? `${apiBase}/events`,
    logPath: routes.logPath ?? `${apiBase}/log`,
    batchPath: routes.batchPath ?? `${apiBase}/batch`,
    importPath: routes.importPath ?? `${apiBase}/import`,
    graphqlPath: routes.graphqlPath ?? config.graphql?.path ?? '/graphql',
    falcorPath: routes.falcorPath ?? config.falcor?.path ?? '/model.json',
    restBasePath,
    resourceBasePath: normalizeBasePath(routes.resourceBasePath ?? '/resources'),
  };
}

function viewerRouteExposure(config: ViewerConfig, restEnabled: boolean): ViewerManifestRouteExposure {
  return {
    rest: restEnabled ? normalizeRouteExposure(config.server?.expose?.rest) : 'disabled',
    viewer: normalizeRouteExposure(config.server?.expose?.viewer),
    schema: normalizeRouteExposure(config.server?.expose?.schema),
    manifest: normalizeRouteExposure(config.server?.expose?.manifest),
    graphql: config.graphql?.enabled === false ? 'disabled' : normalizeRouteExposure(config.server?.expose?.graphql),
    falcor: config.falcor?.enabled === false ? 'disabled' : normalizeRouteExposure(config.server?.expose?.falcor),
    operations: config.operations?.enabled === true ? 'open' : 'disabled',
  };
}

function normalizeRouteExposure(value: unknown): ViewerManifestRouteExposureValue {
  if (value === false) {
    return false;
  }
  if (value === 'open' || value === 'registered-only' || value === 'dev' || value === 'disabled') {
    return value;
  }
  return 'open';
}

function operationSummary(config: ViewerConfig, routes: NormalizedViewerRoutes): ViewerManifestOperationSummary {
  const contracts = Object.keys(config.contracts ?? {}).filter(Boolean).sort();
  return {
    enabled: config.operations?.enabled === true,
    endpoint: joinPaths(routes.apiBase || '', '/operations/{ref}'),
    acceptRefs: normalizeAcceptRefs(config.operations?.acceptRefs),
    ...(contracts.length > 0 ? { contracts } : {}),
    refsAvailable: Boolean(
      config.operations?.refsOutFile
      || config.outputs?.operationRefs
      || hasOperationRegistry(config.operations?.registry)
      || typeof config.operations?.resolveRef === 'function'
    ),
  };
}

function hasOperationRegistry(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

function normalizeAcceptRefs(value: unknown): 'name' | 'ref' | 'both' {
  return value === 'name' || value === 'ref' || value === 'both' ? value : 'both';
}

function storeManifest(config: ViewerConfig, resources: ViewerResource[]): Record<string, ViewerManifestStore> {
  const stores = new Map<string, ViewerManifestStore>();
  for (const storeName of ['json', 'sourceFile', 'memory', 'static']) {
    stores.set(storeName, storeSummary(config, storeName));
  }
  if (config.git?.mirror) {
    stores.set('gitMirror', storeSummary(config, 'gitMirror'));
  }
  for (const storeName of Object.keys(config.stores ?? {}).filter((name) => name !== 'default')) {
    stores.set(storeName, storeSummary(config, storeName));
  }
  const defaultStore = typeof config.stores?.default === 'string' ? config.stores.default : null;
  if (defaultStore) {
    stores.set(defaultStore, storeSummary(config, defaultStore));
  }
  for (const resource of resources) {
    const store = resourceStoreManifest(resource, config);
    stores.set(store.name, {
      name: store.name,
      driver: store.driver,
      capabilities: store.capabilities ?? storeCapabilitiesForDriver(store.driver),
      persistence: persistenceForDriver(store.driver),
      visibility: 'safe-summary',
    });
  }
  return Object.fromEntries([...stores.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function resourceStoreManifest(resource: ViewerResource, config: ViewerConfig): ViewerManifestResourceStore {
  const name = effectiveStoreName(resource, config);
  const driver = storeDriver(config, name);
  const capabilities = storeCapabilities(config, name, driver);
  return {
    name,
    driver,
    effective: true,
    writeMode: resourceWriteMode(resource, config, name, driver, capabilities),
    capabilities,
  };
}

function storeSummary(config: ViewerConfig, storeName: string): ViewerManifestStore {
  const driver = storeDriver(config, storeName);
  return {
    name: storeName,
    driver,
    capabilities: storeCapabilities(config, storeName, driver),
    persistence: persistenceForDriver(driver),
    visibility: 'safe-summary',
  };
}

function effectiveStoreName(resource: ViewerResource, config: ViewerConfig): string {
  const resourceConfig = storeRecord(resourceConfigValue(config.resources, resource.name));
  if (typeof resourceConfig?.store === 'string' && resourceConfig.store.trim()) {
    return resourceConfig.store;
  }
  if (isGitBackedResource(resource)) {
    return gitMirrorStoreName(config);
  }
  return typeof config.stores?.default === 'string' && config.stores.default.trim() ? config.stores.default : 'json';
}

function gitMirrorStoreName(config: ViewerConfig): string {
  const mirror = config.git?.mirror;
  if (!mirror) {
    return typeof config.stores?.default === 'string' ? config.stores.default : 'json';
  }
  if (typeof mirror === 'function' || isCustomStoreRecord(mirror)) {
    return 'gitMirror';
  }
  const record = storeRecord(mirror);
  return String(record?.store ?? record?.driver ?? config.stores?.default ?? 'json');
}

function storeDriver(config: ViewerConfig, storeName: string): ViewerManifestDriver {
  if (storeName === 'gitMirror') {
    return 'gitMirror';
  }
  const configured = config.stores?.[storeName] ?? storeName;
  if (typeof configured === 'string') {
    return driverFamily(configured);
  }
  const record = storeRecord(configured);
  return driverFamily(typeof record?.driver === 'string' ? record.driver : storeName);
}

function driverFamily(value: string): ViewerManifestDriver {
  const normalized = value.replace(/[-_]/g, '').toLowerCase();
  if (normalized === 'json') return 'json';
  if (normalized === 'sourcefile') return 'sourceFile';
  if (normalized === 'sqlite' || normalized === 'nodesqlite' || normalized === 'bettersqlite3') return 'sqlite';
  if (normalized === 'postgres' || normalized === 'postgresql' || normalized === 'pg') return 'postgres';
  if (normalized === 'kv') return 'kv';
  if (normalized === 'redis') return 'redis';
  if (normalized === 'redisjson') return 'redisJson';
  if (normalized === 'memory') return 'memory';
  if (normalized === 'static') return 'static';
  if (normalized === 'gitmirror') return 'gitMirror';
  return 'custom';
}

function storeCapabilities(
  config: ViewerConfig,
  storeName: string,
  driver: ViewerManifestDriver,
): ViewerManifestStoreCapabilities {
  const configured = storeRecord(config.stores?.[storeName]);
  const declared = safeDeclaredCapabilities(configured?.capabilities);
  const defaults = storeCapabilitiesForDriver(driver);
  return {
    ...defaults,
    ...declared,
  };
}

function storeCapabilitiesForDriver(driver: ViewerManifestDriver): ViewerManifestStoreCapabilities {
  if (driver === 'static') {
    return {
      read: true,
      write: false,
      create: false,
      patch: false,
      delete: false,
      batch: false,
      importCsv: false,
      query: false,
      sql: false,
      explain: false,
      transactions: false,
      indexes: false,
    };
  }
  if (driver === 'custom') {
    return {
      read: true,
      write: false,
      create: false,
      patch: false,
      delete: false,
      batch: false,
      importCsv: false,
      query: false,
      sql: false,
      explain: false,
      transactions: false,
      indexes: false,
    };
  }
  return {
    read: true,
    write: true,
    create: true,
    patch: true,
    delete: true,
    batch: true,
    importCsv: true,
    query: false,
    sql: false,
    explain: false,
    transactions: false,
    indexes: false,
  };
}

function safeDeclaredCapabilities(value: unknown): Partial<ViewerManifestStoreCapabilities> {
  const record = storeRecord(value);
  if (!record) {
    return {};
  }
  const aliases: Record<string, keyof ViewerManifestStoreCapabilities> = {
    writable: 'write',
  };
  const output: Partial<ViewerManifestStoreCapabilities> = {};
  for (const key of ['read', 'write', 'create', 'patch', 'delete', 'batch', 'importCsv', 'query', 'sql', 'explain', 'transactions', 'indexes', 'writable']) {
    const mappedKey = aliases[key] ?? key;
    if (typeof record[key] === 'boolean') {
      output[mappedKey as keyof ViewerManifestStoreCapabilities] = record[key] as never;
    }
  }
  return output;
}

function persistenceForDriver(driver: ViewerManifestDriver): ViewerManifestStore['persistence'] {
  if (driver === 'sourceFile') {
    return 'source-file';
  }
  if (driver === 'json') {
    return 'runtime-state';
  }
  if (driver === 'memory') {
    return 'memory';
  }
  if (driver === 'static') {
    return 'static';
  }
  return 'external-store';
}

function resourceWriteMode(
  resource: ViewerResource,
  config: ViewerConfig,
  storeName: string,
  driver: ViewerManifestDriver,
  capabilities: ViewerManifestStoreCapabilities,
): ViewerManifestResourceStore['writeMode'] {
  if (!capabilities.write) {
    return 'readonly';
  }
  if (driver === 'sourceFile') {
    return resource.dataPath && resource.dataFormat === 'json' ? 'source-file' : 'rejected';
  }
  if (driver === 'json' || driver === 'memory') {
    return 'runtime';
  }
  if (driver === 'gitMirror' && gitMirrorWrites(config) !== 'through') {
    return 'readonly';
  }
  void storeName;
  return 'external';
}

function gitMirrorWrites(config: ViewerConfig): string {
  const mirror = config.git?.mirror;
  if (mirror && typeof mirror === 'object' && !Array.isArray(mirror)) {
    const record = mirror as Record<string, unknown>;
    if (typeof record.writes === 'string') {
      return record.writes;
    }
    const nested = storeRecord(record.gitMirror);
    if (typeof nested?.writes === 'string') {
      return nested.writes;
    }
  }
  return 'receipt';
}

function resourceActions(
  resource: ViewerResource,
  store: ViewerManifestResourceStore,
  context: ViewerResourceContext,
): ViewerManifestResourceActions {
  const restReason = unavailableRouteReason(context.routeExposure.rest, 'rest-disabled');
  const graphqlReason = unavailableRouteReason(context.routeExposure.graphql, 'graphql-disabled');
  const operationReason = unavailableRouteReason(context.routeExposure.operations, 'operations-disabled');
  const operationUnavailableReason = operationReason
    ?? (context.operations.refsAvailable ? null : 'operation-refs-unavailable');
  const viewerReason = unavailableRouteReason(context.routeExposure.viewer, 'viewer-disabled');
  const storeWriteReason = store.writeMode === 'rejected'
    ? 'store-rejected'
    : store.writeMode === 'readonly'
      ? 'readonly-store'
      : store.capabilities?.write === false
        ? 'capability-missing'
        : null;

  return {
    read: restReason ? unavailable(restReason) : available(),
    create: resource.kind === 'collection'
      ? actionWhen(!restReason && !storeWriteReason && store.capabilities?.create !== false, restReason ?? storeWriteReason ?? 'capability-missing')
      : unavailable('capability-missing'),
    patch: actionWhen(!restReason && !storeWriteReason && store.capabilities?.patch !== false, restReason ?? storeWriteReason ?? 'capability-missing'),
    delete: resource.kind === 'collection'
      ? actionWhen(!restReason && !storeWriteReason && store.capabilities?.delete !== false, restReason ?? storeWriteReason ?? 'capability-missing')
      : unavailable('capability-missing'),
    replace: actionWhen(!restReason && !storeWriteReason && store.capabilities?.write !== false, restReason ?? storeWriteReason ?? 'capability-missing'),
    batch: actionWhen(!restReason && store.capabilities?.batch !== false, restReason ?? 'capability-missing'),
    importCsv: resource.kind === 'collection'
      ? actionWhen(!viewerReason && !storeWriteReason && store.capabilities?.importCsv !== false, viewerReason ?? storeWriteReason ?? 'capability-missing')
      : unavailable('capability-missing'),
    operation: actionWhen(context.operations.enabled && !operationUnavailableReason, operationUnavailableReason ?? 'operations-disabled'),
    graphql: actionWhen(!graphqlReason, graphqlReason ?? 'graphql-disabled'),
  };
}

function queryModesFor(
  store: ViewerManifestResourceStore,
  actions: ViewerManifestResourceActions,
): string[] {
  const modes = [];
  if (actions.read.available) {
    modes.push('resource');
  }
  if (actions.operation.available) {
    modes.push('operation');
  }
  if (actions.graphql.available) {
    modes.push('graphql');
  }
  if (store.capabilities?.sql === true) {
    modes.push('sql');
  }
  if (store.capabilities?.explain === true) {
    modes.push('explain');
  }
  return modes;
}

function actionWhen(condition: boolean, reason: string): ViewerManifestAction {
  return condition ? available() : unavailable(reason);
}

function available(): ViewerManifestAction {
  return { available: true };
}

function unavailable(reason: string): ViewerManifestAction {
  return { available: false, reason };
}

function unavailableRouteReason(value: ViewerManifestRouteExposureValue | undefined, disabledReason: string): string | null {
  if (value === 'open' || value === 'dev') {
    return null;
  }
  if (value === 'registered-only') {
    return 'registered-only';
  }
  return disabledReason;
}

function isGitBackedResource(resource: ViewerResource): boolean {
  return storeRecord(resource.source)?.kind === 'git-files';
}

function isCustomStoreRecord(value: unknown): boolean {
  const record = storeRecord(value);
  return Boolean(record && (
    typeof record.readResource === 'function'
    || typeof record.read === 'function'
    || typeof record.get === 'function'
  ));
}

function viewerLinks(config: ViewerConfig, viewerPath: string): ViewerLink[] {
  const configuredLinks = Array.isArray(config.server?.viewerLinks)
    ? config.server.viewerLinks
    : [];
  return [
    {
      label: 'Data Viewer',
      href: viewerPath,
      source: 'built-in',
    },
    ...configuredLinks.map(normalizeViewerLink).filter(Boolean),
  ];
}

function normalizeViewerLink(link: unknown): ViewerLink | null {
  if (!isRecord(link)) {
    return null;
  }

  const href = typeof link.href === 'string' ? link.href : link.url;
  if (typeof href !== 'string' || href.trim() === '') {
    return null;
  }

  return {
    label: typeof link.label === 'string' && link.label.trim() ? link.label : 'Custom Viewer',
    href,
    source: 'custom',
  };
}

function joinPaths(basePath: string, routePath: string): string {
  if (!basePath) {
    return routePath;
  }

  const base = `/${String(basePath).replace(/^\/+/, '').replace(/\/+$/, '')}`;
  const route = `/${String(routePath || '/').replace(/^\/+/, '')}`;
  return `${base}${route === '/' ? '' : route}`;
}

function normalizeBasePath(value: unknown): string {
  const pathValue = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return pathValue === '/' ? '' : pathValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function storeRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
