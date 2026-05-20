import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export type DbTypeMap = {
  collections: Record<string, unknown>;
  documents: Record<string, unknown>;
};

export type DbGeneratedTypesOptions = {
  /** Generate TypeScript types during sync. */
  enabled?: boolean;
  /** Gitignored generated type output. Defaults to "./.db/types/index.ts". */
  outFile?: string;
  /** Optional committed copy for app/CI imports. */
  commitOutFile?: string | null;
  /** Emit readonly object properties in generated types. */
  useReadonly?: boolean;
  /** Emit JSDoc from schema field descriptions. */
  emitComments?: boolean;
  /** Export DbCollections, DbDocuments, and DbTypes helpers. */
  exportRuntimeHelpers?: boolean;
};

export type DbSchemaManifestFieldContext = {
  field: Record<string, unknown>;
  fieldName: string;
  resource: Record<string, unknown>;
  resourceName: string;
  path: string;
  file: string | null;
  sourceFile: string | null;
  defaultManifest: Record<string, unknown>;
};

export type DbSchemaManifestResourceContext = {
  resource: Record<string, unknown>;
  resourceName: string;
  file: string | null;
  sourceFile: string | null;
  defaultManifest: Record<string, unknown>;
};

export type DbSchemaManifestOptions = {
  /** Customize generated resource manifest entries. */
  customizeResource?: (context: DbSchemaManifestResourceContext) => Record<string, unknown>;
  /** Customize or omit generated field manifest entries. Return null to omit a field. */
  customizeField?: (context: DbSchemaManifestFieldContext) => Record<string, unknown> | null;
};

export type DbResourceNamingStrategy = 'basename' | 'folder-prefixed' | 'path';

export type DbResourceCustomizeContext = {
  file: string;
  sourceFile: string;
  basename: string;
  folder: string | null;
  folders: string[];
  extension: string;
  defaultName: string;
  defaultResource: {
    name: string;
  };
};

export type DbResourceOptions = {
  /** How fixture paths become resource names. Defaults to "basename". */
  naming?: DbResourceNamingStrategy;
  /** Customize fixture path -> resource identity. */
  customizeResource?: (context: DbResourceCustomizeContext) => { name?: string } | null | undefined;
  /** Per-resource storage settings keyed by normalized resource name. */
  [resourceName: string]: DbResourceNamingStrategy
    | ((context: DbResourceCustomizeContext) => { name?: string } | null | undefined)
    | DbPerResourceOptions
    | undefined;
};

export type DbStoreName = 'json' | 'memory' | 'static' | 'sourceFile' | string;

export type DbStoreOptions = {
  driver?: DbStoreName;
  [key: string]: unknown;
};

export type DbCustomStore = {
  name?: string;
  capabilities?: DbRuntimeCapabilities;
  statePath?: (resource: Record<string, unknown>) => string | undefined;
  hydrate?: (resources: Array<Record<string, unknown>>) => void | Promise<void>;
  readResource?: (resource: Record<string, unknown>, fallback: unknown) => unknown | Promise<unknown>;
  writeResource?: (resource: Record<string, unknown>, value: unknown) => void | Promise<void>;
  read?: (resource: Record<string, unknown>, fallback: unknown) => unknown | Promise<unknown>;
  write?: (resource: Record<string, unknown>, value: unknown) => void | Promise<void>;
  withResourceWrite?: <Result>(
    resource: Record<string, unknown>,
    operation: () => Result | Promise<Result>,
  ) => Result | Promise<Result>;
  close?: () => void | Promise<void>;
};

export type DbCustomStoreFactory =
  (context: { config: DbOptions; resources: unknown[]; storeName: string }) => DbCustomStore;

export type DbStoresOptions = {
  /** Default public store for resources without an explicit store. Defaults to "json". */
  default?: DbStoreName;
  /** Named public store definitions. */
  [storeName: string]: DbStoreName | DbStoreOptions | DbCustomStore | DbCustomStoreFactory | undefined;
};

export type DbRuntimeCapabilities = {
  writable?: boolean;
  persistence?: 'local-file' | 'memory' | 'static' | 'remote' | string;
  atomicity?: 'resource' | 'process' | 'none' | 'request' | string;
  liveEvents?: boolean;
  staticExport?: boolean;
  production?: boolean | 'small-local' | 'small-app' | string;
};

