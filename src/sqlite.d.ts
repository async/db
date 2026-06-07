import type { DbOptions } from './index.d.ts';

type MaybePromise<T> = T | Promise<T>;

export type SqliteRunResult = {
  changes: number;
  lastInsertRowid?: number | bigint;
};

export type SqliteStatement = {
  get(...values: unknown[]): MaybePromise<Record<string, string | number | bigint | Buffer | null> | undefined>;
  all(...values: unknown[]): MaybePromise<Array<Record<string, string | number | bigint | Buffer | null>>>;
  run(...values: unknown[]): MaybePromise<SqliteRunResult>;
};

export type SqliteDatabase = {
  exec(sql: string): MaybePromise<void>;
  prepare(sql: string): MaybePromise<SqliteStatement>;
  close(): MaybePromise<void>;
};

export type SqliteTableMapping = {
  table?: string;
  columns?: Record<string, string>;
  primaryKey?: string | string[];
  readOnly?: boolean;
};

export type SqliteDbOptions = DbOptions & {
  file?: string;
  storage?: {
    kind?: 'sqlite';
    file?: string;
  };
  database?: SqliteDatabase;
  open?: (options: { file: string; readOnly: boolean }) => SqliteDatabase | Promise<SqliteDatabase>;
  closeDatabase?: boolean;
  migrate?: boolean;
  readOnly?: boolean;
  tables?: Record<string, string | SqliteTableMapping>;
};

export function openSqliteDb(options?: SqliteDbOptions): Promise<SqliteDb>;
export function sqliteStore(options?: { file?: string }): unknown;
export const sqliteStoreCapabilities: {
  writable: true;
  persistence: 'local-sqlite';
  atomicity: 'resource';
  liveEvents: true;
  staticExport: false;
  production: 'small-local';
};
export function migrateSqliteDb(database: SqliteDatabase, resources: unknown[]): Promise<void>;

export type SqliteCollectionWhereOperator = {
  eq?: unknown;
  ne?: unknown;
  in?: unknown[];
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  contains?: unknown;
};

export type SqliteCollectionWhere = Record<string, unknown | SqliteCollectionWhereOperator>;

export type SqliteCollectionOrderBy =
  | string
  | { field: string; direction?: 'asc' | 'desc' }
  | Array<string | { field: string; direction?: 'asc' | 'desc' }>;

export type SqliteCollectionQuery = {
  where?: SqliteCollectionWhere;
  orderBy?: SqliteCollectionOrderBy;
  limit?: number;
  offset?: number;
};

export type SqliteCollectionAggregateMetric =
  | 'count'
  | {
    op: 'count' | 'sum' | 'min' | 'max' | 'avg';
    field?: string;
  };

export type SqliteCollectionAggregate = SqliteCollectionQuery & {
  groupBy?: string | string[];
  metrics?: Record<string, SqliteCollectionAggregateMetric>;
};

export class SqliteDb {
  database: SqliteDatabase;
  collection(name: string): SqliteDbCollection;
  table(name: string): SqliteDbCollection;
  document(name: string): SqliteDbDocument;
  resourceNames(): string[];
  close(): void;
}

export class SqliteDbCollection {
  all(): Promise<Array<Record<string, unknown>>>;
  get(id: unknown): Promise<Record<string, unknown> | null>;
  exists(id: unknown): Promise<boolean>;
  find(options?: SqliteCollectionQuery): Promise<Array<Record<string, unknown>>>;
  count(options?: SqliteCollectionQuery): Promise<number>;
  aggregate(options: SqliteCollectionAggregate): Promise<Array<Record<string, unknown>>>;
  create(record: unknown): Promise<Record<string, unknown>>;
  append(record: unknown): Promise<Record<string, unknown>>;
  update(id: unknown, patch: unknown): Promise<Record<string, unknown> | null>;
  patch(id: unknown, patch: unknown): Promise<Record<string, unknown> | null>;
  delete(id: unknown): Promise<boolean>;
  nextId(): Promise<string>;
}

export class SqliteDbDocument {
  all(): Promise<Record<string, unknown>>;
  get(path?: string | Array<string | number>): Promise<unknown>;
  put(value: unknown): Promise<Record<string, unknown>>;
  set(path: string | Array<string | number>, value: unknown): Promise<unknown>;
  update(patch: unknown): Promise<Record<string, unknown>>;
}
