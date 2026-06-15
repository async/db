import type { KvStoreClient, KvStoreOptions } from './kv.d.ts';
export {
  redisJson,
  redisJsonStore,
  redisJsonStoreCapabilities,
} from '@async/json/redis';

export type RedisStoreClient = KvStoreClient;
export type RedisStoreOptions = KvStoreOptions;

export function redisStore(options: RedisStoreOptions): unknown;
export const redisStoreCapabilities: {
  writable: true;
  persistence: 'kv';
  atomicity: 'resource';
  liveEvents: true;
  staticExport: false;
  production: 'small-app';
};
