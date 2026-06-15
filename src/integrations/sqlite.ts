import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { dbError, listChoices } from '../errors.js';
import { resolveResource, resourceAliasCollisionGroups } from '../names.js';
import { getPointer, setPointer, type JsonPath } from '../features/runtime/json-pointer.js';
import { identityForResource } from '../features/identity.js';
import type { SchemaField } from '../features/schema/fields.js';
import { assertRecordMatchesResource, loadProjectSchema } from '../schema.js';
import { applyDefaultsToRecord } from '../sync.js';
import { applyDefaultsToSeed } from '../features/sync/defaults.js';
import { seedForRuntimeState } from '../features/sync/synthetic-seed.js';
import {
  aggregateCollectionRecords,
  applyCollectionQuery,
  countCollectionRecords,
  type CollectionAggregate,
  type CollectionQuery,
} from '../features/runtime/query.js';
import {
  suppressNodeSqliteExperimentalWarning,
  suppressNodeSqliteExperimentalWarningAsync,
} from '../features/sqlite/node-sqlite-warning.js';

const require = createRequire(import.meta.url);

type MaybePromise<T> = T | Promise<T>;
type SqliteValue = string | number | bigint | Buffer | null;
type SqliteRow = Record<string, SqliteValue>;

export type SqliteRunResult = {
  changes: number;
  lastInsertRowid?: number | bigint;
};

export type SqliteStatement = {
  get(...values: unknown[]): MaybePromise<SqliteRow | undefined>;
  all(...values: unknown[]): MaybePromise<SqliteRow[]>;
  run(...values: unknown[]): MaybePromise<SqliteRunResult>;
};

export type SqliteDatabase = {
  exec(sql: string): MaybePromise<void>;
  prepare(sql: string): MaybePromise<SqliteStatement>;
  close(): MaybePromise<void>;
};

type SyncSqliteStatement = {
  get(...values: unknown[]): SqliteRow | undefined;
  all(...values: unknown[]): SqliteRow[];
  run(...values: unknown[]): SqliteRunResult;
};

type SyncSqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SyncSqliteStatement;
  close(): void;
};

type DatabaseSyncConstructor = new (file: string, options?: { open?: boolean; readOnly?: boolean }) => SyncSqliteDatabase;

type SqliteConfig = {
  cwd: string;
  stateDir: string;
  defaults?: {
    applyOnCreate?: boolean;
    applyOnSafeMigration?: boolean;
  };
  [key: string]: unknown;
};

type SqliteResource = {
  name: string;
  kind: 'collection' | 'document' | string;
  idField?: string;
  identity?: {
    fields?: string[];
  };
  writePolicy?: string;
  fields: Record<string, SchemaField>;
  dataHash?: string | null;
  [key: string]: unknown;
};

type SqliteProject = {
  resources: SqliteResource[];
};

type OpenSqliteOptions = Record<string, unknown> & {
  project?: SqliteProject;
  storage?: {
    file?: string;
    [key: string]: unknown;
  };
  file?: string;
  database?: SqliteDatabase;
  open?: (options: { file: string; readOnly: boolean }) => SqliteDatabase | Promise<SqliteDatabase>;
  closeDatabase?: boolean;
  migrate?: boolean;
  readOnly?: boolean;
  tables?: Record<string, string | SqliteTableMapping>;
};

export type SqliteTableMapping = {
  table?: string;
  columns?: Record<string, string>;
  primaryKey?: string | string[];
  readOnly?: boolean;
};

type NormalizedTableMapping = {
  table: string;
  columns: Record<string, string>;
  primaryKey: string[];
  readOnly: boolean;
};

type SqliteStoreOptions = {
  file?: string;
};

type StoreContext = {
  config: SqliteConfig;
  storeName: string;
};

type StoreConnection = {
  database: SyncSqliteDatabase;
  closed: boolean;
};

type StoreAdapter = {
  name: string;
  capabilities: typeof sqliteStoreCapabilities;
  statePath(): string | undefined;
  hydrate(resources: SqliteResource[]): Promise<void>;
  readResource(resource: SqliteResource, fallback: unknown): unknown;
  writeResource(resource: SqliteResource, value: unknown): void;
  withResourceWrite<T>(resource: SqliteResource, operation: () => T | Promise<T>): Promise<T>;
  close(): void;
};

