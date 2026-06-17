import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export type DbTypeMap = {
  collections: Record<string, unknown>;
  documents: Record<string, unknown>;
  collectionKeys?: Record<string, unknown>;
};

export type DbFileSystemDirent = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

export type DbFileSystemStats = {
  isDirectory(): boolean;
  isFile(): boolean;
};

export type DbFileSystem = {
  readFile(filePath: string, encoding?: BufferEncoding | null): Promise<Buffer | string>;
  readFileSync(filePath: string, encoding?: BufferEncoding | null): Buffer | string;
  writeFile(filePath: string, data: string | Buffer | Uint8Array, encoding?: BufferEncoding): Promise<void>;
  mkdir(filePath: string, options?: { recursive?: boolean }): Promise<unknown>;
  readdir(filePath: string, options?: { withFileTypes?: false }): Promise<string[]>;
  readdir(filePath: string, options: { withFileTypes: true }): Promise<DbFileSystemDirent[]>;
  stat(filePath: string): Promise<DbFileSystemStats>;
  access(filePath: string): Promise<void>;
  rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
};

export type DbMemoryFileSystemOptions = {
  cwd?: string;
  files?: Record<string, string | Buffer | Uint8Array>;
};

export function createMemoryFs(options?: DbMemoryFileSystemOptions | Record<string, string | Buffer | Uint8Array>): DbFileSystem;

export type DbIntegrationRecommendationKind =
  | 'direct-resource'
  | 'read-model'
  | 'custom-store'
  | 'app-owned-sql'
  | 'manual-review';

export type DbIntegrationConfidence = 'high' | 'medium' | 'low';

export type DbSqliteIntegrationAdoptionPathKind =
  | 'operation-wrapper'
  | 'read-model'
  | 'table-backed-adapter'
  | 'app-owned-sql';

export type DbSqliteIntegrationSuggestionCode =
  | 'INTEGRATE_KEEP_EXISTING_SQLITE_SOURCE'
  | 'INTEGRATE_WRAP_EXISTING_DB_FACADE'
  | 'INTEGRATE_USE_SQLITE_COMPAT_DRIVER'
  | 'INTEGRATE_IMPORT_TO_ASYNC_DB_STATE'
  | 'INTEGRATE_COMPOUND_KEY_USE_OPERATIONS'
  | 'INTEGRATE_APPEND_ONLY_EVENT_LOG'
  | 'INTEGRATE_QUERY_AGGREGATION_API'
  | 'INTEGRATE_READ_MODEL_FIRST'
  | 'INTEGRATE_SIMPLE_TABLE_ADAPTER_CANDIDATE'
  | 'INTEGRATE_ORM_MANUAL_REVIEW';

export type DbSqliteIntegrationDriver = 'node:sqlite' | 'better-sqlite3' | 'sqlite3' | 'sqlite';

export type DbSqliteIntegrationAdoptionPath = {
  kind: DbSqliteIntegrationAdoptionPathKind;
  sourceOfTruth: 'existing-sqlite';
  asyncDbSurface: 'operations' | 'read-model' | 'table-adapter' | 'app-owned-sql';
  storageMigration: 'not-recommended' | 'optional-later';
  reason: string;
};

export type DbSqliteIntegrationSuggestion = {
  code: DbSqliteIntegrationSuggestionCode;
  severity: 'info' | 'warning';
  table: string | null;
  message: string;
  hint: string;
  details: Record<string, unknown>;
};

export type DbSqliteIntegrationImportKeyStrategy =
  | { kind: 'single-primary-key'; field: string }
  | { kind: 'compound-object-key'; fields: string[] }
  | { kind: 'compound-generated-id'; fields: string[]; idField: string }
  | { kind: 'key-value-document'; keyField: string; valueField: string }
  | { kind: 'append-only'; idField?: string };

export type DbSqliteIntegrationImportResource = {
  resource: string;
  table: string;
  kind: 'collection' | 'document';
  importKind: 'collection' | 'document' | 'append-only';
  primaryKey: string[];
  idField?: string;
  identity?: {
    fields: string[];
  };
  writePolicy?: 'append-only';
  fields: Record<string, {
    type: string;
    required?: boolean;
  }>;
  columns: Record<string, string>;
  keyStrategy: DbSqliteIntegrationImportKeyStrategy;
  warnings: string[];
};

export type DbSqliteIntegrationImportPlan = {
  version: 1;
  kind: 'sqlite.importPlan';
  source: {
    sqliteFile: string;
    driver: DbSqliteIntegrationDriver | null;
  };
  target: {
    stateFile: string;
  };
  resources: DbSqliteIntegrationImportResource[];
  warnings: string[];
};

export type DbSqliteIntegrationReport = {
  version: 1;
  kind: 'db.integrationReport';
  generatedAt: string;
  target: {
    path: string;
    kind: 'file' | 'directory';
  };
  sqlite: {
    path: string;
    drivers: {
      detected: DbSqliteIntegrationDriver[];
      recommended: DbSqliteIntegrationDriver | null;
      ormDetected: string[];
    };
    tables: Array<{
      name: string;
      type: string;
      columns: Array<{
        name: string;
        type: string;
        notNull: boolean;
        defaultValue: string | null;
        primaryKeyPosition: number;
      }>;
      primaryKey: string[];
      indexes: Array<{
        name: string;
        unique: boolean;
        origin: string;
        columns: string[];
      }>;
      foreignKeys: Array<{
        table: string;
        from: string;
        to: string;
        onUpdate: string;
        onDelete: string;
      }>;
      rowCount: number | null;
      classification: string;
    }>;
  };
  source: {
    filesScanned: number;
    filesWithMatches: number;
    matches: Array<{
      kind: string;
      file: string;
      line: number;
      snippet: string;
      confidence: DbIntegrationConfidence;
    }>;
  };
  recommendations: Array<{
    kind: DbIntegrationRecommendationKind;
    table: string | null;
    confidence: DbIntegrationConfidence;
    message: string;
    nextStep: string;
    adoptionPath?: DbSqliteIntegrationAdoptionPath;
    details: Record<string, unknown>;
  }>;
  suggestions: DbSqliteIntegrationSuggestion[];
  importPlan?: DbSqliteIntegrationImportPlan;
  suggestedFiles: Array<{
    path: string;
    purpose: string;
  }>;
  agentInstructions: string[];
};

