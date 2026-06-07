import { dbError } from '../errors.js';
import { loadConfig } from '../config.js';
import { resolveResource, resourceAliasCollisionGroups } from '../names.js';
import { assertRecordMatchesResource, loadProjectSchema } from '../schema.js';
import { applyDefaultsToRecord } from '../sync.js';
import type { SchemaField } from '../features/schema/fields.js';
import { getPointer, setPointer, type JsonPath } from '../features/runtime/json-pointer.js';
import {
  aggregateCollectionRecords,
  applyCollectionQuery,
  countCollectionRecords,
  type CollectionAggregate,
  type CollectionQuery,
} from '../features/runtime/query.js';
import {
  createResourceWriteQueue,
  hydrateJsonResourceStore,
  closeInjectedClient,
} from '../features/storage/resource-json.js';

export type PostgresQueryResult = {
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
};

export type PostgresClient = {
  query(sql: string, params?: unknown[]): PostgresQueryResult | Promise<PostgresQueryResult>;
  close?: () => unknown | Promise<unknown>;
  end?: () => unknown | Promise<unknown>;
};

export type PostgresStoreOptions = {
  client?: PostgresClient | null;
  schema?: string;
  table?: string;
  namespace?: string;
  migrate?: boolean;
  close?: boolean | ((client: PostgresClient | null | undefined) => unknown | Promise<unknown>);
};

type RuntimeConfig = Record<string, unknown>;

type PostgresRuntimeConfig = RuntimeConfig & {
  defaults?: {
    applyOnCreate?: boolean;
  };
};

type RuntimeResource = {
  name: string;
  kind?: string;
  idField?: string;
  dataHash?: string | null;
  writePolicy?: string;
  fields?: Record<string, SchemaField>;
  [key: string]: unknown;
};

type PostgresResource = RuntimeResource & {
  kind: 'collection' | 'document' | string;
  fields: Record<string, SchemaField>;
};

type PostgresProject = {
  resources: PostgresResource[];
};

export type PostgresTableMapping = {
  schema?: string;
  table?: string;
  columns?: Record<string, string>;
  primaryKey?: string | string[];
  readOnly?: boolean;
};

type NormalizedPostgresTableMapping = {
  schema?: string;
  table: string;
  columns: Record<string, string>;
  primaryKey: string[];
  readOnly: boolean;
};

export type OpenPostgresOptions = Record<string, unknown> & {
  project?: PostgresProject;
  client?: PostgresClient;
  open?: (options: { readOnly: boolean }) => PostgresClient | Promise<PostgresClient>;
  closeClient?: boolean;
  schema?: string;
  schemas?: string[];
  tables?: Record<string, string | PostgresTableMapping>;
  migrate?: boolean;
  readOnly?: boolean;
};

type RuntimeEnvelope = {
  kind?: string;
  sourceHash?: string | null;
  value: unknown;
};

type StoreFactoryContext = {
  config: RuntimeConfig;
  storeName: string;
};

type ResourceWriteOperation<T> = () => T | Promise<T>;

type ResourceKind = 'collection' | 'document';

export async function openPostgresDb(options: OpenPostgresOptions = {}): Promise<PostgresDb> {
  const config = await loadConfig(options) as PostgresRuntimeConfig;
  const project = options.project ?? await loadProjectSchema(config) as PostgresProject;
  const readOnly = options.readOnly === true;
  const client = options.client ?? await options.open?.({ readOnly });
  assertPostgresDbClient(client);
  const tableMappings = normalizePostgresTableMappings(project.resources, options.tables ?? {}, options.schema);

  if (options.migrate !== false && !readOnly) {
    await migratePostgresDbInternal(client, project.resources, tableMappings, options.schema ?? 'public');
  }

  return new PostgresDb(config, project.resources, client, {
    tableMappings,
    readOnly,
    closeClient: options.closeClient === true,
  });
}

export const postgresStoreCapabilities = {
  writable: true,
  persistence: 'postgres',
  atomicity: 'resource',
  liveEvents: true,
  staticExport: false,
  production: 'small-app',
};