type ResourceKind = 'collection' | 'document';

export async function openSqliteDb(options: OpenSqliteOptions = {}): Promise<SqliteDb> {
  const config = await loadConfig(options) as SqliteConfig;
  const project = options.project ?? await loadProjectSchema(config) as SqliteProject;
  const storage = options.storage ?? {};
  const file = storage.file ?? options.file ?? path.join(config.stateDir, 'sqlite', 'db.sqlite');
  const tableMappings = normalizeTableMappings(project.resources, options.tables ?? {});
  const readOnly = options.readOnly === true;
  const opened = await openSqliteConnection(file, options, readOnly);

  if (options.migrate !== false && !readOnly) {
    await migrateSqliteDbInternal(opened.database, project.resources, tableMappings);
  }

  return new SqliteDb(config, project.resources, opened.database, {
    tableMappings,
    readOnly,
    closeDatabase: opened.closeDatabase,
  });
}

export function sqliteStore(options: SqliteStoreOptions = {}): (context: StoreContext) => StoreAdapter {
  const databases = new WeakMap<object, StoreConnection>();
  const writeQueues = new Map<string, Promise<unknown>>();

  return ({ config, storeName }) => {
    const file = resolveSqliteStoreFile(config, options.file);
    const connection = openStoreDatabase(file, databases, config);
    const database = connection.database;
    migrateSqliteStore(database);

    return {
      name: storeName,
      capabilities: sqliteStoreCapabilities,
      statePath() {
        return file === ':memory:' ? undefined : file;
      },
      async hydrate(resources) {
        migrateSqliteStore(database);
        for (const resource of resources) {
          syncSqliteStoreResource(database, config, resource);
        }
      },
      readResource(resource, fallback) {
        const row = database.prepare('SELECT value FROM "_db_resources" WHERE name = ?').get(resource.name);
        return row ? JSON.parse(String(row.value)) : fallback;
      },
      writeResource(resource, value) {
        writeSqliteStoreResource(database, resource, value);
      },
      withResourceWrite<T>(resource: SqliteResource, operation: () => T | Promise<T>): Promise<T> {
        const queueKey = `${file}:${resource.name}`;
        const previous = writeQueues.get(queueKey) ?? Promise.resolve();
        const current = previous.then(operation, operation);
        const stored = current.catch(() => {});
        writeQueues.set(queueKey, stored);
        stored.finally(() => {
          if (writeQueues.get(queueKey) === stored) {
            writeQueues.delete(queueKey);
          }
        });
        return current;
      },
      close() {
        if (connection.closed) {
          return;
        }
        connection.closed = true;
        database.close();
        databases.delete(config);
      },
    };
  };
}

function resolveSqliteStoreFile(config: SqliteConfig, file?: string): string {
  if (file === ':memory:') {
    return file;
  }
  if (file) {
    return path.resolve(config.cwd, file);
  }
  return path.join(config.stateDir, 'runtime.sqlite');
}

async function openSqliteConnection(
  file: string,
  options: OpenSqliteOptions,
  readOnly: boolean,
): Promise<{ database: SqliteDatabase; closeDatabase: boolean }> {
  if (options.database) {
    return {
      database: options.database,
      closeDatabase: options.closeDatabase === true,
    };
  }

  const openOptions = { file, readOnly };
  if (options.open) {
    return {
      database: await options.open(openOptions),
      closeDatabase: options.closeDatabase !== false,
    };
  }

  const { DatabaseSync } = await importNodeSqlite();
  if (file !== ':memory:') {
    await mkdir(path.dirname(file), { recursive: true });
  }

  return {
    database: readOnly
      ? new DatabaseSync(file, { open: true, readOnly: true })
      : new DatabaseSync(file),
    closeDatabase: options.closeDatabase !== false,
  };
}