export type DbRuntimeAdapter = {
  name: string;
  capabilities?: DbRuntimeCapabilities;
};

export type DbRuntimeAdapterFactory =
  | DbRuntimeAdapter
  | ((context: { config: DbOptions; resources: unknown[] }) => DbRuntimeAdapter);

export type DbPerResourceOptions = {
  /** Public store name for this resource. Defaults to stores.default. */
  store?: DbStoreName;
  /** Query intent metadata for stores and diagnostics. */
  indexes?: Array<{
    fields: string[];
    name?: string;
    unique?: boolean;
  }>;
};

export type DbRuntimeEvent = {
  version: number;
  timestamp: string;
  resource: string;
  kind: 'collection' | 'document';
  op: string;
  id?: string | number;
  pointer?: string;
};

export type DbRuntimeEvents = {
  readonly version: number;
  subscribe(subscriber: (event: DbRuntimeEvent) => void): () => void;
};

export type DbSourceReaderContext = {
  /** Repo-relative source path, such as "db/users.json". */
  file: string;
  /** Absolute source file path. */
  sourceFile: string;
  filename: string;
  basename: string;
  extension: string;
  folder: string | null;
  folders: string[];
  /** SHA-256 hash of the source file bytes. */
  hash: string;
  config: DbOptions;
  readText(): Promise<string>;
  readBuffer(): Promise<Buffer>;
};

export type DbSourceReaderDataResult = {
  kind: 'data';
  data: unknown;
  /** Format label stored in source metadata. Defaults to the reader name. */
  format?: string;
  /** Explicit resource name. Required when one file returns multiple sources. */
  resourceName?: string;
};

export type DbSourceReaderSchemaResult = {
  kind: 'schema';
  schema: unknown;
  /** Schema source label, such as "jsonc", "mjs", or a custom format. */
  format?: string;
  /** Explicit resource name. Required when one file returns multiple sources. */
  resourceName?: string;
};

export type DbSourceReaderSingleResult = DbSourceReaderDataResult | DbSourceReaderSchemaResult;

export type DbSourceReaderResult =
  | DbSourceReaderSingleResult
  | Array<DbSourceReaderResult>
  | null
  | undefined;

export type DbSourceReader = {
  name: string;
  match(context: DbSourceReaderContext): boolean | Promise<boolean>;
  read(context: DbSourceReaderContext): DbSourceReaderResult | Promise<DbSourceReaderResult>;
};

export type DbSourcesOptions = {
  /** Custom source readers. They run before built-in JSON, JSONC, CSV, and .schema.mjs readers. */
  readers?: DbSourceReader[];
  /** How db handles writes back to source fixtures. Defaults to "preserve". */
  writePolicy?: 'preserve' | 'allow';
};

export type DbRestResourceFormatContext = {
  db: unknown;
  target?: 'resource';
  resource: Record<string, unknown>;
  resourceName: string;
  data: unknown;
  format: string;
  request: IncomingMessage | Record<string, unknown>;
  url: URL;
};

export type DbRestManifestFormatContext = {
  db: unknown;
  target?: 'manifest';
  data: unknown;
  manifest: unknown;
  format: string;
  request: IncomingMessage | Record<string, unknown>;
  url: URL;
  routes?: Record<string, string>;
};

export type DbRestFormatContext = DbRestResourceFormatContext;
export type DbRestAnyFormatContext = DbRestResourceFormatContext | DbRestManifestFormatContext;

export type DbRestFormatResult = string | Buffer | {
  status?: number;
  body?: string | Buffer;
  contentType?: string;
  headers?: Record<string, string>;
};

export type DbRestFormatRenderer = (context: DbRestFormatContext) => DbRestFormatResult | Promise<DbRestFormatResult>;
export type DbRestAnyFormatRenderer = (context: DbRestAnyFormatContext) => DbRestFormatResult | Promise<DbRestFormatResult>;
export type DbRestManifestFormatRenderer = (context: DbRestManifestFormatContext) => DbRestFormatResult | Promise<DbRestFormatResult>;

