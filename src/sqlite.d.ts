import type { JsonDbOptions, JsonFixtureDb } from './index.d.ts';

export type SqliteJsonDbOptions = JsonDbOptions & {
  file?: string;
  storage?: {
    kind?: 'sqlite';
    file?: string;
  };
};

export function openSqliteJsonDb(options?: SqliteJsonDbOptions): Promise<JsonFixtureDb>;
export function sqliteStore(options?: { file?: string }): unknown;
export const sqliteStoreCapabilities: {
  writable: true;
  persistence: 'local-sqlite';
  atomicity: 'resource';
  liveEvents: true;
  staticExport: false;
  production: 'small-local';
};
export function migrateSqliteJsonDb(database: unknown, resources: unknown[]): void;
export class SqliteJsonDb {}
export class SqliteJsonDbCollection {}
export class SqliteJsonDbDocument {}