function normalizeTableMappings(
  resources: SqliteResource[],
  mappings: Record<string, string | SqliteTableMapping>,
): Map<string, NormalizedTableMapping> {
  const normalized = new Map<string, NormalizedTableMapping>();
  for (const resource of resources) {
    const raw = mappings[resource.name];
    if (raw === undefined) {
      continue;
    }

    if (typeof raw === 'string') {
      normalized.set(resource.name, {
        ...defaultTableMapping(resource),
        table: raw,
      });
      continue;
    }

    const primaryKey = raw.primaryKey === undefined
      ? defaultTableMapping(resource).primaryKey
      : Array.isArray(raw.primaryKey)
        ? raw.primaryKey
        : [raw.primaryKey];
    normalized.set(resource.name, {
      table: raw.table ?? resource.name,
      columns: raw.columns ?? {},
      primaryKey,
      readOnly: raw.readOnly === true,
    });
  }
  return normalized;
}

export const sqliteStoreCapabilities = {
  writable: true,
  persistence: 'local-sqlite',
  atomicity: 'resource',
  liveEvents: true,
  staticExport: false,
  production: 'small-local',
};

export async function migrateSqliteDb(database: SqliteDatabase, resources: SqliteResource[]): Promise<void> {
  await migrateSqliteDbInternal(database, resources, new Map());
}

async function migrateSqliteDbInternal(database: SqliteDatabase, resources: SqliteResource[], tableMappings: Map<string, NormalizedTableMapping>): Promise<void> {
  for (const resource of resources) {
    if (resource.kind === 'collection' && !tableMappings.has(resource.name)) {
      await database.exec(createTableSql(resource));
    }
  }

  await database.exec(`CREATE TABLE IF NOT EXISTS "_db_documents" (
    "name" TEXT PRIMARY KEY,
    "value" TEXT NOT NULL
  ) STRICT;`);
}

function migrateSqliteStore(database: SyncSqliteDatabase): void {
  database.exec(`CREATE TABLE IF NOT EXISTS "_db_resources" (
    "name" TEXT PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "source_hash" TEXT,
    "value" TEXT NOT NULL
  ) STRICT;`);
}

function openStoreDatabase(file: string, databases: WeakMap<object, StoreConnection>, config: SqliteConfig): StoreConnection {
  let connection = databases.get(config);
  if (connection && !connection.closed) {
    return connection;
  }

  const { DatabaseSync } = importNodeSqliteSync();
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  connection = {
    database: new DatabaseSync(file),
    closed: false,
  };
  databases.set(config, connection);
  return connection;
}

function syncSqliteStoreResource(database: SyncSqliteDatabase, config: SqliteConfig, resource: SqliteResource): void {
  const row = database.prepare('SELECT source_hash FROM "_db_resources" WHERE name = ?').get(resource.name);
  const sourceChanged = resource.dataHash && row?.source_hash !== resource.dataHash;

  if (!row || sourceChanged) {
    writeSqliteStoreResource(database, resource, applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config));
    return;
  }

  if (config.defaults?.applyOnSafeMigration !== false) {
    const current = JSON.parse(String(database.prepare('SELECT value FROM "_db_resources" WHERE name = ?').get(resource.name)?.value));
    writeSqliteStoreResource(database, resource, applyDefaultsToSeed(current, resource, config));
  }
}

function writeSqliteStoreResource(database: SyncSqliteDatabase, resource: SqliteResource, value: unknown): void {
  database.prepare(`INSERT INTO "_db_resources" (name, kind, source_hash, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      kind = excluded.kind,
      source_hash = excluded.source_hash,
      value = excluded.value`).run(
    resource.name,
    resource.kind,
    resource.dataHash ?? null,
    JSON.stringify(value),
  );
}

export class SqliteDb {
  config: SqliteConfig;
  resources: Map<string, SqliteResource>;
  database: SqliteDatabase;
  tableMappings: Map<string, NormalizedTableMapping>;
  readOnly: boolean;
  closeDatabase: boolean;

  constructor(
    config: SqliteConfig,
    resources: SqliteResource[],
    database: SqliteDatabase,
    options: {
      tableMappings?: Map<string, NormalizedTableMapping>;
      readOnly?: boolean;
      closeDatabase?: boolean;
    } = {},
  ) {
    this.config = config;
    this.resources = new Map(resources.map((resource) => [resource.name, resource]));
    assertNoResourceAliasCollisions(this.resources);
    this.database = database;
    this.tableMappings = options.tableMappings ?? new Map();
    this.readOnly = options.readOnly === true;
    this.closeDatabase = options.closeDatabase !== false;
  }