export type DbRestFormatDefinition = {
  /** Media types used by extensionless Accept negotiation. */
  mediaTypes?: string | string[];
  /** Default response content type when the renderer returns a string or Buffer. */
  contentType?: string;
  /** Generic renderer used for resource and manifest responses unless a target-specific renderer is provided. */
  render?: DbRestAnyFormatRenderer;
  /** Renderer for REST resource routes such as /users.yaml. */
  renderResource?: DbRestFormatRenderer;
  /** Renderer for viewer manifest routes such as /__db/manifest.yaml. */
  renderManifest?: DbRestManifestFormatRenderer;
};

export type DbOptions = {
  /** Project root used to resolve relative config paths. Defaults to process.cwd(). */
  cwd?: string;
  /** Explicit config file path. Defaults to db.config.mjs/js lookup from cwd. */
  configPath?: string;
  /** Fixture source folder. Defaults to "./db". */
  dbDir?: string;
  /** Backwards-compatible fixture source folder alias. If set, it wins over dbDir. */
  sourceDir?: string;
  /** Generated runtime output folder. Defaults to "./.db". */
  stateDir?: string;
  /** Optional committed generated JSON schema manifest for admin/CMS UI generation. */
  schemaOutFile?: string | null;
  /** Optional committed generated JSON viewer manifest for custom data UIs. */
  viewerManifestOutFile?: string | null;
  /** Optional visitor hooks for customizing generated schema manifest output. */
  schemaManifest?: DbSchemaManifestOptions;
  /** Optional source readers for custom schema or data file formats. */
  sources?: DbSourcesOptions;
  /** Run sync automatically when opening the package API. */
  syncOnOpen?: boolean;
  /** Keep valid resources available when one source file has diagnostics. */
  allowSourceErrors?: boolean;
  types?: DbGeneratedTypesOptions;
  schema?: {
    /** Which inputs define schemas. "auto" uses schema files when present and otherwise infers from data. */
    source?: 'auto' | 'data' | 'schema';
    /** Allow JSONC source files. */
    allowJsonc?: boolean;
    /** How schema-backed resources handle fields not declared by schema. */
    unknownFields?: 'allow' | 'warn' | 'error';
    /** Future migration policy for safe additive changes. */
    additiveChanges?: 'auto' | 'manual';
    /** Future migration policy for destructive changes. */
    destructiveChanges?: 'manual';
    /** Future migration policy for field type changes. */
    typeChanges?: 'manual';
  };
  defaults?: {
    /** Apply schema defaults on create through package, REST, and GraphQL writes. */
    applyOnCreate?: boolean;
    /** Apply defaults during safe additive store hydration. */
    applyOnSafeMigration?: boolean;
  };
  seed?: {
    /** Generate mock runtime rows for schema-only resources with empty seed data. */
    generateFromSchema?: boolean;
    /** Number of mock rows to generate when generateFromSchema is true. */
    generatedCount?: number;
  };
  /** Per-collection overrides such as custom id field names. */
  collections?: Record<string, { idField?: string }>;
  /** Resource naming and fixture path identity options. */
  resources?: DbResourceOptions;
  /** Public storage options. Defaults to the JSON store. */
  stores?: DbStoresOptions;
  server?: {
    /** Scoped base for local db dev tools. Defaults to "/__db". */
    apiBase?: string;
    /** App-facing REST data route alias. Defaults to "/db"; set false to disable. */
    dataPath?: string | false;
    /** Local HTTP host. Defaults to "127.0.0.1". */
    host?: string;
    /** Local HTTP port. Defaults to 7331. */
    port?: number;
    /** Maximum JSON request body size in bytes. Defaults to 1048576. */
    maxBodyBytes?: number;
    /** Optional links to custom data viewers shown in discovery and the viewer manifest. */
    viewerLinks?: Array<{
      label?: string;
      href: string;
    }>;
  };
  rest?: {
    /** Enable generated REST routes. */
    enabled?: boolean;
    /** GET response formats by extension. "default" controls extensionless resource routes. */
    formats?: Record<string, DbRestFormatRenderer | DbRestFormatDefinition | string | undefined>;
  };
  graphql?: {
    /** Enable the focused dependency-free GraphQL endpoint. */
    enabled?: boolean;
    /** GraphQL HTTP path. Defaults to "/graphql". */
    path?: string;
  };
  mock?: {
    /** Local response delay in ms, [minMs, maxMs], or an object range. Defaults to [30, 100]. Use 0 to disable. */
    delay?: number | [number, number] | {
      minMs?: number;
      maxMs?: number;
      min?: number;
      max?: number;
    } | null;
    /** Random local error rate or detailed error settings. Defaults to no random errors. */
    errors?: number | {
      rate?: number;
      probability?: number;
      status?: number;
      message?: string;
    } | null;
  };
  /** Named database forks, usually stored under ./db.forks/<name>. */
  forks?: string[] | Record<string, string | {
    /** Fork fixture source folder. Defaults to "./db.forks/<name>". */
    dbDir?: string;
    /** Backwards-compatible source folder alias. If set, it wins over dbDir. */
    sourceDir?: string;
    /** Fork generated runtime output folder. Defaults to "./.db/forks/<name>". */
    stateDir?: string;
    /** Fork-specific generated type output. Committed type output is disabled by default for forks. */
    types?: DbGeneratedTypesOptions;
  }>;
  generate?: {
    hono?: {
      /** Output folder for generated starter code. */
      outDir?: string;
      /** API modules to generate. */
      api?: Array<'rest' | 'graphql'> | 'rest' | 'graphql' | 'rest,graphql' | 'none';
      db?: 'sqlite';
      app?: 'standalone' | 'module';
      runtime?: 'node-sqlite';
      /** Include fixture seed support in generated starter code. */
      seed?: false | 'fixtures';
    };
  };
};

