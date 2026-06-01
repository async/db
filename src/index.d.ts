import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export type DbTypeMap = {
  collections: Record<string, unknown>;
  documents: Record<string, unknown>;
};

export type DbSchemaLoadMode = 'schema' | 'data' | 'runtime';

export type DbSchemaLocator = {
  cwd: string;
  sourceDir: string;
  mode: 'project' | 'source-dir' | 'root-schema' | 'schema-file';
  file: string | null;
  baseDir: string;
  resourceName: string | null;
};

export type DbSchemaValidatorMode = 'create' | 'replace' | 'patch';

export type DbSchemaValidatorUnknownFields = 'error' | 'strip' | 'allow' | 'warn' | 'ignore';

export type DbSchemaValidatorOptions = {
  /** Validation shape. create allows an omitted collection id; patch allows missing required fields. */
  mode?: DbSchemaValidatorMode;
  /** How unknown input fields are handled. Defaults to "error" for schema validators. */
  unknownFields?: DbSchemaValidatorUnknownFields;
  /** Apply schema defaults in create mode. Defaults to true. */
  applyDefaults?: boolean;
  /** Human-readable source label used in diagnostics. */
  source?: string;
};

export type DbSchemaValidationResult<TValue = unknown> = {
  ok: boolean;
  value: TValue;
  diagnostics: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
  resource: string;
  mode: DbSchemaValidatorMode;
};

export type DbSchemaValidator<TValue = Record<string, unknown>> = {
  resource: string;
  mode: DbSchemaValidatorMode;
  unknownFields: Exclude<DbSchemaValidatorUnknownFields, 'ignore'>;
  validate(value: unknown, options?: DbSchemaValidatorOptions): DbSchemaValidationResult<TValue>;
  validateAsync(value: unknown, options?: DbSchemaValidatorOptions): Promise<DbSchemaValidationResult<TValue>>;
  assert(value: unknown, options?: DbSchemaValidatorOptions): TValue;
  assertAsync(value: unknown, options?: DbSchemaValidatorOptions): Promise<TValue>;
};

export type DbSchemaResolverContext = Record<string, unknown> | Map<string, unknown>;

export type DbSchemaResolverOptions = {
  /** User-provided values exposed on resolver this. These override internal values with the same key. */
  context?: DbSchemaResolverContext;
  /** Shared cache exposed as this.cache and this.get("cache"). */
  cache?: Map<string, unknown>;
  /** Optional value exposed as this.value when no call-time record/value is provided. */
  value?: unknown;
  /** Optional db-like object exposed to resolver this. Runtime REST/GraphQL pass the live db. */
  db?: unknown;
  /** Optional service map exposed as this.services and individual this.get(name) entries. */
  services?: Record<string, unknown>;
};

export type DbSchemaFieldResolver<TArgs = Record<string, unknown>, TValue = unknown> = ((args?: TArgs) => Promise<TValue>) & {
  resolve?: (args?: TArgs) => Promise<TValue>;
  resolveMany?: (args?: { records?: unknown[]; [key: string]: unknown } | unknown[]) => Promise<unknown>;
};

export type DbLoadedSchema = {
  kind: 'DbSchema';
  config: DbOptions;
  loadMode: DbSchemaLoadMode;
  locator: DbSchemaLocator | null;
  rootSchema?: unknown;
  resources: Map<string, Record<string, unknown>>;
  diagnostics: Array<Record<string, unknown>>;
  schema: Record<string, unknown>;
  resource(name: string): Record<string, unknown>;
  resourceNames(): string[];
  validator<TValue = Record<string, unknown>>(name: string, options?: DbSchemaValidatorOptions): DbSchemaValidator<TValue>;
  resolver<TArgs = Record<string, unknown>, TValue = unknown>(
    selector: string,
    options?: DbSchemaResolverOptions,
  ): DbSchemaFieldResolver<TArgs, TValue> | Record<string, DbSchemaFieldResolver<TArgs, TValue>>;
  validate<TValue = Record<string, unknown>>(name: string, value: unknown, options?: DbSchemaValidatorOptions): DbSchemaValidationResult<TValue>;
  validateAsync<TValue = Record<string, unknown>>(name: string, value: unknown, options?: DbSchemaValidatorOptions): Promise<DbSchemaValidationResult<TValue>>;
  assert<TValue = Record<string, unknown>>(name: string, value: unknown, options?: DbSchemaValidatorOptions): TValue;
  assertAsync<TValue = Record<string, unknown>>(name: string, value: unknown, options?: DbSchemaValidatorOptions): Promise<TValue>;
  toJSON(): Record<string, unknown>;
};

