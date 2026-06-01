import { dbError } from '../errors.js';
import {
  closeInjectedClient,
  createResourceWriteQueue,
  envelopeForResource,
  hydrateJsonResourceStore,
  parseJsonEnvelope,
} from '../features/storage/resource-json.js';

type KvClient = {
  get(key: string): string | null | undefined | Promise<string | null | undefined>;
  set(key: string, value: string): unknown | Promise<unknown>;
  [key: string]: unknown;
};

type KvStoreOptions = {
  client?: KvClient | null;
  prefix?: string;
  close?: boolean | ((client: KvClient | null | undefined) => unknown | Promise<unknown>);
};

type RuntimeConfig = Record<string, unknown>;

type RuntimeResource = {
  name: string;
  [key: string]: unknown;
};

type RuntimeEnvelope = {
  kind?: string;
  sourceHash?: string | null;
  value: unknown;
};

type StoreFactoryContext = {
  config: RuntimeConfig;
  storeName: string;
};

type ResourceWriteOperation<T> = () => T | Promise<T>;

export const kvStoreCapabilities = {
  writable: true,
  persistence: 'kv',
  atomicity: 'resource',
  liveEvents: true,
  staticExport: false,
  production: 'small-app',
};

export function kvStore(options: KvStoreOptions = {}) {
  const {
    client,
    prefix = 'async-db:',
    close = false,
  } = options;
  const withQueuedWrite = createResourceWriteQueue();

  return ({ config, storeName }: StoreFactoryContext) => {
    assertKvClient(client, storeName);

    function keyFor(resource: RuntimeResource): string {
      return `${prefix}${encodeURIComponent(resource.name)}`;
    }

    async function readEnvelope(resource: RuntimeResource) {
      return parseJsonEnvelope(await client.get(keyFor(resource)), storeName);
    }

    async function writeEnvelope(resource: RuntimeResource, envelope: RuntimeEnvelope): Promise<void> {
      await client.set(keyFor(resource), JSON.stringify(envelope));
    }

    return {
      name: storeName,
      capabilities: kvStoreCapabilities,
      async hydrate(resources: RuntimeResource[]) {
        for (const resource of resources) {
          await hydrateJsonResourceStore({
            config,
            resource,
            readEnvelope,
            writeEnvelope,
          });
        }
      },
      async readResource(resource: RuntimeResource, fallback: unknown) {
        const envelope = await readEnvelope(resource);
        return envelope ? envelope.value : fallback;
      },
      async writeResource(resource: RuntimeResource, value: unknown) {
        await writeEnvelope(resource, envelopeForResource(resource, value));
      },
      withResourceWrite<T>(resource: RuntimeResource, operation: ResourceWriteOperation<T>) {
        return withQueuedWrite(keyFor(resource), operation);
      },
      close() {
        return closeInjectedClient(client, close);
      },
    };
  };
}

export function redisStore(options: KvStoreOptions = {}) {
  return kvStore(options);
}

export const redisStoreCapabilities = kvStoreCapabilities;

function assertKvClient(client: KvClient | null | undefined, storeName: string): asserts client is KvClient {
  if (client && typeof client.get === 'function' && typeof client.set === 'function') {
    return;
  }

  throw dbError(
    'KV_STORE_CLIENT_REQUIRED',
    `KV store "${storeName}" requires an injected client with get(key) and set(key, value).`,
    {
      status: 500,
      hint: 'Pass a Redis-like, edge KV, or compatible object to kvStore({ client }).',
      details: {
        store: storeName,
      },
    },
  );
}