export type DbInspectSqliteIntegrationOptions = {
  cwd?: string;
  target?: string;
  sqliteFile: string;
  targetState?: string;
  generatedAt?: string;
  ignorePaths?: string[];
};

export function inspectSqliteIntegration(options: DbInspectSqliteIntegrationOptions): Promise<DbSqliteIntegrationReport>;

export type DbPostgresIntegrationAdoptionPathKind =
  | 'operation-wrapper'
  | 'read-model'
  | 'table-backed-adapter'
  | 'app-owned-sql';

export type DbPostgresIntegrationSuggestionCode =
  | 'INTEGRATE_KEEP_EXISTING_POSTGRES_SOURCE'
  | 'INTEGRATE_WRAP_EXISTING_POSTGRES_FACADE'
  | 'INTEGRATE_USE_POSTGRES_COMPAT_DRIVER'
  | 'INTEGRATE_IMPORT_TO_ASYNC_DB_STATE'
  | 'INTEGRATE_IMPORT_TO_POSTGRES_STORE'
  | 'INTEGRATE_POSTGRES_OBJECT_KEY_OPERATIONS'
  | 'INTEGRATE_POSTGRES_APPEND_ONLY_EVENT_LOG'
  | 'INTEGRATE_POSTGRES_QUERY_AGGREGATION_API'
  | 'INTEGRATE_POSTGRES_READ_MODEL_FIRST'
  | 'INTEGRATE_POSTGRES_TABLE_ADAPTER_CANDIDATE'
  | 'INTEGRATE_POSTGRES_ORM_MANUAL_REVIEW'
  | 'INTEGRATE_POSTGRES_CATALOG_PARTIAL';

export type DbPostgresIntegrationDriver =
  | 'pg'
  | 'postgres'
  | '@neondatabase/serverless'
  | '@vercel/postgres'
  | 'pg-promise';

export type DbPostgresIntegrationAdoptionPath = {
  kind: DbPostgresIntegrationAdoptionPathKind;
  sourceOfTruth: 'existing-postgres';
  asyncDbSurface: 'operations' | 'read-model' | 'table-adapter' | 'app-owned-sql';
  storageMigration: 'not-recommended' | 'optional-later';
  reason: string;
};

export type DbPostgresIntegrationSuggestion = {
  code: DbPostgresIntegrationSuggestionCode;
  severity: 'info' | 'warning';
  table: string | null;
  message: string;
  hint: string;
  details: Record<string, unknown>;
};

export type DbPostgresIntegrationImportKeyStrategy =
  | { kind: 'single-primary-key'; field: string }
  | { kind: 'compound-object-key'; fields: string[] }
  | { kind: 'compound-generated-id'; fields: string[]; idField: string }
  | { kind: 'key-value-document'; keyField: string; valueField: string }
  | { kind: 'append-only'; idField?: string };

export type DbPostgresIntegrationImportResource = {
  resource: string;
  schema: string;
  table: string;
  kind: 'collection' | 'document';
  importKind: 'collection' | 'document' | 'append-only';
  primaryKey: string[];
  idField?: string;
  identity?: {
    fields: string[];
  };
  writePolicy?: 'append-only';
  fields: Record<string, {
    type: string;
    required?: boolean;
  }>;
  columns: Record<string, string>;
  keyStrategy: DbPostgresIntegrationImportKeyStrategy;
  estimatedRows: number | null;
  batchSize: number;
  warnings: string[];
};

export type DbPostgresIntegrationImportPlan = {
  version: 1;
  kind: 'postgres.importPlan';
  source: {
    connectionStringEnv: string;
    driver: DbPostgresIntegrationDriver | null;
    schemas: string[];
  };
  target:
    | {
      kind: 'postgres-envelope';
      connectionStringEnv: string;
      driver: DbPostgresIntegrationDriver | null;
      schema: string;
      table: string;
      namespace?: string;
    }
    | {
      kind: 'sqlite-state';
      stateFile: string;
    };
  resources: DbPostgresIntegrationImportResource[];
  batchSize: number;
  warnings: string[];
};

export type DbPostgresIntegrationTable = {
  schema: string;
  name: string;
  kind: 'table' | 'view' | 'materialized-view' | 'partitioned-table';
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    defaultValue: string | null;
    generated: boolean;
    identity: boolean;
  }>;
  primaryKey: string[];
  uniqueIndexes: Array<{
    name: string;
    columns: string[];
  }>;
  foreignKeys: Array<{
    name: string;
    columns: string[];
    foreignSchema: string;
    foreignTable: string;
    foreignColumns: string[];
  }>;
  triggers: Array<{
    name: string;
    timing: string;
    events: string[];
  }>;
  rlsPolicies: Array<{
    name: string;
    command: string;
  }>;
  estimatedRows: number | null;
  exactRows?: number | null;
  classification: string;
};

