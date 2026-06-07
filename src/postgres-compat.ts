import { createRequire } from 'node:module';
import { dbError } from './errors.js';
import { openDb } from './db.js';
import { openPostgresDb, postgresStore, type PostgresClient, type PostgresQueryResult, type PostgresTableMapping } from './integrations/postgres.js';
import { sqliteStore } from './integrations/sqlite.js';

const require = createRequire(import.meta.url);

export type PostgresCompatDriver =
  | 'pg'
  | 'postgres'
  | '@neondatabase/serverless'
  | '@vercel/postgres'
  | 'pg-promise'
  | 'auto';

export type PostgresCompatibleClient = PostgresClient;

export type PostgresCompatOpenOptions = {
  driver?: PostgresCompatDriver;
  connectionString?: string;
  connectionStringEnv?: string;
  ssl?: unknown;
  readOnly?: boolean;
};

export type PostgresLegacyOpenOptions = PostgresCompatOpenOptions & {
  cwd?: string;
  schemas?: string[];
  tables?: Record<string, string | PostgresTableMapping>;
  project?: {
    resources: Array<Record<string, unknown>>;
  };
  client?: unknown;
  closeClient?: boolean;
  migrate?: false;
};

export type PostgresImportKeyStrategy =
  | { kind: 'single-primary-key'; field: string }
  | { kind: 'compound-generated-id'; fields: string[]; idField: string }
  | { kind: 'key-value-document'; keyField: string; valueField: string }
  | { kind: 'append-only'; idField?: string };

export type PostgresImportResource = {
  resource: string;
  table: string;
  schema?: string;
  kind: 'collection' | 'document';
  importKind: 'collection' | 'document' | 'append-only';
  columns?: Record<string, string>;
  primaryKey?: string[];
  idField?: string;
  writePolicy?: 'append-only';
  fields?: Record<string, Record<string, unknown>>;
  keyStrategy: PostgresImportKeyStrategy;
  batchSize?: number;
  estimatedRows?: number | null;
  warnings?: string[];
};

export type PostgresImportPlan = {
  version: 1;
  kind: 'postgres.importPlan';
  source: {
    connectionStringEnv: string;
    driver?: PostgresCompatDriver | null;
    schemas?: string[];
  };
  target:
    | {
      kind: 'postgres-envelope';
      connectionStringEnv: string;
      driver?: PostgresCompatDriver | null;
      schema: string;
      table: string;
      namespace?: string;
    }
    | {
      kind: 'sqlite-state';
      stateFile: string;
    };
  resources: PostgresImportResource[];
  batchSize?: number;
  warnings?: string[];
};

export type PostgresImportResult = {
  applied: boolean;
  resources: Array<{
    resource: string;
    table: string;
    rows: number;
    kind: string;
  }>;
};

export function adaptPostgresClient(
  client: unknown,
  options: { driver?: PostgresCompatDriver } = {},
): PostgresCompatibleClient {
  const driver = options.driver ?? 'auto';
  if (isQueryClient(client)) {
    return {
      query(sql, params = []) {
        return normalizeQueryResult(client.query(sql, params));
      },
      ...(client as Record<string, unknown>),
    };
  }
  if (driver === 'postgres' || typeof client === 'function' || typeof (client as { unsafe?: unknown } | null)?.unsafe === 'function') {
    return adaptPostgresJsClient(client);
  }
  if (driver === 'pg-promise' || typeof (client as { any?: unknown } | null)?.any === 'function') {
    return adaptPgPromiseClient(client);
  }
  throw dbError(
    'POSTGRES_COMPAT_UNSUPPORTED_CLIENT',
    'Unsupported Postgres client handle.',
    {
      status: 400,
      hint: 'Pass a pg-compatible client, postgres.js sql function, pg-promise db, Neon pool, or Vercel Postgres client.',
      details: {
        driver,
      },
    },
  );
}

export async function openCompatPostgres(options: PostgresCompatOpenOptions = {}): Promise<PostgresCompatibleClient> {
  const driver = options.driver && options.driver !== 'auto' ? options.driver : 'pg';
  const connectionString = resolveConnectionString(options);

  if (driver === 'pg' || driver === '@neondatabase/serverless') {
    try {
      const module = require(driver);
      const Pool = module.Pool ?? module.default?.Pool;
      if (typeof Pool !== 'function') {
        throw new Error(`${driver} did not expose Pool.`);
      }
      return adaptPostgresClient(new Pool({
        connectionString,
        ...(options.ssl === undefined ? {} : { ssl: options.ssl }),
      }), { driver });
    } catch (error) {
      throw compatDriverUnavailable(driver, error);
    }
  }

  if (driver === 'postgres') {
    try {
      const module = require('postgres');
      const open = module.default ?? module;
      return adaptPostgresClient(open(connectionString, {
        ...(options.ssl === undefined ? {} : { ssl: options.ssl }),
      }), { driver });
    } catch (error) {
      throw compatDriverUnavailable(driver, error);
    }
  }

  if (driver === '@vercel/postgres') {
    try {
      const module = require('@vercel/postgres');
      const client = typeof module.db === 'function'
        ? module.db({ connectionString })
        : module.sql ?? module;
      return adaptPostgresClient(client, { driver });
    } catch (error) {
      throw compatDriverUnavailable(driver, error);
    }
  }

  if (driver === 'pg-promise') {
    try {
      const module = require('pg-promise');
      const init = module.default ?? module;
      return adaptPostgresClient(init()(connectionString), { driver });
    } catch (error) {
      throw compatDriverUnavailable(driver, error);
    }
  }

  throw compatDriverUnavailable(driver, new Error(`Unknown driver "${driver}".`));
}

