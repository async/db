import type { DbCustomStoreFactory, DbFileSystem } from './index.js';

export type JsonStoreCapabilities = {
  writable: true;
  persistence: 'local-file';
  atomicity: 'resource';
  liveEvents: true;
  staticExport: false;
  production: 'small-local';
};

export type JsonStateConfig = {
  stateDir: string;
};

export type JsonStateResource = {
  name: string;
};

export type JsonFileStorage = {
  kind: 'file';
  root: string;
};

export type JsonS3Storage = {
  kind: 's3';
  bucket: string;
  prefix?: string;
  client?: unknown;
  encryption?: unknown;
};

export type JsonStoreEncryptionOptions = {
  /**
   * Encryption key: a 32-byte Buffer/Uint8Array, any passphrase string
   * (hashed with SHA-256 into a 256-bit key), or a sync/async function
   * returning either. State files are sealed with AES-256-GCM; reads fail
   * with JSON_ENCRYPTION_FAILED when the key does not match.
   */
  key: string | Uint8Array | (() => string | Uint8Array | Promise<string | Uint8Array>);
  algorithm?: 'aes-256-gcm';
};

export type JsonStoreOptions = {
  storage?: JsonFileStorage | JsonS3Storage;
  /**
   * "current" keeps only the live file. "versioned" snapshots the previous
   * contents into a `.versions/<resource>/` directory on every write and on
   * restores, pruned to maxVersions.
   */
  durability?: 'current' | 'versioned' | string;
  /** Maximum retained version snapshots per resource. Defaults to 10. */
  maxVersions?: number;
  encryption?: JsonStoreEncryptionOptions | null;
};

export type JsonStateVersion = {
  file: string;
  path: string;
  at: number;
};

export type JsonStateRecoveryReport = {
  removedTempFiles: string[];
  removedLocks: string[];
};

export type JsonStateWriteOptions = {
  /**
   * Guard the queued write with an on-disk advisory lock so concurrent
   * processes cannot interleave read-modify-write cycles. Defaults to true on
   * the real filesystem and false for custom in-memory file systems.
   */
  crossProcessLock?: boolean;
  /** How long to wait for a held lock before failing with JSON_STATE_LOCKED. Defaults to 5000ms. */
  lockTimeoutMs?: number;
  /** Age after which an ownerless or unreadable lock file is reclaimed. Defaults to 10000ms. */
  lockStaleMs?: number;
  fs?: DbFileSystem;
};

export type JsonIdentityDefinition = {
  fields: string[];
};

export type JsonBytesEncoding = 'base64' | 'base64url' | 'hex';

export type JsonFieldDefinition = {
  type?: string;
  required?: boolean;
  nullable?: boolean;
  encoding?: JsonBytesEncoding;
  fields?: Record<string, JsonFieldDefinition>;
  items?: JsonFieldDefinition;
  [key: string]: unknown;
};

export type JsonResourceOptions = {
  idField?: string;
  identity?: JsonIdentityDefinition;
  writePolicy?: 'append-only' | string;
  log?: {
    cursorField?: string;
    order?: 'asc' | 'desc';
    payloadField?: string;
    [key: string]: unknown;
  };
  fields?: Record<string, JsonFieldDefinition>;
  indexes?: Array<string | { fields: string[] }>;
};

export type JsonKey = string | number | boolean | Record<string, unknown>;

export type JsonWritesMode = 'sidecar' | 'source';

export type JsonOpenOptions = {
  cwd?: string;
  fs?: DbFileSystem;
  writes?: JsonWritesMode;
  stateDir?: string;
  idField?: string;
  identity?: JsonIdentityDefinition;
  writePolicy?: 'append-only' | string;
  fields?: Record<string, JsonFieldDefinition>;
  resource?: JsonResourceOptions;
  resources?: Record<string, JsonResourceOptions>;
  indexes?: JsonResourceOptions['indexes'] | Record<string, JsonResourceOptions['indexes']>;
  store?: unknown;
};

export type JsonCollection = {
  kind: 'collection';
  name: string;
  all(): Promise<Array<Record<string, unknown>>>;
  get(key: JsonKey): Promise<Record<string, unknown> | null>;
  exists(key: JsonKey): Promise<boolean>;
  find(query?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  count(query?: Record<string, unknown>): Promise<number>;
  aggregate(query: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  create(record: Record<string, unknown>): Promise<Record<string, unknown>>;
  append(record: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(key: JsonKey, patch: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  patch(key: JsonKey, patch: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  delete(key: JsonKey): Promise<boolean>;
  replaceAll(records: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>>;
};

export type JsonDocumentPath = string | Array<string | number>;

export type JsonDocument = {
  kind: 'document';
  name: string;
  all(): Promise<unknown>;
  get(path?: JsonDocumentPath): Promise<unknown>;
  put(value: unknown): Promise<unknown>;
  set(path: JsonDocumentPath, value: unknown): Promise<unknown>;
  update(patch: Record<string, unknown>): Promise<unknown>;
};

export type JsonDatabase = {
  kind: 'database';
  resourceNames(): string[];
  collection(name: string): JsonCollection;
  document(name: string): JsonDocument;
  close(): Promise<void>;
};

export type JsonOpenResult = JsonCollection | JsonDocument | JsonDatabase;

export const jsonStoreCapabilities: JsonStoreCapabilities;

export function fileStorage(root: string): JsonFileStorage;
/**
 * @experimental Declarative S3 storage options for the JSON store. The
 * built-in runtime does not implement an S3 backend yet; using it today fails
 * at runtime with JSON_STORAGE_BACKEND_UNAVAILABLE. Use fileStorage(), or a
 * custom store adapter, for production data.
 */
export function s3Storage(options: Omit<JsonS3Storage, 'kind'>): JsonS3Storage;
export function jsonStore(options?: JsonStoreOptions): DbCustomStoreFactory;
export function jsonStatePathForResource(config: JsonStateConfig, resource: string | JsonStateResource): string;
export function readJsonState<T>(filePath: string, fallback: T, fs?: DbFileSystem): Promise<T>;
export function writeJsonState(filePath: string, value: unknown, fs?: DbFileSystem): Promise<boolean>;
export function atomicWriteJson(filePath: string, value: unknown, fs?: DbFileSystem): Promise<boolean>;
export function withJsonStateWrite<T>(filePath: string, operation: () => T | Promise<T>, options?: JsonStateWriteOptions): Promise<T>;

export const DEFAULT_MAX_JSON_STATE_VERSIONS: number;

/** Versions directory for one state file (a hidden sibling: `.versions/<resource>/`). */
export function jsonStateVersionsDir(filePath: string): string;
/** Atomic write that snapshots the previous contents first and prunes history to maxVersions. */
export function atomicWriteJsonVersioned(filePath: string, value: unknown, options?: { fs?: DbFileSystem; maxVersions?: number }): Promise<boolean>;
/** Version snapshots for a state file, newest first. */
export function listJsonStateVersions(filePath: string, fs?: DbFileSystem): Promise<JsonStateVersion[]>;
/** Replace the live state file with a stored snapshot; the current contents are snapshotted first so restores are undoable. */
export function restoreJsonStateVersion(filePath: string, version?: 'latest' | string, options?: { fs?: DbFileSystem; maxVersions?: number }): Promise<JsonStateVersion>;
/** Boot-time sweep: remove orphaned atomic-write temp files and reclaim lock files whose owner process is gone. */
export function recoverJsonStateDir(directory: string, fs?: DbFileSystem): Promise<JsonStateRecoveryReport>;
export function json(target: string, options?: JsonOpenOptions): Promise<JsonOpenResult>;