export type DbGeneratedTypesOptions = {
  /** Generate TypeScript types during sync. */
  enabled?: boolean;
  /** Backwards-compatible alias for outputs.types. Defaults to "./.db/types/index.d.ts". */
  outFile?: string | null;
  /** Backwards-compatible alias for outputs.committedTypes. */
  commitOutFile?: string | null;
  /** Emit readonly object properties in generated types. */
  useReadonly?: boolean;
  /** Emit JSDoc from schema field descriptions. */
  emitComments?: boolean;
  /** Export DbCollections, DbDocuments, and DbTypes helpers. */
  exportRuntimeHelpers?: boolean;
};

export type DbOutputOptions = {
  /** Generated runtime output folder. Defaults to "./.db". */
  stateDir?: string;
  /** Gitignored generated TypeScript type output. Defaults to "./.db/types/index.d.ts". */
  types?: string | null;
  /** Optional committed TypeScript type copy for app/CI imports. */
  committedTypes?: string | null;
  /** Optional committed generated JSON schema manifest for admin/CMS UI generation. */
  schemaManifest?: string | null;
  /** Optional committed generated JSON viewer manifest for custom data UIs. */
  viewerManifest?: string | null;
  /** Optional full registered operation registry output path. */
  operationRegistry?: string | null;
  /** Optional client-safe registered operation refs output path. */
  operationRefs?: string | null;
  /** Output folder for generated Hono starter code. Defaults to "./db-api". */
  honoStarterDir?: string;
};

export type DbForkOutputOptions = Pick<DbOutputOptions, 'stateDir' | 'types' | 'committedTypes'>;