export function postgresStore(options: PostgresStoreOptions = {}) {
  const {
    client,
    schema = 'public',
    table = '_async_db_resources',
    namespace = 'default',
    migrate = true,
    close = false,
  } = options;
  const withQueuedWrite = createResourceWriteQueue();
  let migrated = false;

  return ({ config, storeName }: StoreFactoryContext) => {
    assertPostgresClient(client, storeName);
    const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

    async function ensureMigrated(): Promise<void> {
      if (!migrate || migrated) {
        return;
      }

      if (schema !== 'public') {
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
      }
      await client.query(`CREATE TABLE IF NOT EXISTS ${qualifiedTable} (
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_hash TEXT,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (namespace, name)
)`);
      migrated = true;
    }

    async function readEnvelope(resource: RuntimeResource): Promise<RuntimeEnvelope | null> {
      await ensureMigrated();
      const result = await client.query(
        `SELECT kind, source_hash, value FROM ${qualifiedTable} WHERE namespace = $1 AND name = $2`,
        [namespace, resource.name],
      );
      const row = result?.rows?.[0];
      if (!row) {
        return null;
      }
      return {
        kind: String(row.kind),
        sourceHash: typeof row.source_hash === 'string' ? row.source_hash : null,
        value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
      };
    }

    async function writeEnvelope(resource: RuntimeResource, envelope: RuntimeEnvelope): Promise<void> {
      await ensureMigrated();
      await client.query(
        `INSERT INTO ${qualifiedTable} (namespace, name, kind, source_hash, value, updated_at)
VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
ON CONFLICT (namespace, name) DO UPDATE SET
  kind = EXCLUDED.kind,
  source_hash = EXCLUDED.source_hash,
  value = EXCLUDED.value,
  updated_at = CURRENT_TIMESTAMP`,
        [
          namespace,
          resource.name,
          envelope.kind,
          envelope.sourceHash ?? null,
          JSON.stringify(envelope.value),
        ],
      );
    }

    return {
      name: storeName,
      capabilities: postgresStoreCapabilities,
      async hydrate(resources: RuntimeResource[]) {
        await ensureMigrated();
        for (const resource of resources) {
          await hydrateJsonResourceStore({
            config,
            resource,
            readEnvelope,
            writeEnvelope,
          });
        }
      },
      async readResource(resource: RuntimeResource, fallback: unknown) {
        const envelope = await readEnvelope(resource);
        return envelope ? envelope.value : fallback;
      },
      async writeResource(resource: RuntimeResource, value: unknown) {
        await writeEnvelope(resource, {
          kind: resource.kind,
          sourceHash: resource.dataHash ?? null,
          value,
        });
      },
      withResourceWrite<T>(resource: RuntimeResource, operation: ResourceWriteOperation<T>) {
        return withQueuedWrite(`${namespace}:${resource.name}`, operation);
      },
      close() {
        return closeInjectedClient(client, close);
      },
    };
  };
}

export class PostgresDb {
  config: PostgresRuntimeConfig;
  resources: Map<string, PostgresResource>;
  client: PostgresClient;
  tableMappings: Map<string, NormalizedPostgresTableMapping>;
  readOnly: boolean;
  closeClient: boolean;

  constructor(
    config: PostgresRuntimeConfig,
    resources: PostgresResource[],
    client: PostgresClient,
    options: {
      tableMappings?: Map<string, NormalizedPostgresTableMapping>;
      readOnly?: boolean;
      closeClient?: boolean;
    } = {},
  ) {
    this.config = config;
    this.resources = new Map(resources.map((resource) => [resource.name, resource]));
    assertNoResourceAliasCollisions(this.resources);
    this.client = client;
    this.tableMappings = options.tableMappings ?? new Map();
    this.readOnly = options.readOnly === true;
    this.closeClient = options.closeClient === true;
  }

  collection(name: string): PostgresDbCollection {
    const resource = this.requireResource(name, 'collection');
    return new PostgresDbCollection(this.config, resource, this.client, {
      mapping: this.tableMappingFor(resource),
      readOnly: this.readOnly,
    });
  }

  table(name: string): PostgresDbCollection {
    return this.collection(name);
  }

