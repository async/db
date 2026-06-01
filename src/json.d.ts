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

export const jsonStoreCapabilities: JsonStoreCapabilities;

export function jsonStatePathForResource(config: JsonStateConfig, resource: string | JsonStateResource): string;
export function readJsonState<T>(filePath: string, fallback: T): Promise<T>;
export function writeJsonState(filePath: string, value: unknown): Promise<boolean>;
export function atomicWriteJson(filePath: string, value: unknown): Promise<boolean>;
export function withJsonStateWrite<T>(filePath: string, operation: () => T | Promise<T>): Promise<T>;