export type DbPostgresIntegrationReport = {
  version: 1;
  kind: 'db.integrationReport';
  generatedAt: string;
  target: {
    path: string;
    kind: 'file' | 'directory';
  };
  postgres: {
    mode: 'source-only' | 'catalog' | 'partial';
    connectionStringEnv: string | null;
    schemas: string[];
    drivers: {
      detected: DbPostgresIntegrationDriver[];
      recommended: DbPostgresIntegrationDriver | null;
      ormDetected: string[];
    };
    catalog: {
      schemas: string[];
      tables: DbPostgresIntegrationTable[];
      exactRowCounts: boolean;
    };
    errors: Array<{
      code: string;
      message: string;
    }>;
  };
  source: {
    filesScanned: number;
    filesWithMatches: number;
    matches: Array<{
      kind: string;
      file: string;
      line: number;
      snippet: string;
      confidence: DbIntegrationConfidence;
    }>;
  };
  recommendations: Array<{
    kind: DbIntegrationRecommendationKind;
    table: string | null;
    confidence: DbIntegrationConfidence;
    message: string;
    nextStep: string;
    adoptionPath?: DbPostgresIntegrationAdoptionPath;
    details: Record<string, unknown>;
  }>;
  suggestions: DbPostgresIntegrationSuggestion[];
  importPlan?: DbPostgresIntegrationImportPlan;
  suggestedFiles: Array<{
    path: string;
    purpose: string;
  }>;
  agentInstructions: string[];
};

export type DbInspectPostgresIntegrationOptions = {
  cwd?: string;
  target?: string;
  postgresUrlEnv?: string;
  schemas?: string[];
  targetState?: string;
  targetPostgresTable?: string;
  exactRowCounts?: boolean;
  allowPartial?: boolean;
  generatedAt?: string;
  ignorePaths?: string[];
  client?: {
    query(sql: string, params?: unknown[]): Promise<{ rows?: Array<Record<string, unknown>>; rowCount?: number }> | { rows?: Array<Record<string, unknown>>; rowCount?: number };
    close?: () => void | Promise<void>;
    end?: () => void | Promise<void>;
  };
};

export function inspectPostgresIntegration(options: DbInspectPostgresIntegrationOptions): Promise<DbPostgresIntegrationReport>;

export type DbSchemaMigrationSourceKind =
  | 'prisma'
  | 'drizzle'
  | 'sql'
  | 'json-schema'
  | 'openapi'
  | 'validator'
  | 'orm'
  | 'migration-file';

export type DbSchemaMigrationDerivedField = {
  source: 'database' | 'external' | string;
  kind: string;
  owner?: string;
  details?: Record<string, unknown>;
};

export type DbSchemaMigrationField = {
  type: string;
  required?: boolean;
  nullable?: boolean;
  description?: string;
  default?: unknown;
  unique?: boolean;
  values?: unknown[];
  items?: DbSchemaMigrationField;
  fields?: Record<string, DbSchemaMigrationField>;
  additionalProperties?: boolean;
  readOnly?: boolean;
  derived?: DbSchemaMigrationDerivedField;
  relation?: {
    name?: string;
    to: string;
    toField?: string;
    cardinality?: 'one' | 'many';
  };
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  [key: string]: unknown;
};

export type DbSchemaMigrationResource = {
  name: string;
  kind: 'collection' | 'document';
  idField?: string;
  fields: Record<string, DbSchemaMigrationField>;
  source: {
    kind: DbSchemaMigrationSourceKind;
    file: string;
    exportName?: string;
    modelName?: string;
  };
  output: {
    format: 'jsonc' | 'schema-module';
    file: string;
    requiresExecutable: boolean;
  };
  warnings: string[];
};

export type DbSchemaMigrationSuggestion = {
  code: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  hint?: string;
  file?: string;
  resource?: string;
  details?: Record<string, unknown>;
};

export type DbSchemaMigrationOutputPlan = {
  schemaDir: string;
  format: 'mixed' | 'jsonc';
  resources: Array<{
    name: string;
    file: string;
    format: 'jsonc' | 'schema-module';
    requiresExecutable: boolean;
  }>;
};

export type DbSchemaMigrationReport = {
  kind: 'db.schemaMigrationReport';
  version: 1;
  generatedAt: string;
  target: {
    path: string;
  };
  source: {
    filesScanned: number;
    filesWithMatches: number;
    matches: Array<{
      kind: DbSchemaMigrationSourceKind | 'package' | 'raw-sql';
      file: string;
      line?: number;
      package?: string;
      symbol?: string;
      message: string;
    }>;
  };
  resources: DbSchemaMigrationResource[];
  suggestions: DbSchemaMigrationSuggestion[];
  outputPlan: DbSchemaMigrationOutputPlan;
};

export type DbInspectSchemaMigrationOptions = {
  cwd?: string;
  target?: string;
  schemaDir?: string;
  format?: 'mixed' | 'jsonc';
  generatedAt?: string;
  ignorePaths?: string[];
};

export function inspectSchemaMigration(options: DbInspectSchemaMigrationOptions): Promise<DbSchemaMigrationReport>;

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
  /** Optional contract-scoped operation refs output path. */
  contractRefs?: string | null;
  /** Output folder for generated Hono starter code. Defaults to "./db-api". */
  honoStarterDir?: string;
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
  /** How data file paths become resource names. Defaults to "basename". */
  naming?: DbResourceNamingStrategy;
  /** Customize data file path -> resource identity. */
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
  /**
   * JSON store durability ("current" or "versioned"). With "versioned", every
   * state write snapshots the previous contents under `.versions/<resource>/`
   * (pruned to maxVersions, default 10) and `async-db restore` can roll back.
   */
  durability?: 'current' | 'versioned' | string;
  /** Maximum retained version snapshots per resource for the versioned JSON store. */
  maxVersions?: number;
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
  /** Scan app source usage for endpoint exposure guidance. Defaults to false. */
  usage?: boolean | {
    enabled?: boolean;
    target?: string;
    generatedAt?: string;
  };
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
  /**
   * Opt-in audit trail: append one JSON line per successful runtime write to
   * `.audit/<resource>.jsonl` beside the resource state. `true` records op,
   * id, and changed field names; `{ values: true }` also records before/after
   * value snapshots. Audit failures warn and never fail the data write.
   */
  audit?: boolean | { values?: boolean };
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