  collection(name: string): SqliteDbCollection {
    const resource = this.requireResource(name, 'collection');
    return new SqliteDbCollection(this.config, resource, this.database, {
      mapping: this.tableMappingFor(resource),
      readOnly: this.readOnly,
    });
  }

  table(name: string): SqliteDbCollection {
    return this.collection(name);
  }

  document(name: string): SqliteDbDocument {
    const resource = this.requireResource(name, 'document');
    return new SqliteDbDocument(this.config, resource, this.database, {
      readOnly: this.readOnly,
    });
  }

  resourceNames(): string[] {
    return [...this.resources.keys()];
  }

  close(): void {
    if (this.closeDatabase) {
      this.database.close();
    }
  }

  requireResource(name: string, kind: ResourceKind): SqliteResource {
    const { resource, candidates } = resolveResource(this.resources, name);
    if (!resource) {
      throw dbError(
        'SQLITE_UNKNOWN_RESOURCE',
        `Unknown SQLite db resource "${name}".`,
        {
          status: 404,
          hint: `Use one of: ${listChoices(this.resourceNames())}.`,
          details: {
            resource: name,
            requestedResource: name,
            normalizedCandidates: candidates,
            availableResources: this.resourceNames(),
          },
        },
      );
    }

    if (resource.kind !== kind) {
      throw dbError(
        'SQLITE_RESOURCE_KIND_MISMATCH',
        `Resource "${name}" is a ${resource.kind}, not a ${kind}.`,
        {
          status: 400,
          hint: resource.kind === 'collection'
            ? `Use db.collection("${name}") for this resource.`
            : `Use db.document("${name}") for this resource.`,
          details: {
            resource: name,
            expectedKind: kind,
            actualKind: resource.kind,
          },
        },
      );
    }

    return resource;
  }

  private tableMappingFor(resource: SqliteResource): NormalizedTableMapping {
    return this.tableMappings.get(resource.name) ?? defaultTableMapping(resource);
  }
}

function assertNoResourceAliasCollisions(resources: Map<string, SqliteResource>): void {
  const collisions = resourceAliasCollisionGroups(resources);
  if (collisions.length === 0) {
    return;
  }

  const collision = collisions[0];
  throw dbError(
    'SQLITE_RESOURCE_ALIAS_COLLISION',
    `Resource aliases are ambiguous for "${collision.alias}".`,
    {
      status: 400,
      hint: 'Rename one resource so its camelCase and kebab-case aliases are unique.',
      details: {
        alias: collision.alias,
        aliases: collision.aliases,
        resources: collision.resources,
        candidates: collision.candidates,
        collisions,
      },
    },
  );
}

export class SqliteDbCollection {
  config: SqliteConfig;
  resource: SqliteResource;
  database: SqliteDatabase;
  table: string;
  mapping: NormalizedTableMapping;
  readOnly: boolean;

  constructor(
    config: SqliteConfig,
    resource: SqliteResource,
    database: SqliteDatabase,
    options: {
      mapping?: NormalizedTableMapping;
      readOnly?: boolean;
    } = {},
  ) {
    this.config = config;
    this.resource = resource;
    this.database = database;
    this.mapping = options.mapping ?? defaultTableMapping(resource);
    this.readOnly = options.readOnly === true || this.mapping.readOnly;
    this.table = quoteIdentifier(this.mapping.table);
  }

  async all(): Promise<Record<string, unknown>[]> {
    const rows = await sqliteAll(this.database, `SELECT * FROM ${this.table}`);
    return rows.map((row) => deserializeMappedRow(this.resource, row, this.mapping));
  }

  async get(id: unknown): Promise<Record<string, unknown> | null> {
    const key = keyPredicate(this.resource, this.mapping, id);
    const row = await sqliteGet(this.database, `SELECT * FROM ${this.table} WHERE ${key.where}`, ...key.values);
    return row ? deserializeMappedRow(this.resource, row, this.mapping) : null;
  }

  async exists(id: unknown): Promise<boolean> {
    const key = keyPredicate(this.resource, this.mapping, id);
    const row = await sqliteGet(this.database, `SELECT 1 as found FROM ${this.table} WHERE ${key.where}`, ...key.values);
    return Boolean(row);
  }

  async find(query: CollectionQuery = {}): Promise<Record<string, unknown>[]> {
    return applyCollectionQuery(await this.all(), query);
  }

