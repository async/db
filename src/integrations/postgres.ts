import { dbError } from '../errors.js';
import {
  createResourceWriteQueue,
  hydrateJsonResourceStore,
  closeInjectedClient,
} from '../features/storage/resource-json.js';

type PostgresQueryResult = {
  rows?: Array<Record<string, unknown>>;
};

type PostgresClient = {
  query(sql: string, params?: unknown[]): PostgresQueryResult | Promise<PostgresQueryResult>;
  [key: string]: unknown;
};

type PostgresStoreOptions = {
  client?: PostgresClient | null;
  schema?: string;
  table?: string;
  namespace?: string;
  migrate?: boolean;
  close?: boolean | ((client: PostgresClient | null | undefined) => unknown | Promise<unknown>);
};

type RuntimeConfig = Record<string, unknown>;

type RuntimeResource = {
  name: string;
  kind?: string;
  dataHash?: string | null;
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

export const postgresStoreCapabilities = {
  writable: true,
  persistence: 'postgres',
  atomicity: 'resource',
  liveEvents: true,
  staticExport: false,
  production: 'small-app',
};

export function postgresStore(options: PostgresStoreOptions = {}) {
  const {
    client,
    schema = 'public',
    table = '_async_db_resources',
    namespace = 'default',
    migrate = true,
    close = false,
  } = options;
  const withQueuedWrite = createResourceWriteQueue();
  let migrated = false;

  return ({ config, storeName }: StoreFactoryContext) => {
    assertPostgresClient(client, storeName);
    const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

    async function ensureMigrated(): Promise<void> {
      if (!migrate || migrated) {
        return;
      }

      if (schema !== 'public') {
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
      }
      await client.query(`CREATE TABLE IF NOT EXISTS ${qualifiedTable} (
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_hash TEXT,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (namespace, name)
)`);
      migrated = true;
    }

    async function readEnvelope(resource: RuntimeResource): Promise<RuntimeEnvelope | null> {
      await ensureMigrated();
      const result = await client.query(
        `SELECT kind, source_hash, value FROM ${qualifiedTable} WHERE namespace = $1 AND name = $2`,
        [namespace, resource.name],
      );
      const row = result?.rows?.[0];
      if (!row) {
        return null;
      }
      return {
        kind: String(row.kind),
        sourceHash: typeof row.source_hash === 'string' ? row.source_hash : null,
        value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
      };
    }

    async function writeEnvelope(resource: RuntimeResource, envelope: RuntimeEnvelope): Promise<void> {
      await ensureMigrated();
      await client.query(
        `INSERT INTO ${qualifiedTable} (namespace, name, kind, source_hash, value, updated_at)
VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
ON CONFLICT (namespace, name) DO UPDATE SET
  kind = EXCLUDED.kind,
  source_hash = EXCLUDED.source_hash,
  value = EXCLUDED.value,
  updated_at = CURRENT_TIMESTAMP`,
        [
          namespace,
          resource.name,
          envelope.kind,
          envelope.sourceHash ?? null,
          JSON.stringify(envelope.value),
        ],
      );
    }

    return {
      name: storeName,
      capabilities: postgresStoreCapabilities,
      async hydrate(resources: RuntimeResource[]) {
        await ensureMigrated();
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
        await writeEnvelope(resource, {
          kind: resource.kind,
          sourceHash: resource.dataHash ?? null,
          value,
        });
      },
      withResourceWrite<T>(resource: RuntimeResource, operation: ResourceWriteOperation<T>) {
        return withQueuedWrite(`${namespace}:${resource.name}`, operation);
      },
      close() {
        return closeInjectedClient(client, close);
      },
    };
  };
}

function assertPostgresClient(client: PostgresClient | null | undefined, storeName: string): asserts client is PostgresClient {
  if (client && typeof client.query === 'function') {
    return;
  }

  throw dbError(
    'POSTGRES_STORE_CLIENT_REQUIRED',
    `Postgres store "${storeName}" requires an injected client with query(sql, params).`,
    {
      status: 500,
      hint: 'Pass a pg Pool, pg Client, or compatible object to postgresStore({ client }).',
      details: {
        store: storeName,
      },
    },
  );
}

function quoteIdentifier(value: string): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}