export type DbNormalizedOperationTemplate = {
  kind?: 'graphql';
  name?: string;
  ref?: string;
  method?: string;
  path?: string;
  query?: string | Record<string, unknown>;
  body?: unknown;
  variables?: Record<string, unknown>;
  operationName?: string | null;
};

export type DbOperationRef = {
  name?: string;
  /** Callable ref for client query(). */
  ref: string;
};

export type DbRegisteredOperation = DbNormalizedOperationTemplate & {
  name: string;
  ref: string;
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
  /** Fail startup and doctor unless registered operations are enabled with a resolvable server registry. Defaults to false. */
  strict?: boolean;
  /** Folder containing operation source templates. Defaults to "./db/operations". */
  sourceDir?: string;
  /** Backwards-compatible alias for outputs.operationRegistry. */
  outFile?: string | null;
  /** Backwards-compatible alias for outputs.operationRefs. */
  refsOutFile?: string | null;
  /** Controls which default refs the server accepts. Defaults to "both". */
  acceptRefs?: DbOperationAcceptRefs;
  /** Optional contract enforced for all operation executions through this handler. */
  contract?: string;
  /** Custom server-side operation lookup for framework adapters or app registries. */
  resolveRef?: DbOperationResolveRef;
  /** Custom server-side validation or mapping for operation refs. */
  validateRef?: DbOperationValidateRef;
  /** Inline server registry keyed by operation ref or operation name. */
  registry?: Record<string, DbOperationRegistryValue>;
};

export type DbOperationManifest = {
  version: 1;
  kind: 'db.operations';
  generatedAt: string;
  operations: Record<string, DbRegisteredOperation>;
};

export type DbOperationRefsManifest = {
  version: 1;
  kind: 'db.operationRefs';
  generatedAt: string;
  operations: Record<string, {
    name: string;
    ref: string;
  }>;
};

export type DbOperationContract = {
  version: 1;
  kind: 'db.operationContract';
  operations: Record<string, {
    name: string;
    ref: string;
  }>;
};

export type DbContractWrite = boolean | Array<'create' | 'patch' | 'replace' | 'delete' | string>;

export type DbContractResource = {
  fields?: string[];
  read?: boolean;
  write?: DbContractWrite;
};

export type DbContractDefinition = {
  resources?: Record<string, DbContractResource>;
  operations?: string[];
  events?: Record<string, unknown>;
};

export type DbContractsOptions = Record<string, DbContractDefinition>;

export type DbContractRefsManifest = {
  version: 1;
  kind: 'db.contractRefs';
  generatedAt: string;
  contracts: Record<string, {
    resources: Record<string, DbContractResource>;
    operations: Record<string, {
      name: string;
      ref: string;
    }>;
  }>;
};

export type DbContractsCheckFinding = {
  severity: 'error' | 'warn';
  code: string;
  contract: string;
  operation?: string;
  resource?: string;
  field?: string;
  message: string;
  hint?: string;
};

export type DbContractsCheckResult = {
  version: 1;
  kind: 'db.contractsCheck';
  ok: boolean;
  findings: DbContractsCheckFinding[];
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
  contract?: string;
};

export type DbOperationExecutionOptions = {
  contract?: string;
};

export type DbOperationHandler = {
  enabled: boolean;
  resolve(ref: string): Promise<DbRegisteredOperation | null | undefined>;
  execute(ref: string, variables?: Record<string, unknown>, options?: DbOperationExecutionOptions): Promise<DbOperationResult>;
  executeRequest(ref: string, body?: DbOperationRequestBody | null, options?: DbOperationExecutionOptions): Promise<DbOperationResult>;
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
  /** How db handles writes back to source data files. Defaults to "preserve". */
  writePolicy?: 'preserve' | 'allow';
};

export type DbGitRemoteMode = 'app' | 'actions-pull' | 'actions-dispatch' | 'token';

export type DbGitSnapshotFile = {
  path: string;
  content?: string;
  text?: string;
  sha?: string;
  encoding?: string;
};

export type DbGitFilesSourceDefinition = {
  kind: 'git-files';
  shape: 'files' | 'file' | 'collection-file';
  remote: string;
  patterns: readonly string[];
  read?: 'frontmatter' | 'md' | 'mdx' | 'json' | 'jsonc' | 'text' | string;
  idField?: string;
  bodyField?: string;
  allowJsoncWrites?: boolean;
  components?: readonly string[];
};

export type DbGitSnapshotContext = {
  remote: DbGitHubRemoteDefinition;
  source: DbGitFilesSourceDefinition;
  resourceName: string;
  paths: string[];
};

export type DbGitSnapshotProvider =
  | readonly DbGitSnapshotFile[]
  | ((context: DbGitSnapshotContext) => readonly DbGitSnapshotFile[] | Promise<readonly DbGitSnapshotFile[]>);

export type DbGitHubRemoteDefinition = {
  kind: 'github';
  type: 'github';
  repo: string;
  branch: string;
  mode: DbGitRemoteMode;
  baseUrl?: string;
  token?: string;
  tokenEnv?: string;
  client?: {
    getTreeSnapshot?: (context: DbGitSnapshotContext) => readonly DbGitSnapshotFile[] | Promise<readonly DbGitSnapshotFile[]>;
    [key: string]: unknown;
  };
  snapshot?: DbGitSnapshotProvider;
  [key: string]: unknown;
};

export type DbGitMirrorWrites = 'receipt' | 'through';