  document(name: string): PostgresDbDocument {
    const resource = this.requireResource(name, 'document');
    return new PostgresDbDocument(this.config, resource, this.client, {
      readOnly: this.readOnly,
    });
  }

  resourceNames(): string[] {
    return [...this.resources.keys()];
  }

  async close(): Promise<void> {
    if (!this.closeClient) {
      return;
    }
    const close = this.client.end ?? this.client.close;
    if (typeof close === 'function') {
      await close.call(this.client);
    }
  }

  requireResource(name: string, kind: ResourceKind): PostgresResource {
    const { resource, candidates } = resolveResource(this.resources, name);
    if (!resource) {
      throw dbError(
        'POSTGRES_UNKNOWN_RESOURCE',
        `Unknown Postgres db resource "${name}".`,
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
        'POSTGRES_RESOURCE_KIND_MISMATCH',
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

  private tableMappingFor(resource: PostgresResource): NormalizedPostgresTableMapping {
    return this.tableMappings.get(resource.name) ?? defaultTableMapping(resource);
  }
}

export class PostgresDbCollection {
  config: PostgresRuntimeConfig;
  resource: PostgresResource;
  client: PostgresClient;
  mapping: NormalizedPostgresTableMapping;
  readOnly: boolean;
  table: string;

  constructor(
    config: PostgresRuntimeConfig,
    resource: PostgresResource,
    client: PostgresClient,
    options: {
      mapping?: NormalizedPostgresTableMapping;
      readOnly?: boolean;
    } = {},
  ) {
    this.config = config;
    this.resource = resource;
    this.client = client;
    this.mapping = options.mapping ?? defaultTableMapping(resource);
    this.readOnly = options.readOnly === true || this.mapping.readOnly;
    this.table = quoteQualifiedIdentifier(this.mapping);
  }

  async all(): Promise<Record<string, unknown>[]> {
    const result = await this.client.query(`SELECT * FROM ${this.table}`);
    return (result.rows ?? []).map((row) => deserializeMappedRow(this.resource, row, this.mapping));
  }

  async get(id: unknown): Promise<Record<string, unknown> | null> {
    const key = keyPredicate(this.resource, this.mapping, id);
    const result = await this.client.query(`SELECT * FROM ${this.table} WHERE ${key.where}`, key.values);
    const row = result.rows?.[0];
    return row ? deserializeMappedRow(this.resource, row, this.mapping) : null;
  }

  async exists(id: unknown): Promise<boolean> {
    const key = keyPredicate(this.resource, this.mapping, id);
    const result = await this.client.query(`SELECT 1 as found FROM ${this.table} WHERE ${key.where}`, key.values);
    return Boolean(result.rows?.[0]);
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
    return this.createWithOperation(record, 'create');
  }

  async append(record: unknown): Promise<Record<string, unknown>> {
    return this.createWithOperation(record, 'append');
  }

  private async createWithOperation(record: unknown, operation: 'create' | 'append'): Promise<Record<string, unknown>> {
    this.assertWritable(operation);
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
      nextRecord[keyFields[0]] = await this.nextId();
    }
    if (keyFields.length > 1) {
      assertCompoundKeyPresent(this.resource, keyFields, nextRecord);
    }

    assertRecordMatchesResource(nextRecord, this.resource, this.config, {
      source: `${this.resource.name} ${operation} body`,
    });

    const serialized = serializeRow(this.resource, nextRecord);
    const columns = fields.map((field) => quoteIdentifier(columnFor(this.mapping, field))).join(', ');
    const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    try {
      await this.client.query(
        `INSERT INTO ${this.table} (${columns}) VALUES (${placeholders})`,
        fields.map((field) => serialized[field] ?? null),
      );
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw dbError(
          'POSTGRES_DUPLICATE_ID',
          `Cannot create "${this.resource.name}" record because the Postgres key already exists.`,
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

    assertRecordMatchesResource(nextRecord, this.resource, this.config, {
      source: `${this.resource.name} patch body`,
    });

    const fields = Object.keys(this.resource.fields).filter((field) => !keyFields.includes(field));
    const serialized = serializeRow(this.resource, nextRecord);
    const assignments = fields.map((field, index) => `${quoteIdentifier(columnFor(this.mapping, field))} = $${index + 1}`).join(', ');
    const key = keyPredicate(this.resource, this.mapping, existing, fields.length + 1);
    await this.client.query(
      `UPDATE ${this.table} SET ${assignments} WHERE ${key.where}`,
      [
        ...fields.map((field) => serialized[field] ?? null),
        ...key.values,
      ],
    );
    return nextRecord;
  }

  async delete(id: unknown): Promise<boolean> {
    this.assertWritable('delete');
    this.assertMutable('delete');
    const key = keyPredicate(this.resource, this.mapping, id);
    const result = await this.client.query(`DELETE FROM ${this.table} WHERE ${key.where}`, key.values);
    return Number(result.rowCount ?? 0) > 0;
  }

  async nextId(): Promise<string> {
    const keyFields = keyFieldsFor(this.resource, this.mapping);
    if (keyFields.length !== 1) {
      throw dbError(
        'POSTGRES_COMPOUND_KEY_REQUIRES_EXPLICIT_KEY',
        `Cannot generate an id for "${this.resource.name}" because it uses a compound Postgres key.`,
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
    const result = await this.client.query(`SELECT ${quoteIdentifier(columnFor(this.mapping, idField))} as id FROM ${this.table}`);
    const ids = (result.rows ?? []).map((row) => String(row.id)).filter(Boolean);
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
      'POSTGRES_TABLE_READ_ONLY',
      `Cannot ${operation} "${this.resource.name}" because the Postgres table mapping is read-only.`,
      {
        status: 405,
        hint: 'Keep this resource as a read model or remove readOnly after confirming the underlying Postgres table supports writes.',
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
      'POSTGRES_APPEND_ONLY_RESOURCE',
      `Cannot ${operation} "${this.resource.name}" because it is append-only.`,
      {
        status: 405,
        hint: `Use db.table("${this.resource.name}").append(record) for append-only Postgres resources.`,
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

export class PostgresDbDocument {
  config: PostgresRuntimeConfig;
  resource: PostgresResource;
  client: PostgresClient;
  readOnly: boolean;

  constructor(
    config: PostgresRuntimeConfig,
    resource: PostgresResource,
    client: PostgresClient,
    options: { readOnly?: boolean } = {},
  ) {
    this.config = config;
    this.resource = resource;
    this.client = client;
    this.readOnly = options.readOnly === true;
  }

  async all(): Promise<Record<string, unknown>> {
    const result = await this.client.query('SELECT value FROM "_db_documents" WHERE name = $1', [this.resource.name]);
    const value = result.rows?.[0]?.value;
    if (value === undefined || value === null) {
      return {};
    }
    return typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
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
    await this.client.query(
      `INSERT INTO "_db_documents" (name, value) VALUES ($1, $2)
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
      [this.resource.name, JSON.stringify(nextDocument)],
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
      'POSTGRES_TABLE_READ_ONLY',
      `Cannot ${operation} "${this.resource.name}" because the Postgres database was opened read-only.`,
      {
        status: 405,
        hint: 'Open the Postgres integration without readOnly when document writes should be allowed.',
        details: {
          resource: this.resource.name,
          operation,
        },
      },
    );
  }
}

async function migratePostgresDbInternal(
  client: PostgresClient,
  resources: PostgresResource[],
  tableMappings: Map<string, NormalizedPostgresTableMapping>,
  schema: string,
): Promise<void> {
  if (schema !== 'public') {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
  }
  for (const resource of resources) {
    if (resource.kind === 'collection' && !tableMappings.has(resource.name)) {
      await client.query(createTableSql(resource, schema));
    }
  }
  await client.query(`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(schema)}."_db_documents" (
    "name" TEXT PRIMARY KEY,
    "value" JSONB NOT NULL
  )`);
}

function createTableSql(resource: PostgresResource, schema: string): string {
  const columns = Object.entries(resource.fields).map(([fieldName, field]) => {
    const primary = fieldName === resource.idField ? ' PRIMARY KEY' : '';
    const required = field.required && fieldName !== resource.idField ? ' NOT NULL' : '';
    return `  ${quoteIdentifier(fieldName)} ${postgresTypeForField(field)}${primary}${required}`;
  });

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(schema)}.${quoteIdentifier(resource.name)} (
${columns.join(',\n')}
)`;
}

function postgresTypeForField(field: SchemaField): string {
  switch (field.type) {
    case 'number':
      return 'DOUBLE PRECISION';
    case 'boolean':
      return 'BOOLEAN';
    case 'object':
    case 'array':
    case 'unknown':
      return 'JSONB';
    case 'string':
    case 'datetime':
    case 'enum':
    default:
      return 'TEXT';
  }
}

function normalizePostgresTableMappings(
  resources: PostgresResource[],
  mappings: Record<string, string | PostgresTableMapping>,
  defaultSchema?: string,
): Map<string, NormalizedPostgresTableMapping> {
  const normalized = new Map<string, NormalizedPostgresTableMapping>();
  for (const resource of resources) {
    const raw = mappings[resource.name];
    if (raw === undefined) {
      continue;
    }

    if (typeof raw === 'string') {
      normalized.set(resource.name, {
        ...defaultTableMapping(resource, defaultSchema),
        ...parseQualifiedTable(raw, defaultSchema),
      });
      continue;
    }

    const primaryKey = raw.primaryKey === undefined
      ? defaultTableMapping(resource, defaultSchema).primaryKey
      : Array.isArray(raw.primaryKey)
        ? raw.primaryKey
        : [raw.primaryKey];
    normalized.set(resource.name, {
      schema: raw.schema ?? defaultSchema,
      table: raw.table ?? resource.name,
      columns: raw.columns ?? {},
      primaryKey,
      readOnly: raw.readOnly === true,
    });
  }
  return normalized;
}

function defaultTableMapping(resource: PostgresResource, schema?: string): NormalizedPostgresTableMapping {
  return {
    schema,
    table: resource.name,
    columns: {},
    primaryKey: resource.idField ? [resource.idField] : ['id'],
    readOnly: false,
  };
}

function parseQualifiedTable(value: string, defaultSchema?: string): Pick<NormalizedPostgresTableMapping, 'schema' | 'table'> {
  const parts = value.split('.').filter(Boolean);
  if (parts.length >= 2) {
    return {
      schema: parts.slice(0, -1).join('.'),
      table: parts[parts.length - 1],
    };
  }
  return {
    schema: defaultSchema,
    table: value,
  };
}

function quoteQualifiedIdentifier(mapping: NormalizedPostgresTableMapping): string {
  const table = parseQualifiedTable(mapping.table, mapping.schema);
  return [table.schema, table.table].filter(Boolean).map((part) => quoteIdentifier(part as string)).join('.');
}

function columnFor(mapping: NormalizedPostgresTableMapping, field: string): string {
  return mapping.columns[field] ?? field;
}

function keyFieldsFor(resource: PostgresResource, mapping: NormalizedPostgresTableMapping): string[] {
  if (mapping.primaryKey.length > 0) {
    return mapping.primaryKey;
  }
  if (resource.idField) {
    return [resource.idField];
  }
  return ['id'];
}

function keyPredicate(
  resource: PostgresResource,
  mapping: NormalizedPostgresTableMapping,
  key: unknown,
  placeholderStart = 1,
): { where: string; values: PostgresValue[] } {
  const keyFields = keyFieldsFor(resource, mapping);
  const keyRecord = keyRecordFor(resource, keyFields, key);
  return {
    where: keyFields.map((field, index) => `${quoteIdentifier(columnFor(mapping, field))} = $${placeholderStart + index}`).join(' AND '),
    values: keyFields.map((field) => serializeValue(resource.fields[field], keyRecord[field])),
  };
}

function keyRecordFor(resource: PostgresResource, keyFields: string[], key: unknown): Record<string, unknown> {
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

function assertCompoundKeyPresent(resource: PostgresResource, keyFields: string[], record: Record<string, unknown>): void {
  const missing = keyFields.filter((field) => record[field] === undefined || record[field] === null || record[field] === '');
  if (missing.length === 0) {
    return;
  }
  throw missingKeyError(resource, keyFields, missing);
}

function missingKeyError(resource: PostgresResource, keyFields: string[], missing: string[] = keyFields): Error {
  return dbError(
    'POSTGRES_KEY_REQUIRED',
    `Postgres resource "${resource.name}" requires key field${keyFields.length === 1 ? '' : 's'} ${keyFields.join(', ')}.`,
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

type PostgresValue = string | number | boolean | bigint | Record<string, unknown> | unknown[] | null;

function stripUnknownFields(resource: PostgresResource, record: unknown): Record<string, unknown> {
  const source = isRecord(record) ? record : {};
  const next: Record<string, unknown> = {};
  for (const fieldName of Object.keys(resource.fields ?? {})) {
    if (source[fieldName] !== undefined) {
      next[fieldName] = source[fieldName];
    }
  }
  return next;
}

function serializeRow(resource: PostgresResource, record: Record<string, unknown>): Record<string, PostgresValue> {
  const row: Record<string, PostgresValue> = {};
  for (const [fieldName, field] of Object.entries(resource.fields)) {
    row[fieldName] = serializeValue(field, record[fieldName]);
  }
  return row;
}

function serializeValue(field: SchemaField | undefined, value: unknown): PostgresValue {
  if (value === undefined) {
    return null;
  }
  if (field?.type === 'object' || field?.type === 'array' || field?.type === 'unknown') {
    return isRecord(value) || Array.isArray(value) ? value : value == null ? null : JSON.parse(String(value));
  }
  return value as PostgresValue;
}

function deserializeMappedRow(
  resource: PostgresResource,
  row: Record<string, unknown>,
  mapping: NormalizedPostgresTableMapping,
): Record<string, unknown> {
  const mappedRow: Record<string, unknown> = {};
  for (const fieldName of Object.keys(resource.fields)) {
    mappedRow[fieldName] = row[columnFor(mapping, fieldName)];
  }
  return deserializeRow(resource, mappedRow);
}

function deserializeRow(resource: PostgresResource, row: Record<string, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [fieldName, field] of Object.entries(resource.fields)) {
    const value = row[fieldName];
    if (value === null || value === undefined) {
      continue;
    }
    if (field.type === 'object' || field.type === 'array' || field.type === 'unknown') {
      record[fieldName] = typeof value === 'string' ? JSON.parse(value) : value;
    } else {
      record[fieldName] = value;
    }
  }
  return record;
}

function assertNoResourceAliasCollisions(resources: Map<string, PostgresResource>): void {
  const collisions = resourceAliasCollisionGroups(resources);
  if (collisions.length === 0) {
    return;
  }

  const collision = collisions[0];
  throw dbError(
    'POSTGRES_RESOURCE_ALIAS_COLLISION',
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

function assertPostgresDbClient(client: PostgresClient | null | undefined): asserts client is PostgresClient {
  if (client && typeof client.query === 'function') {
    return;
  }

  throw dbError(
    'POSTGRES_DB_CLIENT_REQUIRED',
    'Postgres table integration requires an injected client with query(sql, params).',
    {
      status: 500,
      hint: 'Pass a pg Pool, pg Client, or compatible object to openPostgresDb({ client }).',
    },
  );
}

function assertPostgresClient(client: PostgresClient | null | undefined, storeName: string): asserts client is PostgresClient {
  if (client && typeof client.query === 'function') {
    return;
  }

  throw dbError(
    'POSTGRES_STORE_CLIENT_REQUIRED',
    `Postgres store "${storeName}" requires an injected client with query(sql, params).`,
    {
      status: 500,
      hint: 'Pass a pg Pool, pg Client, or compatible object to postgresStore({ client }).',
      details: {
        store: storeName,
      },
    },
  );
}

function listChoices(choices: string[]): string {
  return choices.length === 0 ? '(none)' : choices.join(', ');
}

function quoteIdentifier(value: string): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === '23505'
    || String((error as Error).message ?? '').toLowerCase().includes('unique');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
