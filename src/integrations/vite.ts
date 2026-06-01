import { openDb } from '../db.js';
import { serializeError } from '../errors.js';
import { createDbRequestHandler, createViewerEventHub, watchSourceDir } from '../server.js';
import { sendJson } from '../rest/handler.js';

const DEFAULT_VIRTUAL_CLIENT_MODULE = 'virtual:db/client';
const DEFAULT_CLIENT_IMPORT = '@async/db/client';

type ClientCacheOptions = boolean | {
  enabled?: boolean;
  readPolicy?: string;
  writePolicy?: string;
  eventPolicy?: string | false;
  [key: string]: unknown;
} | null | undefined;

type DbVitePluginOptions = Record<string, unknown> & {
  apiBase?: string;
  dataPath?: string | false;
  rootRoutes?: boolean;
  restBasePath?: string;
  graphqlPath?: string;
  trace?: unknown;
  clientVirtualModule?: string | false | null;
  clientImport?: string;
  clientCache?: ClientCacheOptions;
  server?: {
    apiBase?: string;
    dataPath?: string | false;
    [key: string]: unknown;
  };
};

type ResolvedViteRoutes = {
  apiBase: string;
  dataPath?: string | false;
  rootRoutes: boolean;
  restBasePath: string;
  graphqlPath: string;
};

type ViteMiddleware = (request: unknown, response: unknown, next: (error?: unknown) => unknown) => unknown;

type ViteDevServerLike = {
  config?: {
    logger?: {
      warn?: (message: string) => unknown;
    };
  };
  middlewares: {
    use(handler: ViteMiddleware): unknown;
  };
  httpServer?: {
    once?(event: string, listener: () => void): unknown;
  };
};

type RequestHandler = (request: unknown, response: unknown, next: (error?: unknown) => unknown) => Promise<unknown>;

type StatusError = Error & {
  status?: number;
};

export function dbPlugin(options: DbVitePluginOptions = {}) {
  const routes = resolveViteRoutes(options);
  const virtualModuleId = options.clientVirtualModule === false
    ? null
    : options.clientVirtualModule ?? DEFAULT_VIRTUAL_CLIENT_MODULE;
  const resolvedVirtualModuleId = virtualModuleId ? `\0${virtualModuleId}` : null;

  return {
    name: 'db:vite',
    apply: 'serve',

    async configureServer(server: ViteDevServerLike) {
      const db = await openDb({
        ...dbOptions(options),
        allowSourceErrors: true,
      });
      const events = createViewerEventHub();
      const watcher = await watchSourceDir(db, events, {
        warn(message) {
          server.config?.logger?.warn?.(message);
        },
      });
      const handler = createDbRequestHandler(db, {
        ...routes,
        events,
        trace: options.trace,
      }) as RequestHandler;

      server.middlewares.use((request, response, next) => {
        return handler(request, response, next).catch((error) => {
          const statusError = error as StatusError;
          sendJson(response as never, statusError.status ?? 500, serializeError(statusError, 'SERVER_ERROR'));
        });
      });

      server.httpServer?.once?.('close', () => {
        watcher.close();
        events.close();
      });
    },

    resolveId(id: string) {
      return id === virtualModuleId ? resolvedVirtualModuleId : null;
    },

    load(id: string) {
      if (id !== resolvedVirtualModuleId) {
        return null;
      }

      return renderVirtualClient(routes, options.clientImport ?? DEFAULT_CLIENT_IMPORT, options.clientCache);
    },
  };
}

function resolveViteRoutes(options: DbVitePluginOptions): ResolvedViteRoutes {
  const apiBase = normalizeBasePath(options.apiBase ?? options.server?.apiBase ?? '/__db');
  return {
    apiBase,
    dataPath: options.dataPath ?? options.server?.dataPath,
    rootRoutes: options.rootRoutes === true,
    restBasePath: normalizeBasePath(options.restBasePath ?? `${apiBase}/rest`),
    graphqlPath: normalizeBasePath(options.graphqlPath ?? `${apiBase}/graphql`),
  };
}

function renderVirtualClient(routes: ResolvedViteRoutes, clientImport: string, clientCache: ClientCacheOptions): string {
  const cacheOption = serializeVirtualClientCache(clientCache);
  const defaultCacheLine = cacheOption ? `  cache: ${cacheOption},\n` : '';
  return `import { createDbClient } from ${JSON.stringify(clientImport)};

export const client = createDbClient({
  manifestPath: ${JSON.stringify(`${routes.apiBase}/manifest.json`)},
  restBasePath: ${JSON.stringify(routes.restBasePath)},
  restBatchPath: ${JSON.stringify(`${routes.apiBase}/batch`)},
  graphqlPath: ${JSON.stringify(routes.graphqlPath)},
${defaultCacheLine}
});

export default client;
`;
}

function dbOptions(options: DbVitePluginOptions): Record<string, unknown> {
  const {
    apiBase,
    dataPath,
    rootRoutes,
    restBasePath,
    graphqlPath,
    trace,
    clientVirtualModule,
    clientImport,
    clientCache,
    ...db
  } = options;
  return db;
}

function serializeVirtualClientCache(value: ClientCacheOptions): string | null {
  if (value === undefined || value === false) {
    return null;
  }
  if (value === true) {
    return 'true';
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const cache: Record<string, unknown> = {};
  if (value.enabled !== undefined) {
    cache.enabled = Boolean(value.enabled);
  }
  for (const key of ['readPolicy', 'writePolicy']) {
    if (typeof value[key] === 'string') {
      cache[key] = value[key];
    }
  }
  if (typeof value.eventPolicy === 'string' || value.eventPolicy === false) {
    cache.eventPolicy = value.eventPolicy;
  }
  return JSON.stringify(cache);
}

function normalizeBasePath(value: unknown): string {
  const path = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return path === '/' ? '' : path;
}
