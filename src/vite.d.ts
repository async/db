import type { DbCacheEventPolicy, DbCacheReadPolicy, DbCacheWritePolicy, DbClient, DbOptions, DbTraceOptions } from './index.d.ts';

export type DbVirtualClient = DbClient & {
};

export type DbViteClientCacheOptions = boolean | {
  enabled?: boolean;
  readPolicy?: DbCacheReadPolicy;
  writePolicy?: DbCacheWritePolicy;
  eventPolicy?: DbCacheEventPolicy;
};

export type DbVitePluginOptions = Pick<DbOptions, 'cwd' | 'fs' | 'configPath' | 'dbDir' | 'sourceDir' | 'stateDir' | 'outputs' | 'schemaOutFile' | 'viewerManifestOutFile' | 'schemaManifest' | 'types' | 'schema' | 'defaults' | 'seed' | 'collections' | 'server' | 'rest' | 'graphql' | 'operations' | 'mock'> & {
  /** Scoped base for db dev tools. Defaults to "/__db". */
  apiBase?: string;
  /** App-facing REST data route alias. Defaults to "/db"; set false to disable. */
  dataPath?: string | false;
  /** Serve root REST routes such as "/users" during Vite dev. Defaults to false. */
  rootRoutes?: boolean;
  /** Scoped REST resource base. Defaults to "<apiBase>/rest". */
  restBasePath?: string;
  /** Scoped GraphQL endpoint. Defaults to "<apiBase>/graphql". */
  graphqlPath?: string;
  /** Explicit request trace option. Wins over db.config.mjs server.trace. */
  trace?: DbTraceOptions;
  /** Virtual module id for the browser-safe client. Defaults to "virtual:db/client"; false disables it. */
  clientVirtualModule?: string | false;
  /** Import specifier used inside the virtual client. Defaults to "@async/db/client". */
  clientImport?: string;
  /** Opt the virtual browser client into memory cache behavior during Vite dev. */
  clientCache?: DbViteClientCacheOptions;
};

export type ViteLikePlugin = {
  name: string;
  apply: 'serve';
  configureServer(server: {
    middlewares: {
      use(middleware: (request: unknown, response: unknown, next: () => void) => void): void;
    };
    httpServer?: {
      once(event: 'close', callback: () => void): void;
    };
    config?: {
      logger?: {
        warn(message: string): void;
      };
    };
  }): void | Promise<void>;
  resolveId(id: string): string | null | Promise<string | null>;
  load(id: string): string | null | Promise<string | null>;
};

export function dbPlugin(options?: DbVitePluginOptions): ViteLikePlugin;

declare module 'virtual:db/client' {
  export const client: DbVirtualClient;
  export default client;
}
