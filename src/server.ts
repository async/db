import http, { type Server } from 'node:http';
import { serializeError } from './errors.js';
import {
  createDbRequestHandler,
  createViewerEventHub,
  type ServerDb,
  type ViewerEventHub,
} from './request-handler.js';
import { sendJson } from './rest/handler.js';
import { createDbRuntime, reloadDb as reloadRuntimeDb, watchDbSources } from './runtime.js';

type StartServerOptions = Record<string, unknown> & {
  host?: string;
  port?: string | number;
};

type WatchSourceOptions = {
  watch?: unknown;
  debounceMs?: number;
  warn?: (message: string) => unknown;
};

type SourceWatcher = {
  readonly enabled: boolean;
  close(): void;
};

type ErrorWithStatus = Error & {
  status?: number;
};

export { createDbRequestHandler, createViewerEventHub };

export async function startDbServer(options: StartServerOptions = {}): Promise<{ server: Server; db: ServerDb; url: string }> {
  const runtime = await createDbRuntime({
    ...options,
    allowSourceErrors: true,
    handler: {
      rootRoutes: true,
    },
  });
  const db = runtime.db as ServerDb;
  const host = options.host ?? db.config.server?.host ?? '127.0.0.1';
  const port = Number(options.port ?? db.config.server?.port ?? 7331);
  const server = http.createServer((request, response) => {
    runtime.handleRequest(request, response).catch((error: ErrorWithStatus) => {
      sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
    });
  });
  server.once('close', () => {
    void runtime.close();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
    });
  } catch (error) {
    await runtime.close();
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

export async function reloadDb(db: ServerDb) {
  return await reloadRuntimeDb(db as never);
}

export async function watchSourceDir(db: ServerDb, events: ViewerEventHub, options: WatchSourceOptions = {}): Promise<SourceWatcher> {
  return await watchDbSources(db as never, {
    ...options,
    events: events as never,
  } as never);
}
