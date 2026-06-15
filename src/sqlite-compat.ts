import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { dbError } from './errors.js';
import { openDb } from './db.js';
import { suppressNodeSqliteExperimentalWarningAsync } from './features/sqlite/node-sqlite-warning.js';
import { openSqliteDb, sqliteStore, type SqliteDatabase, type SqliteRunResult, type SqliteStatement, type SqliteTableMapping } from './integrations/sqlite.js';

const require = createRequire(import.meta.url);

export type SqliteCompatDriver = 'node:sqlite' | 'better-sqlite3' | 'sqlite3' | 'sqlite' | 'auto';

export type SqliteCompatibleDatabase = SqliteDatabase;

export type SqliteCompatOpenOptions = {
  driver?: SqliteCompatDriver;
  file: string;
  readOnly?: boolean;
};

export type SqliteLegacyOpenOptions = SqliteCompatOpenOptions & {
  cwd?: string;
  project?: {
    resources: Array<Record<string, unknown>>;
  };
  tables?: Record<string, string | SqliteTableMapping>;
  database?: unknown;
  closeDatabase?: boolean;
};

export type SqliteImportKeyStrategy =
  | { kind: 'single-primary-key'; field: string }
  | { kind: 'compound-object-key'; fields: string[] }
  | { kind: 'compound-generated-id'; fields: string[]; idField: string }
  | { kind: 'key-value-document'; keyField: string; valueField: string }
  | { kind: 'append-only'; idField?: string };

export type SqliteImportResource = {
  resource: string;
  table: string;
  kind: 'collection' | 'document';
  importKind: 'collection' | 'document' | 'append-only';
  columns?: Record<string, string>;
  primaryKey?: string[];
  idField?: string;
  identity?: {
    fields: string[];
  };
  writePolicy?: 'append-only';
  fields?: Record<string, Record<string, unknown>>;
  keyStrategy: SqliteImportKeyStrategy;
};

export type SqliteImportPlan = {
  version: 1;
  kind: 'sqlite.importPlan';
  source: {
    sqliteFile: string;
    driver?: SqliteCompatDriver;
  };
  target: {
    stateFile: string;
  };
  resources: SqliteImportResource[];
  warnings?: string[];
};

export type SqliteImportResult = {
  applied: boolean;
  resources: Array<{
    resource: string;
    table: string;
    rows: number;
    kind: string;
  }>;
};

export function adaptSqliteDatabase(database: unknown, options: { driver?: SqliteCompatDriver } = {}): SqliteCompatibleDatabase {
  const driver = options.driver ?? 'auto';
  if (isPreparedDatabase(database)) {
    return adaptPreparedDatabase(database);
  }
  if (isDirectDatabase(database)) {
    return adaptDirectDatabase(database, driver);
  }
  throw dbError(
    'SQLITE_COMPAT_UNSUPPORTED_DATABASE',
    'Unsupported SQLite database handle.',
    {
      status: 400,
      hint: 'Pass a node:sqlite, better-sqlite3, sqlite3, or sqlite database handle.',
      details: {
        driver,
      },
    },
  );
}

export async function openCompatSqlite(options: SqliteCompatOpenOptions): Promise<SqliteCompatibleDatabase> {
  const driver = options.driver && options.driver !== 'auto' ? options.driver : 'node:sqlite';
  const readOnly = options.readOnly === true;
  if (options.file !== ':memory:') {
    await mkdir(path.dirname(options.file), { recursive: true });
  }

  if (driver === 'node:sqlite') {
    try {
      const { DatabaseSync } = await suppressNodeSqliteExperimentalWarningAsync(
        async () => await import('node:sqlite') as any,
      );
      return adaptSqliteDatabase(
        readOnly
          ? new DatabaseSync(options.file, { open: true, readOnly: true })
          : new DatabaseSync(options.file),
        { driver },
      );
    } catch (error) {
      throw compatDriverUnavailable(driver, error);
    }
  }

  if (driver === 'better-sqlite3') {
    try {
      const module = require('better-sqlite3');
      const Database = module.default ?? module;
      return adaptSqliteDatabase(new Database(options.file, { readonly: readOnly }), { driver });
    } catch (error) {
      throw compatDriverUnavailable(driver, error);
    }
  }

  if (driver === 'sqlite3') {
    try {
      const sqlite3 = require('sqlite3');
      const mode = readOnly
        ? sqlite3.OPEN_READONLY
        : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;
      const database = await new Promise((resolve, reject) => {
        const opened = new sqlite3.Database(options.file, mode, (error: Error | null) => {
          if (error) reject(error);
          else resolve(opened);
        });
      });
      return adaptSqliteDatabase(database, { driver });
    } catch (error) {
      throw compatDriverUnavailable(driver, error);
    }
  }

  if (driver === 'sqlite') {
    try {
      const sqlite = require('sqlite');
      const sqlite3 = require('sqlite3');
      const mode = readOnly
        ? sqlite3.OPEN_READONLY
        : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;
      return adaptSqliteDatabase(await sqlite.open({
        filename: options.file,
        driver: sqlite3.Database,
        mode,
      }), { driver });
    } catch (error) {
      throw compatDriverUnavailable(driver, error);
    }
  }

  throw compatDriverUnavailable(driver, new Error(`Unknown driver "${driver}".`));
}

