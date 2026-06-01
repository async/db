import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb } from '../../../dist/index.js';
import { serializeError } from '../../../dist/errors.js';
import { sendJson } from '../../../dist/rest/handler.js';
import {
  createDbRequestHandler,
  createViewerEventHub,
  watchSourceDir,
} from '../../../dist/server.js';
import { handleSchemaUiSsrRequest } from './schema-ui-ssr-handler.mjs';

/**
 * Schema UI demo runtime: SSR CMS routes composed ahead of the stock db REST / viewer stack.
 *
 * @param {{ cwd: string; basePath?: string; skipSync?: boolean }} options
 */
export async function createSchemaUiRuntime(options) {
  const {
    cwd,
    basePath = '',
    skipSync = false,
  } = options;
  const normalizedBasePath = normalizeBasePath(basePath);

  const db = await openDb({
    cwd,
    allowSourceErrors: true,
    syncOnOpen: !skipSync,
  });

  if (skipSync) {
    await db.runtime.hydrate();
  }

  const events = createViewerEventHub();
  const dbHandler = createDbRequestHandler(db, {
    events,
    rootRoutes: true,
    apiBase: joinPaths(normalizedBasePath, '/__db'),
    dataPath: joinPaths(normalizedBasePath, '/db'),
    graphqlPath: joinPaths(normalizedBasePath, '/graphql'),
  });
  const manifestUrl = pathToFileURL(path.join(cwd, 'src/generated/db.schema.json'));
  let watcher;
  let closed = false;

  try {
    watcher = await watchSourceDir(db, events);
  } catch (error) {
    events.close();
    await db.close?.();
    throw error;
  }

  return {
    db,
    async handleRequest(request, response) {
      try {
        const handled = await handleSchemaUiSsrRequest(request, response, {
          cwd,
          db,
          basePath: normalizedBasePath,
          manifestUrl,
        });
        if (handled) {
          return;
        }

        await dbHandler(request, response);
      } catch (error) {
        sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
      }
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      watcher?.close();
      events.close();
      await db.close?.();
    },
  };
}

function normalizeBasePath(basePath) {
  if (!basePath || basePath === '/') {
    return '';
  }
  return `/${String(basePath).replace(/^\/+|\/+$/gu, '')}`;
}

function joinPaths(basePath, childPath) {
  const normalizedBase = normalizeBasePath(basePath);
  const normalizedChild = `/${String(childPath).replace(/^\/+/u, '')}`;
  return `${normalizedBase}${normalizedChild}`;
}

/**
 * Backward-compatible standalone HTTP server wrapper for this example.
 *
 * @param {{ cwd: string; host?: string; port: number; skipSync?: boolean }} options
 */
export async function startSchemaUiServer(options) {
  const {
    host = '127.0.0.1',
    port,
  } = options;
  const runtime = await createSchemaUiRuntime(options);
  const server = http.createServer((request, response) => {
    runtime.handleRequest(request, response).catch((error) => {
      sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
    });
  });

  server.once('close', () => {
    void runtime.close();
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    await runtime.close();
    throw error;
  }

  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;

  return {
    server,
    db: runtime.db,
    url: `http://${host}:${boundPort}`,
  };
}