  async count(query: CollectionQuery = {}): Promise<number> {
    return countCollectionRecords(await this.all(), query);
  }

  async aggregate(aggregate: CollectionAggregate): Promise<Record<string, unknown>[]> {
    return aggregateCollectionRecords(await this.all(), aggregate);
  }

  async create(record: unknown): Promise<Record<string, unknown>> {
    this.assertMutable('create');
    return this.createWithOperation(record, 'create');
  }

  async append(record: unknown): Promise<Record<string, unknown>> {
    return this.createWithOperation(record, 'append');
  }

  private async createWithOperation(record: unknown, _operation: 'create' | 'append'): Promise<Record<string, unknown>> {
    this.assertWritable('create');
    const fields = Object.keys(this.resource.fields);
    const nextRecord = this.config.defaults?.applyOnCreate === false
      ? stripUnknownFields(this.resource, record)
      : applyDefaultsToRecord(stripUnknownFields(this.resource, record), this.resource);
    const keyFields = keyFieldsFor(this.resource, this.mapping);

    if (
      keyFields.length === 1
      && (
        nextRecord[keyFields[0]] === undefined
        || nextRecord[keyFields[0]] === null
        || nextRecord[keyFields[0]] === ''
      )
    ) {
      const idField = keyFields[0];
      nextRecord[idField] = await this.nextId();
    }
    if (keyFields.length > 1) {
      assertCompoundKeyPresent(this.resource, keyFields, nextRecord);
    }

    assertRecordMatchesResource(nextRecord, resourceWithMappingIdentity(this.resource, this.mapping), this.config, {
      source: `${this.resource.name} create body`,
    });

    const serialized = serializeRow(this.resource, nextRecord);
    const columns = fields.map((field) => quoteIdentifier(columnFor(this.mapping, field))).join(', ');
    const placeholders = fields.map(() => '?').join(', ');
    try {
      await sqliteRun(this.database, `INSERT INTO ${this.table} (${columns}) VALUES (${placeholders})`, ...fields.map((field) => serialized[field] ?? null));
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE')) {
        throw dbError(
          'SQLITE_DUPLICATE_ID',
          `Cannot create "${this.resource.name}" record because the SQLite key already exists.`,
          {
            status: 409,
            hint: 'Use a unique id, or call patch/update if you intended to modify the existing record.',
            details: {
              resource: this.resource.name,
              idField: keyFields.length === 1 ? keyFields[0] : undefined,
              id: keyFields.length === 1 ? nextRecord[keyFields[0]] : undefined,
              key: keyFields.length > 1 ? Object.fromEntries(keyFields.map((field) => [field, nextRecord[field]])) : undefined,
            },
          },
        );
      }
      throw error;
    }
    return nextRecord;
  }

  async update(id: unknown, patch: unknown): Promise<Record<string, unknown> | null> {
    return this.patch(id, patch);
  }

  async patch(id: unknown, patch: unknown): Promise<Record<string, unknown> | null> {
    this.assertWritable('patch');
    this.assertMutable('patch');
    const existing = await this.get(id);
    if (!existing) {
      return null;
    }
    const keyFields = keyFieldsFor(this.resource, this.mapping);

    const nextRecord = stripUnknownFields(this.resource, {
      ...existing,
      ...(isRecord(patch) ? patch : {}),
      ...Object.fromEntries(keyFields.map((field) => [field, existing[field]])),
    });

    assertRecordMatchesResource(nextRecord, resourceWithMappingIdentity(this.resource, this.mapping), this.config, {
      source: `${this.resource.name} patch body`,
    });

    const fields = Object.keys(this.resource.fields).filter((field) => !keyFields.includes(field));
    const serialized = serializeRow(this.resource, nextRecord);
    const assignments = fields.map((field) => `${quoteIdentifier(columnFor(this.mapping, field))} = ?`).join(', ');
    const key = keyPredicate(this.resource, this.mapping, existing);
    await sqliteRun(
      this.database,
      `UPDATE ${this.table} SET ${assignments} WHERE ${key.where}`,
      ...fields.map((field) => serialized[field] ?? null),
      ...key.values,
    );
    return nextRecord;
  }

  async delete(id: unknown): Promise<boolean> {
    this.assertWritable('delete');
    this.assertMutable('delete');
    const key = keyPredicate(this.resource, this.mapping, id);
    const result = await sqliteRun(this.database, `DELETE FROM ${this.table} WHERE ${key.where}`, ...key.values);
    return result.changes > 0;
  }

  async nextId(): Promise<string> {
    const keyFields = keyFieldsFor(this.resource, this.mapping);
    if (keyFields.length !== 1) {
      throw dbError(
        'SQLITE_COMPOUND_KEY_REQUIRES_EXPLICIT_KEY',
        `Cannot generate an id for "${this.resource.name}" because it uses a compound SQLite key.`,
        {
          status: 400,
          hint: `Provide all key fields explicitly: ${keyFields.join(', ')}.`,
          details: {
            resource: this.resource.name,
            keyFields,
          },
        },
      );
    }
    const idField = keyFields[0];
    const rows = await sqliteAll(this.database, `SELECT ${quoteIdentifier(columnFor(this.mapping, idField))} as id FROM ${this.table}`);
    const ids = rows.map((row) => String(row.id)).filter(Boolean);
    const numeric = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    let next = numeric.length > 0 ? Math.max(...numeric) + 1 : ids.length + 1;

    while (ids.includes(String(next))) {
      next += 1;
    }

    return String(next);
  }

  private assertWritable(operation: string): void {
    if (!this.readOnly) {
      return;
    }

    throw dbError(
      'SQLITE_TABLE_READ_ONLY',
      `Cannot ${operation} "${this.resource.name}" because the SQLite table mapping is read-only.`,
      {
        status: 405,
        hint: 'Keep this resource as a read model or remove readOnly after confirming the underlying SQLite table supports writes.',
        details: {
          resource: this.resource.name,
          table: this.mapping.table,
          operation,
        },
      },
    );
  }

  private assertMutable(operation: string): void {
    if (this.resource.writePolicy !== 'append-only') {
      return;
    }
    throw dbError(
      'SQLITE_APPEND_ONLY_RESOURCE',
      `Cannot ${operation} "${this.resource.name}" because it is append-only.`,
      {
        status: 405,
        hint: `Use db.table("${this.resource.name}").append(record) for append-only SQLite resources.`,
        details: {
          resource: this.resource.name,
          table: this.mapping.table,
          operation,
          writePolicy: this.resource.writePolicy,
        },
      },
    );
  }
}

