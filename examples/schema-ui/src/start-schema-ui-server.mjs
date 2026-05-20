import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb } from '../../../src/index.js';
import { serializeError } from '../../../src/errors.js';
import { sendJson } from '../../../src/rest/handler.js';
import {
  createDbRequestHandler,
  createViewerEventHub,
  watchSourceDir,
} from '../../../src/server.js';
import { handleSchemaUiSsrRequest } from './schema-ui-ssr-handler.mjs';

/**
 * Schema UI demo: SSR CMS routes composed ahead of the stock db REST / viewer stack.
 *
 * @param {{ cwd: string; host?: string; port: number; skipSync?: boolean }} options
 */
export async function startSchemaUiServer(options) {
  const {
    cwd,
    host = '127.0.0.1',
    port,
    skipSync = false,
  } = options;

  const db = await openDb({
    cwd,
    allowSourceErrors: true,
    syncOnOpen: !skipSync,
  });

  if (skipSync) {
    await db.runtime.hydrate();
  }

  const events = createViewerEventHub();
  const dbHandler = createDbRequestHandler(db, { events, rootRoutes: true });
  const manifestUrl = pathToFileURL(path.join(cwd, 'src/generated/db.schema.json'));

  const server = http.createServer(async (request, response) => {
    try {
      const handled = await handleSchemaUiSsrRequest(request, response, {
        cwd,
        db,
        manifestUrl,
      });
      if (handled) {
        return;
      }

      await dbHandler(request, response);
    } catch (error) {
      sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
    }
  });

  let watcher;
  server.once('close', () => {
    watcher?.close();
    events.close();
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });

    watcher = await watchSourceDir(db, events);
  } catch (error) {
    events.close();
    try {
      server.close();
    } catch {
      // The server may not have reached the listening state.
    }
    throw error;
  }

  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;

  return {
    server,
    db,
    url: `http://${host}:${boundPort}`,
  };
}