export type DbTemplateOptions = string | {
  /** Template fixture source folder. Defaults to "./db.forks/<name>" for compatibility; set dbDir for new "./db.templates" layouts. */
  dbDir?: string;
  /** Backwards-compatible source folder alias. If set, it wins over dbDir. */
  sourceDir?: string;
  /** Template output aliases for state and generated type files. */
  outputs?: DbForkOutputOptions;
  /** Backwards-compatible alias for outputs.stateDir. Defaults to "./.db/forks/<name>". */
  stateDir?: string;
  /** Template-specific generated type options. Output paths are aliases for outputs.types and outputs.committedTypes. */
  types?: DbGeneratedTypesOptions;
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
  get?: (resource: Record<string, unknown>, fallback: unknown) => unknown | Promise<unknown>;
  set?: (resource: Record<string, unknown>, value: unknown) => void | Promise<void>;
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

export type DbDoctorOptions = {
  /** Include production-readiness diagnostics for JSON-backed resources. */
  production?: boolean;
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

export type DbResourceChangeEvent = {
  version: number;
  timestamp: string;
  resource: string;
  kind: 'collection' | 'document';
  op: string;
  id?: string | number;
  pointer?: string;
};

export type DbRequestTracePhase = {
  name: string;
  durationMs: number;
  [key: string]: unknown;
};

export type DbRequestTraceEvent = {
  version: number;
  timestamp: string;
  type: 'request-trace';
  requestId: string;
  method: string;
  pathname: string;
  queryKeys: string[];
  route?: string;
  resource?: string;
  operation?: string;
  id?: string | number;
  status?: number | null;
  handled: boolean;
  durationMs: number;
  slow: boolean;
  hook?: string;
  shortCircuit?: boolean;
  phases?: DbRequestTracePhase[];
  error?: {
    code?: string;
    message: string;
  };
};

export type DbRuntimeEvent = DbResourceChangeEvent | DbRequestTraceEvent;

export type DbRuntimeEvents = {
  readonly version: number;
  subscribe(subscriber: (event: DbRuntimeEvent) => void): () => void;
};

export type DbRouteExposure = 'open' | 'registered-only' | 'dev' | 'disabled' | false;

export type DbTraceConfig = {
  /** Enable tracing. Object form defaults to enabled unless set to false. */
  enabled?: boolean;
  /** Mark traces slow at or above this duration in ms. Defaults to 0. */
  slowMs?: number;
  /** Print concise request summaries to the console. Defaults to true when tracing is enabled. */
  console?: boolean;
  /** Emit request trace events through db.events for /__db/log. Defaults to true when tracing is enabled. */
  events?: boolean;
  /** Response header used for the request id. Defaults to "x-async-db-request-id". */
  header?: string;
};

export type DbTraceOptions = boolean | DbTraceConfig;

export type DbRestOperationTemplate = {
  name?: string;
  /** Callable operation identifier. Defaults to hashOperation(template) when omitted. */
  ref?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | string;
  path: string;
  query?: string | Record<string, unknown>;
  body?: unknown;
  variables?: Record<string, unknown>;
};

export type DbGraphqlOperationTemplate = {
  name?: string;
  /** Callable operation identifier. Defaults to hashOperation(template) when omitted. */
  ref?: string;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string | null;
};

export type DbOperationTemplate = string | DbRestOperationTemplate | DbGraphqlOperationTemplate;

export type DbOperationRef = {
  name?: string;
  /** Callable ref for client query(). */
  ref: string;
};

export type DbRegisteredOperation = Exclude<DbOperationTemplate, string> & {
  ref?: string;
};

export type DbOperationRegistryValue = DbOperationTemplate | DbRegisteredOperation;

export type DbOperationAcceptRefs = 'ref' | 'name' | 'both';

export type DbOperationRefContext = {
  ref: string;
  decodedRef: string;
  acceptRefs: DbOperationAcceptRefs;
  registry: Record<string, DbRegisteredOperation>;
  operation: DbRegisteredOperation | null;
};

export type DbOperationResolveRef = (
  ref: string,
  context: Omit<DbOperationRefContext, 'operation'>,
) => DbOperationRegistryValue | null | undefined | Promise<DbOperationRegistryValue | null | undefined>;

export type DbOperationValidateRef = (
  context: DbOperationRefContext,
) => boolean | null | undefined | DbOperationRegistryValue | Promise<boolean | null | undefined | DbOperationRegistryValue>;

export type DbOperationsOptions = {
  /** Enable registered operation execution. Defaults to false. */
  enabled?: boolean;
  /** Folder containing operation source templates. Defaults to "./db/operations". */
  sourceDir?: string;
  /** Backwards-compatible alias for outputs.operationRegistry. */
  outFile?: string | null;
  /** Backwards-compatible alias for outputs.operationRefs. */
  refsOutFile?: string | null;
  /** Controls which default refs the server accepts. Defaults to "both". */
  acceptRefs?: DbOperationAcceptRefs;
  /** Custom server-side operation lookup for framework adapters or app registries. */
  resolveRef?: DbOperationResolveRef;
  /** Custom server-side validation or mapping for operation refs. */
  validateRef?: DbOperationValidateRef;
  /** Inline server registry keyed by operation ref or operation name. */
  registry?: Record<string, DbOperationRegistryValue>;
};

export type DbOperationResult = {
  kind: 'rest' | 'graphql';
  status: number;
  headers: Record<string, string>;
  body: unknown;
  rawBody?: string;
};

export type DbOperationRequestBody = {
  variables?: Record<string, unknown>;
};

export type DbOperationHandler = {
  enabled: boolean;
  resolve(ref: string): Promise<DbRegisteredOperation | null | undefined>;
  execute(ref: string, variables?: Record<string, unknown>): Promise<DbOperationResult>;
  executeRequest(ref: string, body?: DbOperationRequestBody | null): Promise<DbOperationResult>;
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
  /** Custom source readers. They run before built-in JSON, JSONC, CSV, and executable schema readers. */
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

export type DbSchemaConfig = {
  /** Which inputs define schemas. "auto" uses schema files when present and otherwise infers from data. */
  source?: 'auto' | 'data' | 'schema';
  /** Allow JSONC source files. */
  allowJsonc?: boolean;
  /** Create db/package.json with "type": "module" for .schema.js files when the project root is not already ESM. */
  autoModulePackageJson?: boolean;
  /** Prefer Standard Schema-first generated .schema.mjs output for resources with validators. */
  standardSchema?: boolean;
  /** How schema-backed resources handle fields not declared by schema. */
  unknownFields?: 'allow' | 'warn' | 'error';
  /** Future migration policy for safe additive changes. */
  additiveChanges?: 'auto' | 'manual';
  /** Future migration policy for destructive changes. */
  destructiveChanges?: 'manual';
  /** Future migration policy for field type changes. */
  typeChanges?: 'manual';
};

export type DbOptions = {
  /** Project root used to resolve relative config paths. Defaults to process.cwd(). */
  cwd?: string;
  /** Package API locator for a project root, db folder, root schema file, or individual schema file. */
  from?: string;
  /** Schema loading mode. Defaults to "data" for current low-level loaders and "runtime" for openDb. */
  load?: DbSchemaLoadMode;
  /** Explicit config file path. Defaults to db.config.mjs/js lookup from cwd. */
  configPath?: string;
  /** Fixture source folder. Defaults to "./db". */
  dbDir?: string;
  /** Backwards-compatible fixture source folder alias. If set, it wins over dbDir. */
  sourceDir?: string;
  /** Backwards-compatible alias for outputs.stateDir. */
  stateDir?: string;
  /** Preferred generated output locations for state, types, manifests, operations, and generated starter code. */
  outputs?: DbOutputOptions;
  /** Backwards-compatible alias for outputs.schemaManifest. */
  schemaOutFile?: string | null;
  /** Backwards-compatible alias for outputs.viewerManifest. */
  viewerManifestOutFile?: string | null;
  /** Optional visitor hooks for customizing generated schema manifest output. */
  schemaManifest?: DbSchemaManifestOptions;
  /** Optional source readers for custom schema or data file formats. */
  sources?: DbSourcesOptions;
  /** Values made available to computed field resolvers through this.services and this.get(name). */
  services?: Record<string, unknown>;
  /** Run sync automatically when opening the package API. */
  syncOnOpen?: boolean;
  /** Keep valid resources available when one source file has diagnostics. */
  allowSourceErrors?: boolean;
  types?: DbGeneratedTypesOptions;
  /** Schema and validation config. */
  schema?: DbSchemaConfig;
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
  /** Doctor and check command options. */
  doctor?: DbDoctorOptions;
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
    /** Opt-in request tracing and timing for handled db HTTP requests. */
    trace?: DbTraceOptions;
    /** Optional links to custom data viewers shown in discovery and the viewer manifest. */
    viewerLinks?: Array<{
      label?: string;
      href: string;
    }>;
    /** Route exposure policy for hardened local/prod-like servers. */
    expose?: {
      rest?: DbRouteExposure;
      graphql?: DbRouteExposure;
      viewer?: DbRouteExposure;
      schema?: DbRouteExposure;
      manifest?: DbRouteExposure;
    };
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
  /** Optional registered REST operation settings. */
  operations?: DbOperationsOptions;
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
  /** Fixture templates for alternate fixture shapes served by dev/client fork routes. */
  templates?: string[] | Record<string, DbTemplateOptions | true | null | undefined>;
  /** Backwards-compatible alias for templates. Prefer templates so config does not collide with runtime db.fork(). */
  forks?: string[] | Record<string, DbTemplateOptions | true | null | undefined>;
  generate?: {
    hono?: {
      /** Backwards-compatible alias for outputs.honoStarterDir. */
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

export type DbOpenOptions = Omit<DbOptions, 'schema'> & {
  /** Schema config, or a loaded schema object returned by loadDbSchema(). */
  schema?: DbSchemaConfig | DbLoadedSchema;
};

export type DbCollection<RecordType> = {
  all(): Promise<RecordType[]>;
  get(id: string): Promise<RecordType | null>;
  exists(id: string): Promise<boolean>;
  create(record: RecordType): Promise<RecordType>;
  update(id: string, patch: Partial<RecordType>): Promise<RecordType | null>;
  patch(id: string, patch: Partial<RecordType>): Promise<RecordType | null>;
  delete(id: string): Promise<boolean>;
  replaceAll(records: RecordType[]): Promise<RecordType[]>;
};

export type DbDocument<DocumentType> = {
  all(): Promise<DocumentType>;
  get(): Promise<DocumentType>;
  get(pointer: string): Promise<unknown>;
  put(value: DocumentType): Promise<DocumentType>;
  set(pointer: string, value: unknown): Promise<unknown>;
  update(patch: Partial<DocumentType>): Promise<DocumentType>;
};

export type DbForkCreateOptions = {
  from?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
};

export type DbBranchCreateOptions = {
  from?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
};

export type DbSnapshotCreateOptions = {
  label?: string;
  resources?: string[];
};

export type DbSnapshotRestoreOptions = {
  resources?: string[];
};

export type DbSnapshotResult = {
  id: string;
  label?: string;
  fork: string | null;
  branch: string;
  resources: string[];
  path: string;
};

export type DbMigrationStartOptions = {
  resources: string[];
  mode?: 'read-only';
};

export type DbMigrationLock = {
  name: string;
  resources: string[];
  mode: 'read-only';
  startedAt: string;
};

export type DbMigrationVerifyOptions = {
  resources: string[];
  checks?: Array<'count' | 'schema' | 'checksum'>;
};

export type DbResourceMigrateOptions = {
  from: string;
  to: string;
};

export type DbResourceRegistry = Map<string, unknown> & {
  migrate(resource: string, options: DbResourceMigrateOptions): Promise<void>;
};

export type Db<Types extends DbTypeMap = DbTypeMap> = {
  events: DbRuntimeEvents;
  resources: DbResourceRegistry;
  forks: {
    create(name: string, options?: DbForkCreateOptions): Promise<Db<Types>>;
    list(): Promise<Array<Record<string, unknown>>>;
    delete(name: string): Promise<boolean>;
  };
  branches: {
    create(name: string, options?: DbBranchCreateOptions): Promise<Db<Types>>;
  };
  snapshots: {
    create(options?: DbSnapshotCreateOptions): Promise<DbSnapshotResult>;
    restore(id: string, options?: DbSnapshotRestoreOptions): Promise<void>;
  };
  migrations: {
    start(name: string, options: DbMigrationStartOptions): Promise<DbMigrationLock>;
    verify(name: string, options: DbMigrationVerifyOptions): Promise<void>;
    finish(name: string): Promise<void>;
  };
  routing: {
    set(routes: Record<string, string>): Promise<Record<string, string>>;
  };
  fork(name: string): Db<Types>;
  branch(name: string): Db<Types>;
  collection<Name extends keyof Types['collections'] & string>(name: Name): DbCollection<Types['collections'][Name]>;
  document<Name extends keyof Types['documents'] & string>(name: Name): DbDocument<Types['documents'][Name]>;
  operation(ref: string, variables?: Record<string, unknown>): Promise<unknown>;
  query(ref: string, variables?: Record<string, unknown>): Promise<unknown>;
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

export type DbCacheReadPolicy = 'cache-first' | 'cache-and-network' | 'network-first' | 'network-only' | 'cache-only';
export type DbCacheWritePolicy = 'merge-and-invalidate' | 'invalidate' | 'refetch';
export type DbCacheEventPolicy = 'invalidate' | 'refetch' | false;

export type DbCacheStorageContext = {
  baseNamespace: string;
  namespace: string;
  manifestFingerprint: string | null;
};

export type DbCacheStorage = {
  load?(context?: DbCacheStorageContext): unknown | Promise<unknown>;
  save?(snapshot: unknown, context?: DbCacheStorageContext): void | Promise<void>;
  clear?(context?: DbCacheStorageContext): void | Promise<void>;
};

export type DbCacheSnapshotQuery = {
  key: string;
  value: unknown;
  stale: boolean;
  resources: string[];
  lists: string[];
};

export type DbClientCacheOptions = boolean | {
  enabled?: boolean;
  storage?: 'memory' | DbCacheStorage;
  readPolicy?: DbCacheReadPolicy;
  writePolicy?: DbCacheWritePolicy;
  eventPolicy?: DbCacheEventPolicy;
  /** Preloaded viewer manifest. When omitted, the client fetches <apiBase>/manifest.json on first cache use. */
  manifest?: unknown;
};

export type DbClientCacheRequestOptions = false | DbCacheReadPolicy | {
  readPolicy?: DbCacheReadPolicy;
};

export type DbCacheWatchRequest =
  | {
    kind?: 'rest';
    method?: string;
    path: string;
  }
  | ({
    kind: 'graphql';
  } & GraphqlRequest);

export type DbCacheSnapshot = {
  data: unknown;
  stale: boolean;
  source: 'cache' | string;
};

export type DbClientCache = {
  readonly enabled: boolean;
  clear(): void;
  invalidate(resourceName?: string): void;
  snapshot(): {
    namespace?: string;
    manifestFingerprint?: string | null;
    manifest: unknown;
    queries: DbCacheSnapshotQuery[];
    resources: Record<string, Record<string, unknown>>;
    entities?: Record<string, Record<string, unknown>>;
  };
  watch(request: DbCacheWatchRequest, subscriber: (snapshot: DbCacheSnapshot) => void): () => void;
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
  manifestPath?: string;
  cache?: DbClientCacheOptions;
  batching?: boolean | {
    enabled?: boolean;
    delayMs?: number;
    dedupe?: boolean | 'reads' | 'all';
  };
};

export type DbClientRequestOptions = {
  batch?: boolean;
  cache?: DbClientCacheRequestOptions;
};

export type DbClient = {
  cache: DbClientCache;
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
  operation(
    operation: DbOperationTemplate | DbOperationRef,
    variables?: Record<string, unknown>,
    options?: DbClientRequestOptions,
  ): Promise<unknown>;
  query(
    operation: DbOperationTemplate | DbOperationRef,
    variables?: Record<string, unknown>,
    options?: DbClientRequestOptions,
  ): Promise<unknown>;
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
  /** Explicit request trace option. Wins over db.config.mjs server.trace. */
  trace?: DbTraceOptions;
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

export function openDb<Types extends DbTypeMap = DbTypeMap>(options?: DbOpenOptions | string): Promise<Db<Types>>;
export function createDbClient(options?: DbClientOptions): DbClient;
export function createIndexedDbCacheStorage(options?: {
  name?: string;
  storeName?: string;
  key?: string;
  indexedDB?: unknown;
}): DbCacheStorage;
export function createDbRequestHandler(db: Db, options?: DbRequestHandlerOptions): DbRequestHandler;
export function createDbOperationHandler(db: Db, options?: DbOperationsOptions | { operations?: boolean | 'auto' | DbOperationsOptions }): DbOperationHandler;
export function loadConfig(options?: DbOptions): Promise<DbOptions>;
export function loadDbSchema(options?: DbOptions | string): Promise<DbLoadedSchema>;
export function createDbSchema(project: unknown, config: DbOptions): DbLoadedSchema;
export function createSchemaValidator<TValue = Record<string, unknown>>(
  resource: Record<string, unknown>,
  config: DbOptions,
  options?: DbSchemaValidatorOptions,
): DbSchemaValidator<TValue>;
export function resolveSchemaLocator(options?: DbOptions | string): Promise<DbSchemaLocator>;
export function normalizeSchemaLoadMode(value?: unknown): DbSchemaLoadMode;
export function loadProjectSchema(config: DbOptions, options?: { load?: DbSchemaLoadMode }): Promise<unknown>;
export function runDbDoctor(config: DbOptions): Promise<DbDoctorResult>;
export function startDbServer(options?: DbOpenOptions & { host?: string; port?: number }): Promise<DbServer>;
export function syncDb(config: DbOptions, options?: { allowErrors?: boolean }): Promise<unknown>;
export function generateTypes(config: DbOptions, options?: { outFile?: string }): Promise<{ content: string; outFiles: string[] }>;
export function generateSchemaManifest(config: DbOptions, options?: { outFile?: string }): Promise<{ manifest: unknown; content: string; outFiles: string[] }>;
export function renderSchemaManifest(resources: unknown[], config?: DbOptions): unknown;
export function generateViewerManifest(config: DbOptions, options?: { outFile?: string }): Promise<{ manifest: unknown; content: string; outFiles: string[] }>;
export function renderViewerManifest(resources: unknown[], config?: DbOptions): unknown;
export function hashOperation(operation: DbOperationTemplate): string;
export function buildOperationManifest(
  config: DbOptions,
  options?: {
    outFile?: string;
    refsOutFile?: string;
    generatedAt?: string;
    operations?: DbOperationTemplate[];
  },
): Promise<{
  manifest: unknown;
  refs: unknown;
  outFiles: string[];
  refsOutFiles: string[];
}>;
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
