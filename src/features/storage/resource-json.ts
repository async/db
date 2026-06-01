import { dbError } from '../../errors.js';
import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';

type RuntimeConfig = {
  defaults?: {
    applyOnSafeMigration?: boolean;
  };
  [key: string]: unknown;
};

type RuntimeResource = {
  kind?: string;
  name: string;
  dataHash?: string | null;
  [key: string]: unknown;
};

export type ResourceEnvelope<T = unknown> = {
  kind?: string;
  sourceHash?: string | null;
  value: T;
};

type EnvelopeReader<T> = (resource: RuntimeResource) => Promise<ResourceEnvelope<T> | null | undefined>;
type EnvelopeWriter<T> = (resource: RuntimeResource, envelope: ResourceEnvelope<T>) => Promise<unknown>;
type ResourceWriteOperation<T> = () => T | Promise<T>;

export function createResourceWriteQueue() {
  const queues = new Map<string, Promise<unknown>>();
  return function withQueuedResourceWrite<T>(queueKey: string, operation: ResourceWriteOperation<T>): Promise<T> {
    const previous = queues.get(queueKey) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    const stored = current.catch(() => {});
    queues.set(queueKey, stored);
    stored.finally(() => {
      if (queues.get(queueKey) === stored) {
        queues.delete(queueKey);
      }
    });
    return current;
  };
}

export async function hydrateJsonResourceStore<T = unknown>({
  config,
  resource,
  readEnvelope,
  writeEnvelope,
}: {
  config: RuntimeConfig;
  resource: RuntimeResource;
  readEnvelope: EnvelopeReader<T>;
  writeEnvelope: EnvelopeWriter<T>;
}): Promise<void> {
  const envelope = await readEnvelope(resource);
  const sourceChanged = resource.dataHash && envelope?.sourceHash !== resource.dataHash;

  if (!envelope || sourceChanged) {
    await writeEnvelope(resource, {
      kind: resource.kind,
      sourceHash: resource.dataHash ?? null,
      value: applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config) as T,
    });
    return;
  }

  if (config.defaults?.applyOnSafeMigration !== false) {
    await writeEnvelope(resource, {
      kind: resource.kind,
      sourceHash: resource.dataHash ?? envelope.sourceHash ?? null,
      value: applyDefaultsToSeed(envelope.value, resource, config) as T,
    });
  }
}

export function envelopeForResource<T>(resource: RuntimeResource, value: T): ResourceEnvelope<T> {
  return {
    kind: resource.kind,
    sourceHash: resource.dataHash ?? null,
    value,
  };
}

export function parseJsonEnvelope<T = unknown>(raw: string | ResourceEnvelope<T> | null | undefined, storeName: string): ResourceEnvelope<T> | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  const envelope = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ResourceEnvelope<T> | null;
  if (!envelope || typeof envelope !== 'object' || !('value' in envelope)) {
    throw dbError(
      'STORE_INVALID_RESOURCE_ENVELOPE',
      `Store "${storeName}" returned an invalid resource envelope.`,
      {
        status: 500,
        hint: 'Resource JSON stores must persist { kind, sourceHash, value } envelopes.',
        details: {
          store: storeName,
        },
      },
    );
  }
  return envelope;
}

export async function closeInjectedClient(
  client: Record<string, unknown> | null | undefined,
  closeOption: boolean | ((client: Record<string, unknown> | null | undefined) => unknown | Promise<unknown>),
): Promise<void> {
  if (!closeOption) {
    return;
  }

  if (typeof closeOption === 'function') {
    await closeOption(client);
    return;
  }

  for (const method of ['close', 'end', 'quit', 'disconnect']) {
    const closeMethod = client?.[method];
    if (typeof closeMethod === 'function') {
      await closeMethod.call(client);
      return;
    }
  }
}
