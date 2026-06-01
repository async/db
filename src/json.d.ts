import type { DbCustomStoreFactory } from './index.js';

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

export type JsonStoreOptions = {
  storage?: JsonFileStorage | JsonS3Storage;
  durability?: 'current' | 'versioned' | string;
  encryption?: unknown;
};

export const jsonStoreCapabilities: JsonStoreCapabilities;

export function fileStorage(root: string): JsonFileStorage;
export function s3Storage(options: Omit<JsonS3Storage, 'kind'>): JsonS3Storage;
export function jsonStore(options?: JsonStoreOptions): DbCustomStoreFactory;
export function jsonStatePathForResource(config: JsonStateConfig, resource: string | JsonStateResource): string;
export function readJsonState<T>(filePath: string, fallback: T): Promise<T>;
export function writeJsonState(filePath: string, value: unknown): Promise<boolean>;
export function atomicWriteJson(filePath: string, value: unknown): Promise<boolean>;
export function withJsonStateWrite<T>(filePath: string, operation: () => T | Promise<T>): Promise<T>;