export async function openLegacyPostgres(options: PostgresLegacyOpenOptions): Promise<Awaited<ReturnType<typeof openPostgresDb>>> {
  const client = options.client
    ? adaptPostgresClient(options.client, { driver: options.driver })
    : await openCompatPostgres({
      driver: options.driver,
      connectionString: options.connectionString,
      connectionStringEnv: options.connectionStringEnv,
      ssl: options.ssl,
      readOnly: options.readOnly ?? true,
    });
  return await openPostgresDb({
    cwd: options.cwd,
    client,
    closeClient: options.closeClient === true,
    migrate: false,
    readOnly: options.readOnly ?? true,
    project: options.project as never,
    tables: options.tables,
  });
}

export function compoundKeyId(fields: string[], row: Record<string, unknown>): string {
  const missing = fields.filter((field) => row[field] === undefined || row[field] === null || row[field] === '');
  if (missing.length > 0) {
    throw dbError(
      'POSTGRES_IMPORT_COMPOUND_KEY_MISSING',
      `Cannot build compound Postgres import id because ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`,
      {
        status: 400,
        hint: `Provide all compound key fields: ${fields.join(', ')}.`,
        details: {
          fields,
          missing,
        },
      },
    );
  }
  return fields.map((field) => encodeURIComponent(String(row[field]))).join('@');
}

export function definePostgresImportPlan<TPlan extends PostgresImportPlan>(plan: TPlan): TPlan {
  return plan;
}

export async function runPostgresImportPlan(
  plan: PostgresImportPlan,
  options: {
    cwd?: string;
    apply?: boolean;
    sourceDb?: unknown;
    targetDb?: unknown;
    batchSize?: number;
  } = {},
): Promise<PostgresImportResult> {
  const cwd = options.cwd ?? process.cwd();
  const resources = plan.resources.map((resource) => sourceResourceForImport(resource));
  const tables = Object.fromEntries(plan.resources.map((resource) => [
    resource.resource,
    {
      schema: resource.schema,
      table: resource.table,
      columns: resource.columns ?? {},
      primaryKey: resource.primaryKey,
      readOnly: true,
    },
  ]));
  const source = options.sourceDb
    ? options.sourceDb as Awaited<ReturnType<typeof openLegacyPostgres>>
    : await openLegacyPostgres({
      cwd,
      driver: plan.source.driver ?? undefined,
      connectionStringEnv: plan.source.connectionStringEnv,
      project: { resources },
      tables,
      readOnly: true,
    });
  const target = options.apply
    ? options.targetDb ?? await openImportTarget(cwd, plan)
    : null;
  const result: PostgresImportResult = {
    applied: options.apply === true,
    resources: [],
  };

  try {
    for (const resource of plan.resources) {
      const rows = await source.table(resource.resource).all();
      result.resources.push({
        resource: resource.resource,
        table: resource.schema ? `${resource.schema}.${resource.table}` : resource.table,
        rows: rows.length,
        kind: resource.importKind,
      });
      if (!options.apply || !target) {
        continue;
      }
      await applyImportedRows(target as never, resource, rows);
    }
  } finally {
    if (!options.sourceDb) {
      await source.close();
    }
    if (target && !options.targetDb && typeof (target as { close?: () => unknown | Promise<unknown> }).close === 'function') {
      await (target as { close: () => unknown | Promise<unknown> }).close();
    }
  }

  return result;
}

function adaptPostgresJsClient(client: unknown): PostgresCompatibleClient {
  const postgresClient = client as {
    unsafe?: (sql: string, params?: unknown[]) => unknown;
    end?: () => unknown | Promise<unknown>;
  } & ((strings: TemplateStringsArray, ...values: unknown[]) => unknown);
  return {
    query(sql, params = []) {
      if (typeof postgresClient.unsafe === 'function') {
        return normalizeQueryResult(postgresClient.unsafe(sql, params));
      }
      throw dbError(
        'POSTGRES_COMPAT_UNSAFE_REQUIRED',
        'postgres.js compat requires a client with unsafe(sql, params).',
        {
          status: 400,
          hint: 'Pass the postgres() sql function directly so Async DB can call sql.unsafe.',
        },
      );
    },
    end: postgresClient.end?.bind(postgresClient),
  };
}