export type DbGitMirrorOptions =
  | {
      store?: DbStoreName;
      writes?: DbGitMirrorWrites;
      [key: string]: unknown;
    }
  | DbCustomStore
  | DbCustomStoreFactory;

export type DbGitOptions = {
  /** Named Git remotes referenced by gitFiles(), gitFile(), and gitCollectionFile(). */
  remotes?: Record<string, DbGitHubRemoteDefinition | Record<string, unknown>>;
  /**
   * Runtime mirror for Git-backed resources. Defaults to the JSON mirror with
   * receipt-mode writes. Use sqliteMirror({ writes: "through" }) for durable
   * write-through outbox behavior.
   */
  mirror?: DbGitMirrorOptions;
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

export type DbEnvVarMap = Record<string, unknown>;

export type DbEnvVarRef = {
  kind: 'async-db.env.var';
  name: string;
  values?: DbEnvVarMap;
  default?: string;
};

export type DbEnvSecretRef = {
  kind: 'async-db.env.secret';
  name: string;
};

export type DbEnvRef = DbEnvVarRef | DbEnvSecretRef;

export type DbEnvConfigValue<T> =
  T extends (...args: any[]) => unknown
    ? T | DbEnvRef
    : T extends readonly (infer Item)[]
      ? Array<DbEnvConfigValue<Item>> | DbEnvRef
      : T extends object
        ? DbEnvConfigShape<T> | DbEnvRef
        : T | DbEnvRef;

export type DbEnvConfigShape<T> = {
  [Key in keyof T]?: DbEnvConfigValue<T[Key]>;
};

export type DbConfigProfilePatch = Omit<
  DbEnvConfigShape<DbOptions>,
  'cwd' | 'configPath' | 'from' | 'fs' | 'profile' | 'profiles'
>;

export type DbConfigInput = DbEnvConfigShape<Omit<DbOptions, 'profile' | 'profiles'>> & {
  /** Selected top-level named config policy bundle. */
  profile?: string | DbEnvVarRef;
  /** Named static config policy bundles selected once at config load/startup. */
  profiles?: Record<string, DbConfigProfilePatch>;
};

export type DbEnvHelpers = {
  var(name: string): DbEnvVarRef;
  var(name: string, options: { default: string }): DbEnvVarRef;
  var(name: string, values: DbEnvVarMap, options?: { default?: string }): DbEnvVarRef;
  secret(name: string): DbEnvSecretRef;
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
  /** Selected top-level named config policy bundle. Resolved at config load/startup, not per request. */
  profile?: string | DbEnvVarRef;
  /** Named static config policy bundles that merge over the base config before inline startup options. */
  profiles?: Record<string, DbConfigProfilePatch>;
  /** Project root used to resolve relative config paths. Defaults to process.cwd(). */
  cwd?: string;
  /** Optional filesystem adapter used by openDb(), sync, generated outputs, and built-in local stores. */
  fs?: DbFileSystem;
  /** Package API locator for a project root, db folder, root schema file, or individual schema file. */
  from?: string;
  /** Schema loading mode. Defaults to "data" for current low-level loaders and "runtime" for openDb. */
  load?: DbSchemaLoadMode;
  /** Explicit config file path. Defaults to db.config.js/mjs lookup from cwd. */
  configPath?: string;
  /** Data file source folder. Defaults to "./db". */
  dbDir?: string;
  /** Backwards-compatible data file source folder alias. If set, it wins over dbDir. */
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
  /** Git-backed content remotes and optional runtime mirror for Git resources. */
  git?: DbGitOptions;
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
  /** Resource naming and data file path identity options. */
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
    /** Maximum concurrent viewer event-stream subscribers before new subscriptions get 503. Defaults to 100. */
    maxEventClients?: number;
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
      falcor?: DbRouteExposure;
      viewer?: DbRouteExposure;
      schema?: DbRouteExposure;
      manifest?: DbRouteExposure;
      /** `GET <apiBase>/health` readiness probe. Defaults to "open" so load balancers can reach it even when the viewer is locked down. */
      health?: DbRouteExposure;
    };
    /**
     * App-owned per-request authorization seam. Runs once for every request
     * the db handler will handle (REST, viewer, schema, manifest, GraphQL,
     * Falcor, events, health, operations). Return true to allow, false for a
     * 403 SERVER_AUTHORIZATION_DENIED, or { status, body } for a custom
     * denial such as a 401 challenge. Requests that fall through to app
     * routes never reach the hook.
     */
    authorize?: (context: {
      request: import('node:http').IncomingMessage;
      url: URL;
      method: string;
      route: string;
    }) => boolean | undefined | null | void | { status?: number; body?: unknown } | Promise<boolean | undefined | null | void | { status?: number; body?: unknown }>;
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
  falcor?: {
    /** Enable the dependency-free Falcor JSONGraph endpoint. */
    enabled?: boolean;
    /** Falcor HTTP path. Defaults to "/model.json". */
    path?: string;
  };
  /** Optional registered REST operation settings. */
  operations?: DbOperationsOptions;
  /** Contract-scoped sharing boundaries for resources, fields, operations, and writes. */
  contracts?: DbContractsOptions;
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
    /**
     * Keep mock delays and errors active when NODE_ENV=production.
     * Mock behavior is skipped in production by default so the development
     * delay never taxes real traffic. Defaults to false.
     */
    production?: boolean;
  };
  generate?: {
    hono?: {
      /** Backwards-compatible alias for outputs.honoStarterDir. */
      outDir?: string;
      /** API modules to generate. */
      api?: Array<'rest' | 'graphql'> | 'rest' | 'graphql' | 'rest,graphql' | 'none';
      db?: 'sqlite';
      app?: 'standalone' | 'module';
      runtime?: 'node-sqlite';
      /** Include data file seed support in generated starter code. */
      seed?: false | 'fixtures';
    };
  };
};