export type DbCollection<RecordType> = {
  all(): Promise<RecordType[]>;
  get(id: string): Promise<RecordType | null>;
  exists(id: string): Promise<boolean>;
  create(record: RecordType): Promise<RecordType>;
  update(id: string, patch: Partial<RecordType>): Promise<RecordType | null>;
  patch(id: string, patch: Partial<RecordType>): Promise<RecordType | null>;
  delete(id: string): Promise<boolean>;
};

export type DbDocument<DocumentType> = {
  all(): Promise<DocumentType>;
  get(): Promise<DocumentType>;
  get(pointer: string): Promise<unknown>;
  put(value: DocumentType): Promise<DocumentType>;
  set(pointer: string, value: unknown): Promise<unknown>;
  update(patch: Partial<DocumentType>): Promise<DocumentType>;
};

export type Db<Types extends DbTypeMap = DbTypeMap> = {
  events: DbRuntimeEvents;
  collection<Name extends keyof Types['collections'] & string>(name: Name): DbCollection<Types['collections'][Name]>;
  document<Name extends keyof Types['documents'] & string>(name: Name): DbDocument<Types['documents'][Name]>;
  resourceNames(): string[];
  close(): Promise<void>;
};

export type GraphqlRequest = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string | null;
};

export type GraphqlError = {
  message: string;
  extensions?: {
    code?: string;
    hint?: string;
    details?: unknown;
  };
};

export type GraphqlResult = {
  data: unknown;
  errors?: GraphqlError[];
};

export type RestBatchRequest = {
  method?: string;
  path: string;
  body?: unknown;
};

export type RestBatchResult = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type DbClientOptions = {
  baseUrl?: string;
  /** Scoped base for default batch and fork paths. Defaults to "/__db". */
  apiBase?: string;
  /** Target a configured database fork, such as "legacy-demo". */
  fork?: string;
  restBasePath?: string;
  graphqlPath?: string;
  restBatchPath?: string;
  batching?: boolean | {
    enabled?: boolean;
    delayMs?: number;
    dedupe?: boolean | 'reads' | 'all';
  };
};

export type DbClientRequestOptions = {
  batch?: boolean;
};

export type DbClient = {
  graphql: {
    (query: string | GraphqlRequest, variables?: Record<string, unknown>, options?: DbClientRequestOptions): Promise<GraphqlResult>;
    request(query: string | GraphqlRequest, variables?: Record<string, unknown>, options?: DbClientRequestOptions): Promise<GraphqlResult>;
    batch(requests: GraphqlRequest[]): Promise<GraphqlResult[]>;
  };
  rest: {
    (method: string | RestBatchRequest, path?: string, body?: unknown, options?: DbClientRequestOptions): Promise<RestBatchResult>;
    request(method: string | RestBatchRequest, path?: string, body?: unknown, options?: DbClientRequestOptions): Promise<RestBatchResult>;
    batch(requests: RestBatchRequest[]): Promise<RestBatchResult[]>;
    get(path: string, options?: DbClientRequestOptions): Promise<RestBatchResult>;
    post(path: string, body?: unknown, options?: DbClientRequestOptions): Promise<RestBatchResult>;
    patch(path: string, body?: unknown, options?: DbClientRequestOptions): Promise<RestBatchResult>;
    put(path: string, body?: unknown, options?: DbClientRequestOptions): Promise<RestBatchResult>;
    delete(path: string, options?: DbClientRequestOptions): Promise<RestBatchResult>;
  };
};