function adaptPgPromiseClient(client: unknown): PostgresCompatibleClient {
  const db = client as {
    any?: (sql: string, params?: unknown[]) => unknown;
    result?: (sql: string, params?: unknown[]) => unknown;
    $pool?: { end?: () => unknown | Promise<unknown> };
  };
  return {
    async query(sql, params = []) {
      const normalizedSql = sql.trim().toUpperCase();
      if (/^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/.test(normalizedSql) && typeof db.result === 'function') {
        const result = await db.result(sql, params) as { rows?: unknown[]; rowCount?: number };
        return { rows: rowsFrom(result.rows), rowCount: result.rowCount };
      }
      const rows = await db.any?.(sql, params);
      return { rows: rowsFrom(rows) };
    },
    close: db.$pool?.end?.bind(db.$pool),
  };
}

async function normalizeQueryResult(result: unknown): Promise<PostgresQueryResult> {
  const value = await result;
  if (Array.isArray(value)) {
    return { rows: rowsFrom(value), rowCount: value.length };
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      rows: rowsFrom(record.rows),
      rowCount: typeof record.rowCount === 'number' ? record.rowCount : undefined,
    };
  }
  return { rows: [] };
}

async function openImportTarget(cwd: string, plan: PostgresImportPlan): Promise<unknown> {
  if (plan.target.kind === 'sqlite-state') {
    return await openDb({
      cwd,
      stores: {
        default: 'sqlite',
        sqlite: sqliteStore({ file: plan.target.stateFile }),
      },
    });
  }

  const client = await openCompatPostgres({
    driver: plan.target.driver ?? plan.source.driver ?? undefined,
    connectionStringEnv: plan.target.connectionStringEnv,
  });
  return await openDb({
    cwd,
    stores: {
      default: 'postgres',
      postgres: postgresStore({
        client,
        schema: plan.target.schema,
        table: plan.target.table,
        namespace: plan.target.namespace,
      }),
    },
  });
}

function sourceResourceForImport(resource: PostgresImportResource): Record<string, unknown> {
  return {
    name: resource.resource,
    kind: resource.kind === 'document' ? 'collection' : 'collection',
    idField: resource.idField ?? resource.primaryKey?.[0] ?? 'id',
    writePolicy: resource.writePolicy,
    fields: resource.fields ?? {},
  };
}

async function applyImportedRows(target: {
  collection(resource: string): {
    create(record: Record<string, unknown>): Promise<unknown>;
    append(record: Record<string, unknown>): Promise<unknown>;
  };
  document(resource: string): {
    put(record: Record<string, unknown>): Promise<unknown>;
  };
}, resource: PostgresImportResource, rows: Array<Record<string, unknown>>): Promise<void> {
  if (resource.kind === 'document' && resource.keyStrategy.kind === 'key-value-document') {
    const strategy = resource.keyStrategy;
    const document = Object.fromEntries(rows.map((row) => [
      String(row[strategy.keyField]),
      parseDocumentValue(row[strategy.valueField]),
    ]));
    await target.document(resource.resource).put(document);
    return;
  }

  const collection = target.collection(resource.resource);
  for (const row of rows) {
    const record = { ...row };
    if (resource.keyStrategy.kind === 'compound-generated-id') {
      record[resource.keyStrategy.idField] = compoundKeyId(resource.keyStrategy.fields, row);
    }
    if (resource.importKind === 'append-only') {
      await collection.append(record);
    } else {
      await collection.create(record);
    }
  }
}

function parseDocumentValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function resolveConnectionString(options: PostgresCompatOpenOptions): string {
  const envName = options.connectionStringEnv ?? 'DATABASE_URL';
  const connectionString = options.connectionString ?? process.env[envName];
  if (!connectionString) {
    throw dbError(
      'POSTGRES_CONNECTION_STRING_REQUIRED',
      `Postgres compat driver requires a connection string from ${envName}.`,
      {
        status: 400,
        hint: `Set ${envName} or pass connectionString. Reports and errors will not print the secret value.`,
        details: {
          connectionStringEnv: envName,
        },
      },
    );
  }
  return connectionString;
}

function isQueryClient(value: unknown): value is PostgresClient {
  return Boolean(value && typeof value === 'object' && typeof (value as PostgresClient).query === 'function');
}

function rowsFrom(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row))
    : [];
}

function compatDriverUnavailable(driver: PostgresCompatDriver, error: unknown): Error {
  const runtimeError = error as Error;
  return dbError(
    'POSTGRES_COMPAT_DRIVER_UNAVAILABLE',
    `Postgres compat driver "${driver}" is not available.`,
    {
      status: 500,
      hint: `Install "${driver}" in the app if you want Async DB to adapt that existing Postgres driver.`,
      details: {
        driver,
        parserMessage: redactConnectionStrings(runtimeError.message),
      },
    },
  );
}

function redactConnectionStrings(value: string): string {
  return value.replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, 'postgres://<redacted>');
}