export type DbOpenOptions = Omit<DbOptions, 'schema'> & {
  /** Schema config, or a loaded schema object returned by loadDbSchema(). */
  schema?: DbSchemaConfig | DbLoadedSchema;
};

export type DbKey = string | number | boolean | Record<string, unknown>;

export type DbCollectionWhereOperator<Value = unknown> = {
  eq?: Value;
  ne?: Value;
  in?: Value[];
  gt?: Value;
  gte?: Value;
  lt?: Value;
  lte?: Value;
  contains?: Value;
};

export type DbCollectionWhere<RecordType = Record<string, unknown>> = {
  [Field in keyof RecordType & string]?: RecordType[Field] | DbCollectionWhereOperator<RecordType[Field]>;
};

export type DbCollectionOrderBy<RecordType = Record<string, unknown>> =
  | (keyof RecordType & string)
  | { field: keyof RecordType & string; direction?: 'asc' | 'desc' }
  | Array<(keyof RecordType & string) | { field: keyof RecordType & string; direction?: 'asc' | 'desc' }>;

export type DbCollectionQuery<RecordType = Record<string, unknown>> = {
  where?: DbCollectionWhere<RecordType>;
  orderBy?: DbCollectionOrderBy<RecordType>;
  limit?: number;
  offset?: number;
};

export type DbCollectionAggregateMetric =
  | 'count'
  | {
    op: 'count' | 'sum' | 'min' | 'max' | 'avg';
    field?: string;
  };

export type DbCollectionAggregate<RecordType = Record<string, unknown>> = DbCollectionQuery<RecordType> & {
  groupBy?: string | string[];
  metrics?: Record<string, DbCollectionAggregateMetric>;
};

export type DbWritePrecondition = {
  /**
   * Optimistic-concurrency precondition. When set, the write only applies if
   * the stored value's current ETag matches; otherwise it fails with a 412
   * DB_PRECONDITION_FAILED error. "*" requires only that the record exists.
   * REST routes populate this from the If-Match request header, and single
   * record GET responses expose the current tag in an ETag header.
   */
  ifMatch?: string | null;
};

export type DbCollection<RecordType, KeyType = DbKey> = {
  all(): Promise<RecordType[]>;
  get(id: KeyType): Promise<RecordType | null>;
  exists(id: KeyType): Promise<boolean>;
  find(options?: DbCollectionQuery<RecordType>): Promise<RecordType[]>;
  count(options?: DbCollectionQuery<RecordType>): Promise<number>;
  aggregate(options: DbCollectionAggregate<RecordType>): Promise<Array<Record<string, unknown>>>;
  create(record: RecordType): Promise<RecordType>;
  append(record: RecordType): Promise<RecordType>;
  update(id: KeyType, patch: Partial<RecordType>, options?: DbWritePrecondition): Promise<RecordType | null>;
  patch(id: KeyType, patch: Partial<RecordType>, options?: DbWritePrecondition): Promise<RecordType | null>;
  delete(id: KeyType, options?: DbWritePrecondition): Promise<boolean>;
  replaceAll(records: RecordType[]): Promise<RecordType[]>;
};

export type DbEventAppendCollection<RecordType extends Record<string, unknown> = Record<string, unknown>> = {
  append(record: RecordType): Promise<RecordType>;
};

export type DbEventResourceOptions = {
  /**
   * Optional id producer. Leave unset when the target collection already
   * generates ids through its normal append path.
   */
  id?: () => unknown;
  /** Timestamp producer for the conventional timestamp field. */
  now?: () => string | Date;
  /** Default event level when append() does not provide one. Defaults to "info". */
  defaultLevel?: string;
  /** Field name for the generated timestamp. Defaults to "createdAt". */
  timestampField?: string;
  /** Optional validation for event type names. */
  typePattern?: RegExp;
  /** Optional allow-list for event levels. */
  levels?: readonly string[];
};

export type DbEventResourceAppendOptions = {
  /** Explicit id for this event record. Overrides the helper id producer. */
  id?: unknown;
  /** Event severity or classification. Defaults to the helper default level. */
  level?: string;
  /** Human-readable event message. Defaults to the event type. */
  message?: string;
  /** Explicit timestamp for this event record. */
  createdAt?: string;
  /** Extra record fields to merge into the appended event. */
  fields?: Record<string, unknown>;
};

export type DbEventResource<
  Payload = unknown,
  RecordType extends Record<string, unknown> = Record<string, unknown>,
> = {
  readonly collection: DbEventAppendCollection<RecordType>;
  append(type: string, payload?: Payload, options?: DbEventResourceAppendOptions): Promise<RecordType>;
};

export type DbDocumentPath = string | Array<string | number>;

export type DbDocument<DocumentType> = {
  all(): Promise<DocumentType>;
  get(): Promise<DocumentType>;
  get(path: DbDocumentPath): Promise<unknown>;
  put(value: DocumentType, options?: DbWritePrecondition): Promise<DocumentType>;
  set(path: DbDocumentPath, value: unknown): Promise<unknown>;
  update(patch: Partial<DocumentType>, options?: DbWritePrecondition): Promise<DocumentType>;
};

/**
 * Compute the optimistic-concurrency entity tag for a runtime record or
 * document value. Matches the ETag header REST emits for single-record reads.
 */
export function recordEtag(value: unknown): string;

export type DbForkSource =
  | 'main'
  | { fork?: string | null; branch: string }
  | { fork?: string | null; snapshot: string };

export type DbForkCreateOptions = {
  from?: DbForkSource;
  metadata?: Record<string, unknown>;
};

