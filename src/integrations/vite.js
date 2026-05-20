import { openDb } from '../db.js';
import { serializeError } from '../errors.js';
import { createDbRequestHandler, createViewerEventHub, watchSourceDir } from '../server.js';
import { sendJson } from '../rest/handler.js';

const DEFAULT_VIRTUAL_CLIENT_MODULE = 'virtual:db/client';
const DEFAULT_CLIENT_IMPORT = '@async/db/client';

export function dbPlugin(options = {}) {
  const routes = resolveViteRoutes(options);
  const virtualModuleId = options.clientVirtualModule === false
    ? null
    : options.clientVirtualModule ?? DEFAULT_VIRTUAL_CLIENT_MODULE;
  const resolvedVirtualModuleId = virtualModuleId ? `\0${virtualModuleId}` : null;

  return {
    name: 'db:vite',
    apply: 'serve',

    async configureServer(server) {
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
      });

      server.middlewares.use((request, response, next) => {
        return handler(request, response, next).catch((error) => {
          sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
        });
      });

      server.httpServer?.once?.('close', () => {
        watcher.close();
        events.close();
      });
    },

    resolveId(id) {
      return id === virtualModuleId ? resolvedVirtualModuleId : null;
    },

    load(id) {
      if (id !== resolvedVirtualModuleId) {
        return null;
      }

      return renderVirtualClient(routes, options.clientImport ?? DEFAULT_CLIENT_IMPORT);
    },
  };
}

function resolveViteRoutes(options) {
  const apiBase = normalizeBasePath(options.apiBase ?? options.server?.apiBase ?? '/__db');
  return {
    apiBase,
    dataPath: options.dataPath ?? options.server?.dataPath,
    rootRoutes: options.rootRoutes === true,
    restBasePath: normalizeBasePath(options.restBasePath ?? `${apiBase}/rest`),
    graphqlPath: normalizeBasePath(options.graphqlPath ?? `${apiBase}/graphql`),
  };
}

function renderVirtualClient(routes, clientImport) {
  const forkBasePath = `${routes.apiBase || ''}/forks`;
  return `import { createDbClient } from ${JSON.stringify(clientImport)};

export const client = createDbClient({
  restBasePath: ${JSON.stringify(routes.restBasePath)},
  restBatchPath: ${JSON.stringify(`${routes.apiBase}/batch`)},
  graphqlPath: ${JSON.stringify(routes.graphqlPath)},
});

export function fork(name) {
  const forkName = String(name ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(forkName)) {
    throw new Error(\`Invalid db fork name "\${forkName}". Use letters, numbers, underscores, or hyphens.\`);
  }

  const forkBase = \`${forkBasePath}/\${encodeURIComponent(forkName)}\`;
  return createDbClient({
    restBasePath: \`\${forkBase}/rest\`,
    restBatchPath: \`\${forkBase}/batch\`,
    graphqlPath: \`\${forkBase}/graphql\`,
  });
}

export const createForkClient = fork;
client.fork = fork;

export default client;
`;
}

function dbOptions(options) {
  const {
    apiBase,
    dataPath,
    rootRoutes,
    restBasePath,
    graphqlPath,
    clientVirtualModule,
    clientImport,
    ...db
  } = options;
  return db;
}

function normalizeBasePath(value) {
  const path = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return path === '/' ? '' : path;
}