export async function openLegacySqlite(options: SqliteLegacyOpenOptions): Promise<Awaited<ReturnType<typeof openSqliteDb>>> {
  const file = resolveSqliteFile(options.file, options.cwd);
  const database = options.database
    ? adaptSqliteDatabase(options.database, { driver: options.driver })
    : await openCompatSqlite({
      driver: options.driver,
      file,
      readOnly: options.readOnly ?? true,
    });
  return await openSqliteDb({
    cwd: options.cwd,
    file,
    database,
    closeDatabase: options.closeDatabase ?? true,
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
      'SQLITE_IMPORT_COMPOUND_KEY_MISSING',
      `Cannot build compound SQLite import id because ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`,
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

export function defineSqliteImportPlan<TPlan extends SqliteImportPlan>(plan: TPlan): TPlan {
  return plan;
}

export async function runSqliteImportPlan(
  plan: SqliteImportPlan,
  options: {
    cwd?: string;
    apply?: boolean;
    targetDb?: unknown;
  } = {},
): Promise<SqliteImportResult> {
  const cwd = options.cwd ?? process.cwd();
  const resources = plan.resources.map((resource) => sourceResourceForImport(resource));
  const tables = Object.fromEntries(plan.resources.map((resource) => [
    resource.resource,
    {
      table: resource.table,
      columns: resource.columns ?? {},
      primaryKey: resource.primaryKey,
      readOnly: true,
    },
  ]));
  const source = await openLegacySqlite({
    cwd,
    driver: plan.source.driver,
    file: plan.source.sqliteFile,
    project: { resources },
    tables,
    readOnly: true,
  });
  const target = options.apply
    ? options.targetDb ?? await openDb({
      cwd,
      stores: {
        default: 'sqlite',
        sqlite: sqliteStore({ file: plan.target.stateFile }),
      },
    })
    : null;
  const result: SqliteImportResult = {
    applied: options.apply === true,
    resources: [],
  };

  try {
    for (const resource of plan.resources) {
      const rows = await source.table(resource.resource).all();
      result.resources.push({
        resource: resource.resource,
        table: resource.table,
        rows: rows.length,
        kind: resource.importKind,
      });
      if (!options.apply || !target) {
        continue;
      }
      await applyImportedRows(target as any, resource, rows);
    }
  } finally {
    await source.close();
    if (target && !options.targetDb && typeof (target as any).close === 'function') {
      await (target as any).close();
    }
  }

  return result;
}

function adaptPreparedDatabase(database: any): SqliteCompatibleDatabase {
  return {
    exec(sql) {
      return database.exec(sql);
    },
    prepare(sql) {
      const prepared = database.prepare(sql);
      return isPromiseLike(prepared)
        ? prepared.then((statement: unknown) => adaptStatement(statement))
        : adaptStatement(prepared);
    },
    close() {
      return database.close?.();
    },
  };
}

function adaptStatement(statement: any): SqliteStatement {
  return {
    get(...values) {
      return statement.get(...values);
    },
    all(...values) {
      return statement.all(...values);
    },
    run(...values) {
      return normalizeRunResult(statement.run(...values));
    },
  };
}

function adaptDirectDatabase(database: any, driver: SqliteCompatDriver): SqliteCompatibleDatabase {
  return {
    exec(sql) {
      if (typeof database.exec === 'function') {
        return callbackOrPromise(database, 'exec', [sql], driver).then(() => undefined);
      }
      return callbackOrPromise(database, 'run', [sql], driver).then(() => undefined);
    },
    prepare(sql) {
      return {
        get: (...values) => callbackOrPromise(database, 'get', [sql, ...values], driver),
        all: (...values) => callbackOrPromise(database, 'all', [sql, ...values], driver),
        run: (...values) => callbackOrPromise(database, 'run', [sql, ...values], driver).then(normalizeRunResult),
      };
    },
    close() {
      if (typeof database.close !== 'function') {
        return undefined;
      }
      return callbackOrPromise(database, 'close', [], driver).then(() => undefined);
    },
  };
}

function callbackOrPromise(database: any, method: string, args: unknown[], driver: SqliteCompatDriver): Promise<any> {
  if (driver === 'sqlite3') {
    return new Promise((resolve, reject) => {
      database[method](...sqlite3Args(method, args), function callback(this: any, error: Error | null, value: unknown) {
        if (error) {
          reject(error);
          return;
        }
        resolve(method === 'run'
          ? { changes: this?.changes ?? 0, lastInsertRowid: this?.lastID }
          : value);
      });
    });
  }
  return Promise.resolve(database[method](...args));
}

function sqlite3Args(method: string, args: unknown[]): unknown[] {
  if (method === 'close') {
    return [];
  }
  if (method === 'exec') {
    return [args[0]];
  }
  const [sql, ...values] = args;
  return [sql, values];
}

function normalizeRunResult(result: unknown): SqliteRunResult {
  if (isPromiseLike(result)) {
    return result.then(normalizeRunResult) as unknown as SqliteRunResult;
  }
  const row = result as Record<string, unknown> | undefined;
  return {
    changes: Number(row?.changes ?? row?.changesCount ?? 0),
    lastInsertRowid: row?.lastInsertRowid as number | bigint | undefined ?? row?.lastID as number | bigint | undefined,
  };
}

function sourceResourceForImport(resource: SqliteImportResource): Record<string, unknown> {
  const identity = identityForImportResource(resource);
  const idField = identity.fields.length === 1 ? identity.fields[0] : undefined;
  return {
    name: resource.resource,
    kind: 'collection',
    idField,
    identity,
    fields: resource.fields ?? {},
  };
}

async function applyImportedRows(target: any, resource: SqliteImportResource, rows: Array<Record<string, unknown>>): Promise<void> {
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

function identityForImportResource(resource: SqliteImportResource): { fields: string[] } {
  if (resource.identity?.fields?.length) {
    return { fields: resource.identity.fields };
  }
  if (resource.keyStrategy.kind === 'compound-object-key') {
    return { fields: resource.keyStrategy.fields };
  }
  if (resource.keyStrategy.kind === 'compound-generated-id') {
    return { fields: [resource.keyStrategy.idField] };
  }
  if (resource.keyStrategy.kind === 'single-primary-key') {
    return { fields: [resource.keyStrategy.field] };
  }
  if (resource.idField) {
    return { fields: [resource.idField] };
  }
  return { fields: [resource.primaryKey?.[0] ?? 'id'] };
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

function resolveSqliteFile(file: string, cwd = process.cwd()): string {
  if (file === ':memory:' || path.isAbsolute(file)) {
    return file;
  }
  return path.resolve(cwd, file);
}

function isPreparedDatabase(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && typeof (value as any).prepare === 'function');
}

function isDirectDatabase(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (
    typeof (value as any).all === 'function'
    || typeof (value as any).get === 'function'
    || typeof (value as any).run === 'function'
  ));
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return Boolean(value && typeof (value as Promise<unknown>).then === 'function');
}

function compatDriverUnavailable(driver: SqliteCompatDriver, error: unknown): Error {
  const runtimeError = error as Error;
  return dbError(
    'SQLITE_COMPAT_DRIVER_UNAVAILABLE',
    `SQLite compat driver "${driver}" is not available.`,
    {
      status: 500,
      hint: driver === 'node:sqlite'
        ? 'Use Node.js with node:sqlite support, or pass driver: "better-sqlite3", "sqlite3", or "sqlite".'
        : `Install "${driver}" in the app if you want Async DB to adapt that existing SQLite driver.`,
      details: {
        driver,
        parserMessage: runtimeError.message,
      },
    },
  );
}