export type DbBranchCreateOptions = {
  from?: string;
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
  copies?: Record<string, {
    resource: string;
    from: string;
    to: string;
    copiedAt: string;
  }>;
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

export type DbKnownStringKeys<T> = string extends keyof T ? never : keyof T & string;

export type DbCollectionKey<Types extends DbTypeMap, Name extends string> =
  Types extends { collectionKeys: infer Keys }
    ? Name extends keyof Keys
      ? Keys[Name]
      : DbKey
    : DbKey;

export type DbResourceForName<Types extends DbTypeMap, Name extends string> =
  Name extends DbKnownStringKeys<Types['collections']>
    ? DbCollection<Types['collections'][Name], DbCollectionKey<Types, Name>>
    : Name extends DbKnownStringKeys<Types['documents']>
      ? DbDocument<Types['documents'][Name]>
      : {};

export type DbCallableControl<TControl extends (...args: never[]) => unknown, TResource> = TControl & TResource;

export type DbForkManager<Types extends DbTypeMap = DbTypeMap> = {
  create(name: string, options?: DbForkCreateOptions): Promise<Db<Types>>;
  open(name: string): Promise<Db<Types>>;
  ensure(name: string, options?: DbForkCreateOptions): Promise<Db<Types>>;
  list(): Promise<Array<Record<string, unknown>>>;
  delete(name: string): Promise<boolean>;
};

export type DbBranchManager<Types extends DbTypeMap = DbTypeMap> = {
  create(name: string, options?: DbBranchCreateOptions): Promise<Db<Types>>;
  open(name: string): Promise<Db<Types>>;
  ensure(name: string, options?: DbBranchCreateOptions): Promise<Db<Types>>;
  list(): Promise<Array<Record<string, unknown>>>;
  delete(name: string): Promise<boolean>;
};

export type DbBase<Types extends DbTypeMap = DbTypeMap> = {
  events: DbRuntimeEvents;
  resources: DbResourceRegistry;
  forks: DbForkManager<Types>;
  branches: DbBranchManager<Types>;
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
  collection<Name extends keyof Types['collections'] & string>(
    name: Name,
  ): DbCollection<Types['collections'][Name], DbCollectionKey<Types, Name>>;
  document<Name extends keyof Types['documents'] & string>(name: Name): DbDocument<Types['documents'][Name]>;
  operation(ref: string, variables?: Record<string, unknown>, options?: DbOperationExecutionOptions): Promise<unknown>;
  query(ref: string, variables?: Record<string, unknown>, options?: DbOperationExecutionOptions): Promise<unknown>;
  resourceNames(): string[];
  close(): Promise<void>;
};

export type DbControls<Types extends DbTypeMap = DbTypeMap> = DbBase<Types>;

export type DbCallableControls<Types extends DbTypeMap = DbTypeMap> = {
  branch: DbCallableControl<DbBase<Types>['branch'], DbResourceForName<Types, 'branch'>>;
  close: DbCallableControl<DbBase<Types>['close'], DbResourceForName<Types, 'close'>>;
  collection: DbCallableControl<DbBase<Types>['collection'], DbResourceForName<Types, 'collection'>>;
  document: DbCallableControl<DbBase<Types>['document'], DbResourceForName<Types, 'document'>>;
  fork: DbCallableControl<DbBase<Types>['fork'], DbResourceForName<Types, 'fork'>>;
  operation: DbCallableControl<DbBase<Types>['operation'], DbResourceForName<Types, 'operation'>>;
  query: DbCallableControl<DbBase<Types>['query'], DbResourceForName<Types, 'query'>>;
  resourceNames: DbCallableControl<DbBase<Types>['resourceNames'], DbResourceForName<Types, 'resourceNames'>>;
};

export type DbResourceProxy<Types extends DbTypeMap = DbTypeMap> = {
  [Name in DbKnownStringKeys<Types['collections']> as Name extends '_' | keyof DbBase<Types> ? never : Name]:
    DbCollection<Types['collections'][Name], DbCollectionKey<Types, Name>>;
} & {
  [Name in DbKnownStringKeys<Types['documents']> as Name extends '_' | keyof DbBase<Types> ? never : Name]:
    DbDocument<Types['documents'][Name]>;
};

export type Db<Types extends DbTypeMap = DbTypeMap> =
  DbBase<Types>
  & DbCallableControls<Types>
  & DbResourceProxy<Types>
  & {
    _: DbControls<Types>;
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
  /** Scoped base for default batch, manifest, and operation paths. Defaults to "/__db". */
  apiBase?: string;
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

export type DbUsageSurface =
  | 'client'
  | 'config'
  | 'falcor'
  | 'graphql'
  | 'hono'
  | 'json'
  | 'manifest'
  | 'operations'
  | 'package'
  | 'rest'
  | 'schema'
  | 'stores'
  | 'viewer'
  | 'vite';

export type DbUsageMatch = {
  surface: DbUsageSurface;
  kind: string;
  file: string;
  line: number;
  snippet: string;
  confidence: 'high' | 'medium' | 'low';
};

export type DbUsageManifest = {
  version: 1;
  kind: 'db.usageManifest';
  generatedAt: string;
  target: {
    path: string;
    kind: 'file' | 'directory';
  };
  summary: {
    filesScanned: number;
    filesWithMatches: number;
    matches: number;
    recommendations: number;
  };
  surfaces: Record<DbUsageSurface, {
    count: number;
    kinds: Record<string, number>;
  }>;
  recommendations: Array<{
    code: string;
    severity: 'info';
    surface: DbUsageSurface;
    message: string;
    hint: string;
    details: Record<string, unknown>;
  }>;
  files: Array<{
    path: string;
    matches: DbUsageMatch[];
  }>;
};

export type DbDoctorResult = {
  summary: {
    error: number;
    warn: number;
    info: number;
  };
  findings: DbDoctorFinding[];
  usage?: DbUsageManifest;
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
  /** Falcor endpoint path. Defaults to configured falcor.path or "/model.json". */
  falcorPath?: string;
  /** Canonical REST resource alias base. Defaults to "/resources". */
  resourceBasePath?: string;
  /** Explicit request trace option. Wins over db.config.js server.trace. */
  trace?: DbTraceOptions;
};

export type DbRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: () => void,
) => Promise<boolean>;

export type DbRuntimeLifecycleEvent =
  | { type: 'synced' | 'synced-with-errors'; version: number; diagnostics: unknown[] }
  | { type: 'sync-error'; version: number; diagnostics: unknown[] }
  | { type: 'watch-disabled'; version: number; diagnostics: unknown[] };

export type DbRuntimeLifecycleEvents = {
  subscribe(listener: (event: DbRuntimeLifecycleEvent) => void): () => void;
  publish(event: DbRuntimeLifecycleEvent): void;
  close(): void;
};

export type DbWatchOptions = {
  /** Milliseconds to debounce source file changes before reloading. Defaults to 75. */
  debounceMs?: number;
  /** Receives watcher availability warnings. Defaults to console.warn. */
  warn?: (message: string) => unknown;
};

export type DbSourceWatcher = {
  readonly enabled: boolean;
  close(): void;
};

export type DbRuntimeOptions = DbOpenOptions & {
  /** Request handler route options. Defaults to root routes enabled. */
  handler?: DbRequestHandlerOptions;
  /** Enable source watching, customize it, or disable it. Defaults to true. */
  watch?: boolean | DbWatchOptions;
  /** Hydrate the runtime mirror when syncOnOpen is false. Defaults to true. */
  hydrateOnOpen?: boolean;
};

export type DbRuntime = {
  db: Db;
  events: DbRuntimeLifecycleEvents;
  watcher: DbSourceWatcher | null;
  handleRequest: DbRequestHandler;
  reload(options?: { allowErrors?: boolean }): Promise<unknown>;
  close(): Promise<void>;
};

export type DbServer = {
  server: Server;
  db: Db;
  url: string;
};

export function openDb<Types extends DbTypeMap = DbTypeMap>(options?: DbOpenOptions | string): Promise<Db<Types>>;
export function eventResource<
  Payload = unknown,
  RecordType extends Record<string, unknown> = Record<string, unknown>,
>(
  collection: DbEventAppendCollection<RecordType>,
  options?: DbEventResourceOptions,
): DbEventResource<Payload, RecordType>;
export function createDbClient(options?: DbClientOptions): DbClient;
export function createIndexedDbCacheStorage(options?: {
  name?: string;
  storeName?: string;
  key?: string;
  indexedDB?: unknown;
}): DbCacheStorage;
export function createDbRuntime(options?: DbRuntimeOptions | string): Promise<DbRuntime>;
export function createDbRequestHandler<Types extends DbTypeMap = DbTypeMap>(db: Db<Types>, options?: DbRequestHandlerOptions): DbRequestHandler;
export function handleFalcorRequest<Types extends DbTypeMap = DbTypeMap>(db: Db<Types>, request: IncomingMessage, response: ServerResponse): Promise<void>;
export function createDbOperationHandler<Types extends DbTypeMap = DbTypeMap>(
  db: Db<Types>,
  options?: DbOperationsOptions | { operations?: boolean | 'auto' | DbOperationsOptions },
): DbOperationHandler;
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
export function reloadDb<Types extends DbTypeMap = DbTypeMap>(db: Db<Types>, options?: { allowErrors?: boolean }): Promise<unknown>;
export function watchDbSources<Types extends DbTypeMap = DbTypeMap>(db: Db<Types>, options?: DbWatchOptions): Promise<DbSourceWatcher>;
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
    write?: boolean;
    createDirectory?: boolean;
  },
): Promise<{
  manifest: DbOperationManifest;
  refs: DbOperationRefsManifest;
  outFiles: string[];
  refsOutFiles: string[];
}>;
export function buildContractRefsManifest(
  config: DbOptions,
  options?: {
    generatedAt?: string;
    outFile?: string | null;
    write?: boolean;
  },
): Promise<{
  manifest: DbContractRefsManifest;
  outFiles: string[];
}>;
export function inferContractsFromTags(
  config: DbOptions,
  options?: { generatedAt?: string },
): Promise<{
  version: 1;
  kind: 'db.contractsInference';
  source: 'tags';
  generatedAt: string;
  contracts: DbContractsOptions;
}>;
export function inferContractsFromUsage(
  config: DbOptions,
  options?: { target?: string; generatedAt?: string },
): Promise<{
  version: 1;
  kind: 'db.contractsInference';
  source: 'usage';
  generatedAt: string;
  contracts: DbContractsOptions;
}>;
export function checkContracts(config: DbOptions): Promise<DbContractsCheckResult>;
export function assertOperationAllowedByContract(
  config: DbOptions,
  operation: DbRegisteredOperation,
  requestedRef: string,
  contractName: string,
): void;
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
export const env: DbEnvHelpers;
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
export function executeGraphql<Types extends DbTypeMap = DbTypeMap>(
  db: Db<Types>,
  request: string | GraphqlRequest,
): Promise<GraphqlResult>;
export function executeGraphql<Types extends DbTypeMap = DbTypeMap>(
  db: Db<Types>,
  request: GraphqlRequest[],
): Promise<GraphqlResult[]>;
export function executeGraphqlBatch<Types extends DbTypeMap = DbTypeMap>(db: Db<Types>, requests: GraphqlRequest[]): Promise<GraphqlResult[]>;
export function parseGraphql(query: string): unknown;
