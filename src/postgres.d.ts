export type PostgresStoreClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows?: Array<Record<string, unknown>>; rowCount?: number }> | { rows?: Array<Record<string, unknown>>; rowCount?: number };
  close?: () => void | Promise<void>;
  end?: () => void | Promise<void>;
};

export type PostgresClient = PostgresStoreClient;

export type PostgresQueryResult = {
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
};

export type PostgresStoreOptions = {
  client: PostgresStoreClient;
  schema?: string;
  table?: string;
  namespace?: string;
  migrate?: boolean;
  close?: boolean | ((client: PostgresStoreClient) => void | Promise<void>);
};

export type PostgresTableMapping = {
  schema?: string;
  table?: string;
  columns?: Record<string, string>;
  primaryKey?: string | string[];
  readOnly?: boolean;
};

export type OpenPostgresOptions = Record<string, unknown> & {
  project?: {
    resources: Array<Record<string, unknown>>;
  };
  client?: PostgresClient;
  open?: (options: { readOnly: boolean }) => PostgresClient | Promise<PostgresClient>;
  closeClient?: boolean;
  schema?: string;
  schemas?: string[];
  tables?: Record<string, string | PostgresTableMapping>;
  migrate?: boolean;
  readOnly?: boolean;
};

export class PostgresDb {
  collection(name: string): PostgresDbCollection;
  table(name: string): PostgresDbCollection;
  document(name: string): PostgresDbDocument;
  resourceNames(): string[];
  close(): Promise<void>;
}

export class PostgresDbCollection {
  all(): Promise<Array<Record<string, unknown>>>;
  get(id: unknown): Promise<Record<string, unknown> | null>;
  exists(id: unknown): Promise<boolean>;
  find(query?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  count(query?: Record<string, unknown>): Promise<number>;
  aggregate(aggregate: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  create(record: unknown): Promise<Record<string, unknown>>;
  append(record: unknown): Promise<Record<string, unknown>>;
  patch(id: unknown, patch: unknown): Promise<Record<string, unknown> | null>;
  update(id: unknown, patch: unknown): Promise<Record<string, unknown> | null>;
  delete(id: unknown): Promise<boolean>;
  nextId(): Promise<string>;
}

export class PostgresDbDocument {
  all(): Promise<Record<string, unknown>>;
  get(path?: string | Array<string | number>): Promise<unknown>;
  put(value: unknown): Promise<Record<string, unknown>>;
  set(path: string | Array<string | number>, value: unknown): Promise<unknown>;
  update(patch: unknown): Promise<Record<string, unknown>>;
}

export function openPostgresDb(options?: OpenPostgresOptions): Promise<PostgresDb>;
export function postgresStore(options: PostgresStoreOptions): unknown;
export const postgresStoreCapabilities: {
  writable: true;
  persistence: 'postgres';
  atomicity: 'resource';
  liveEvents: true;
  staticExport: false;
  production: 'small-app';
};
