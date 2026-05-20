import type { DbOptions, Db } from './index.d.ts';

export type SqliteDbOptions = DbOptions & {
  file?: string;
  storage?: {
    kind?: 'sqlite';
    file?: string;
  };
};

export function openSqliteDb(options?: SqliteDbOptions): Promise<Db>;
export function sqliteStore(options?: { file?: string }): unknown;
export const sqliteStoreCapabilities: {
  writable: true;
  persistence: 'local-sqlite';
  atomicity: 'resource';
  liveEvents: true;
  staticExport: false;
  production: 'small-local';
};
export function migrateSqliteDb(database: unknown, resources: unknown[]): void;
export class SqliteDb {}
export class SqliteDbCollection {}
export class SqliteDbDocument {}