export class SqliteDbDocument {
  config: SqliteConfig;
  resource: SqliteResource;
  database: SqliteDatabase;
  readOnly: boolean;

  constructor(
    config: SqliteConfig,
    resource: SqliteResource,
    database: SqliteDatabase,
    options: { readOnly?: boolean } = {},
  ) {
    this.config = config;
    this.resource = resource;
    this.database = database;
    this.readOnly = options.readOnly === true;
  }

  async all(): Promise<Record<string, unknown>> {
    const row = await sqliteGet(this.database, 'SELECT value FROM "_db_documents" WHERE name = ?', this.resource.name);
    return row ? JSON.parse(String(row.value)) : {};
  }

  async get(path: JsonPath = ''): Promise<unknown> {
    const document = await this.all();
    return Array.isArray(path) || path ? getPointer(document, path) : document;
  }

  async put(value: unknown): Promise<Record<string, unknown>> {
    this.assertWritable('put');
    const nextDocument = stripUnknownFields(this.resource, value);
    assertRecordMatchesResource(nextDocument, this.resource, this.config, {
      source: `${this.resource.name} document body`,
    });
    await sqliteRun(
      this.database,
      'INSERT INTO "_db_documents" (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value',
      this.resource.name,
      JSON.stringify(nextDocument),
    );
    return nextDocument;
  }

  async set(path: JsonPath, value: unknown): Promise<unknown> {
    this.assertWritable('set');
    const document = await this.all();
    setPointer(document, path, value);
    const nextDocument = await this.put(document);
    return getPointer(nextDocument, path);
  }

  async update(patch: unknown): Promise<Record<string, unknown>> {
    this.assertWritable('update');
    const document = await this.all();
    return this.put({ ...document, ...(isRecord(patch) ? patch : {}) });
  }