export type DbDoctorSeverity = 'error' | 'warn' | 'info';

export type DbDoctorFinding = {
  code: string;
  severity: DbDoctorSeverity;
  source?: 'schema' | 'doctor' | string;
  resource?: string;
  field?: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
};

export type DbDoctorResult = {
  summary: {
    error: number;
    warn: number;
    info: number;
  };
  findings: DbDoctorFinding[];
};

export type DbRequestHandlerOptions = {
  /** Scoped base for db dev tools. Defaults to "/__db". */
  apiBase?: string;
  /** App-facing REST data route alias. Defaults to configured server.dataPath. */
  dataPath?: string | false;
  /** Serve root REST routes such as "/users". Defaults to true for standalone handlers. */
  rootRoutes?: boolean;
  /** Scoped REST resource base, such as "/__db/rest". */
  restBasePath?: string;
  /** GraphQL endpoint path. Defaults to configured graphql.path or "/graphql". */
  graphqlPath?: string;
};

export type DbRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: () => void,
) => Promise<boolean>;

export type DbServer = {
  server: Server;
  db: Db;
  url: string;
};

export function openDb<Types extends DbTypeMap = DbTypeMap>(options?: DbOptions): Promise<Db<Types>>;
export function createDbClient(options?: DbClientOptions): DbClient;
export function createDbRequestHandler(db: Db, options?: DbRequestHandlerOptions): DbRequestHandler;
export function loadConfig(options?: DbOptions): Promise<DbOptions>;
export function runDbDoctor(config: DbOptions): Promise<DbDoctorResult>;
export function startDbServer(options?: DbOptions & { host?: string; port?: number }): Promise<DbServer>;
export function syncDb(config: DbOptions, options?: { allowErrors?: boolean }): Promise<unknown>;
export function generateTypes(config: DbOptions, options?: { outFile?: string }): Promise<{ content: string; outFiles: string[] }>;
export function generateSchemaManifest(config: DbOptions, options?: { outFile?: string }): Promise<{ manifest: unknown; content: string; outFiles: string[] }>;
export function renderSchemaManifest(resources: unknown[], config?: DbOptions): unknown;
export function generateViewerManifest(config: DbOptions, options?: { outFile?: string }): Promise<{ manifest: unknown; content: string; outFiles: string[] }>;
export function renderViewerManifest(resources: unknown[], config?: DbOptions): unknown;
export function mergeManifest(base: unknown, patch: unknown): unknown;
export function resourceNameFromPath(file: string, options?: { strategy?: DbResourceNamingStrategy }): string;
export function parseFixturePath(file: string): {
  file: string;
  folders: string[];
  folder: string | null;
  filename: string;
  basename: string;
  extension: string;
};
export function generateHonoStarter(
  config: DbOptions,
  options?: {
    outDir?: string;
    api?: Array<'rest' | 'graphql'> | 'rest' | 'graphql' | 'rest,graphql' | 'none';
    db?: 'sqlite';
    app?: 'standalone' | 'module';
    seed?: false | 'fixtures';
    allowWarnings?: boolean;
  },
): Promise<{ outDir: string; files: string[]; diagnostics: unknown[] }>;
export function startDbServer(options?: DbOptions): Promise<{ server: unknown; db: Db; url: string }>;
export function executeGraphql(
  db: Db,
  request: string | GraphqlRequest,
): Promise<GraphqlResult>;
export function executeGraphql(
  db: Db,
  request: GraphqlRequest[],
): Promise<GraphqlResult[]>;
export function executeGraphqlBatch(db: Db, requests: GraphqlRequest[]): Promise<GraphqlResult[]>;
export function parseGraphql(query: string): unknown;