  private assertWritable(operation: string): void {
    if (!this.readOnly) {
      return;
    }

    throw dbError(
      'SQLITE_TABLE_READ_ONLY',
      `Cannot ${operation} "${this.resource.name}" because the SQLite database was opened read-only.`,
      {
        status: 405,
        hint: 'Open the SQLite integration without readOnly when document writes should be allowed.',
        details: {
          resource: this.resource.name,
          operation,
        },
      },
    );
  }
}

async function sqliteStatement(database: SqliteDatabase, sql: string): Promise<SqliteStatement> {
  return await database.prepare(sql);
}

async function sqliteGet(database: SqliteDatabase, sql: string, ...values: unknown[]): Promise<SqliteRow | undefined> {
  return await (await sqliteStatement(database, sql)).get(...values);
}

async function sqliteAll(database: SqliteDatabase, sql: string, ...values: unknown[]): Promise<SqliteRow[]> {
  return await (await sqliteStatement(database, sql)).all(...values);
}

async function sqliteRun(database: SqliteDatabase, sql: string, ...values: unknown[]): Promise<SqliteRunResult> {
  return await (await sqliteStatement(database, sql)).run(...values);
}

function createTableSql(resource: SqliteResource): string {
  const keyFields = identityForResource(resource).fields;
  const singleKey = keyFields.length === 1 ? keyFields[0] : null;
  const columns = Object.entries(resource.fields).map(([fieldName, field]) => {
    const primary = fieldName === singleKey ? ' PRIMARY KEY' : '';
    const required = (field.required || keyFields.includes(fieldName)) && fieldName !== singleKey ? ' NOT NULL' : '';
    return `  ${quoteIdentifier(fieldName)} ${sqliteTypeForField(field)}${primary}${required}`;
  });
  if (keyFields.length > 1) {
    columns.push(`  PRIMARY KEY (${keyFields.map(quoteIdentifier).join(', ')})`);
  }

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(resource.name)} (
${columns.join(',\n')}
) STRICT;`;
}

function sqliteTypeForField(field: SchemaField): string {
  switch (field.type) {
    case 'number':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    case 'string':
    case 'datetime':
    case 'enum':
    case 'bytes':
    case 'object':
    case 'array':
    case 'unknown':
    default:
      return 'TEXT';
  }
}

function stripUnknownFields(resource: SqliteResource, record: unknown): Record<string, unknown> {
  const source = isRecord(record) ? record : {};
  const next: Record<string, unknown> = {};
  for (const fieldName of Object.keys(resource.fields ?? {})) {
    if (source[fieldName] !== undefined) {
      next[fieldName] = source[fieldName];
    }
  }
  return next;
}

function serializeRow(resource: SqliteResource, record: Record<string, unknown>): Record<string, SqliteValue> {
  const row: Record<string, SqliteValue> = {};
  for (const [fieldName, field] of Object.entries(resource.fields)) {
    row[fieldName] = serializeValue(field, record[fieldName]);
  }
  return row;
}

function serializeValue(field: SchemaField | undefined, value: unknown): SqliteValue {
  if (value === undefined) {
    return null;
  }
  if (field?.type === 'boolean') {
    return value ? 1 : 0;
  }
  if (field?.type === 'object' || field?.type === 'array' || field?.type === 'unknown') {
    return JSON.stringify(value);
  }
  return value as SqliteValue;
}

function deserializeRow(resource: SqliteResource, row: SqliteRow): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [fieldName, field] of Object.entries(resource.fields)) {
    const value = row[fieldName];
    if (value === null || value === undefined) {
      continue;
    }
    if (field.type === 'boolean') {
      record[fieldName] = Boolean(value);
    } else if (field.type === 'object' || field.type === 'array' || field.type === 'unknown') {
      record[fieldName] = typeof value === 'string' ? JSON.parse(value) : value;
    } else {
      record[fieldName] = value;
    }
  }
  return record;
}

function deserializeMappedRow(resource: SqliteResource, row: SqliteRow, mapping: NormalizedTableMapping): Record<string, unknown> {
  const mappedRow: SqliteRow = {};
  for (const fieldName of Object.keys(resource.fields)) {
    mappedRow[fieldName] = row[columnFor(mapping, fieldName)];
  }
  return deserializeRow(resource, mappedRow);
}

function defaultTableMapping(resource: SqliteResource): NormalizedTableMapping {
  return {
    table: resource.name,
    columns: {},
    primaryKey: identityForResource(resource).fields,
    readOnly: false,
  };
}

function columnFor(mapping: NormalizedTableMapping, field: string): string {
  return mapping.columns[field] ?? field;
}

function keyFieldsFor(resource: SqliteResource, mapping: NormalizedTableMapping): string[] {
  if (mapping.primaryKey.length > 0) {
    return mapping.primaryKey;
  }
  return identityForResource(resource).fields;
}

function resourceWithMappingIdentity(resource: SqliteResource, mapping: NormalizedTableMapping): SqliteResource {
  const fields = keyFieldsFor(resource, mapping);
  return {
    ...resource,
    idField: fields.length === 1 ? fields[0] : undefined,
    identity: { fields },
  };
}

function keyPredicate(
  resource: SqliteResource,
  mapping: NormalizedTableMapping,
  key: unknown,
): { where: string; values: SqliteValue[] } {
  const keyFields = keyFieldsFor(resource, mapping);
  const keyRecord = keyRecordFor(resource, keyFields, key);
  return {
    where: keyFields.map((field) => `${quoteIdentifier(columnFor(mapping, field))} = ?`).join(' AND '),
    values: keyFields.map((field) => serializeValue(resource.fields[field], keyRecord[field])),
  };
}

function keyRecordFor(resource: SqliteResource, keyFields: string[], key: unknown): Record<string, unknown> {
  if (keyFields.length === 1) {
    const field = keyFields[0];
    if (isRecord(key) && key[field] !== undefined) {
      return { [field]: key[field] };
    }
    if (key === undefined || key === null || key === '') {
      throw missingKeyError(resource, keyFields);
    }
    return { [field]: key };
  }

  if (!isRecord(key)) {
    throw missingKeyError(resource, keyFields);
  }

  const missing = keyFields.filter((field) => key[field] === undefined || key[field] === null || key[field] === '');
  if (missing.length > 0) {
    throw missingKeyError(resource, keyFields, missing);
  }

  return Object.fromEntries(keyFields.map((field) => [field, key[field]]));
}

function assertCompoundKeyPresent(resource: SqliteResource, keyFields: string[], record: Record<string, unknown>): void {
  const missing = keyFields.filter((field) => record[field] === undefined || record[field] === null || record[field] === '');
  if (missing.length === 0) {
    return;
  }
  throw missingKeyError(resource, keyFields, missing);
}

function missingKeyError(resource: SqliteResource, keyFields: string[], missing: string[] = keyFields): Error {
  return dbError(
    'SQLITE_KEY_REQUIRED',
    `SQLite resource "${resource.name}" requires key field${keyFields.length === 1 ? '' : 's'} ${keyFields.join(', ')}.`,
    {
      status: 400,
      hint: keyFields.length === 1
        ? `Pass a value for "${keyFields[0]}".`
        : `Pass an object key such as { ${keyFields.map((field) => `${field}: ...`).join(', ')} }.`,
      details: {
        resource: resource.name,
        keyFields,
        missing,
      },
    },
  );
}

async function importNodeSqlite(): Promise<{ DatabaseSync: DatabaseSyncConstructor }> {
  try {
    return await suppressNodeSqliteExperimentalWarningAsync(
      async () => await import('node:sqlite') as unknown as { DatabaseSync: DatabaseSyncConstructor },
    );
  } catch (error) {
    throw sqliteRuntimeUnavailableError(error);
  }
}

function importNodeSqliteSync(): { DatabaseSync: DatabaseSyncConstructor } {
  try {
    return suppressNodeSqliteExperimentalWarning(
      () => require('node:sqlite') as { DatabaseSync: DatabaseSyncConstructor },
    );
  } catch (error) {
    throw sqliteRuntimeUnavailableError(error);
  }
}

function sqliteRuntimeUnavailableError(error: unknown): Error {
  const runtimeError = error as Error;
  return dbError(
    'SQLITE_RUNTIME_UNAVAILABLE',
    'SQLite store requires Node.js with node:sqlite support.',
    {
      status: 500,
      hint: 'Use Node.js 22.13 or newer for the SQLite store, or keep using the JSON store.',
      details: {
        parserMessage: runtimeError.message,
      },
    },
  );
}

function quoteIdentifier(value: unknown): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
