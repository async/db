import http from 'node:http';
import { watch } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openJsonFixtureDb } from './db.js';
import { serializeError } from './errors.js';
import { loadForkDb } from './features/config/forks.js';
import { defaultHttpFeatureRegistry } from './features/http/registry.js';
import { runMockBehavior } from './mock.js';
import { handleRestRequest, sendJson } from './rest/handler.js';
import { syncJsonFixtureDb } from './sync.js';

export async function startJsonDbServer(options = {}) {
  const db = await openJsonFixtureDb({
    ...options,
    allowSourceErrors: true,
  });
  const host = options.host ?? db.config.server?.host ?? '127.0.0.1';
  const port = Number(options.port ?? db.config.server?.port ?? 7331);
  const events = createViewerEventHub();
  const requestHandler = createJsonDbRequestHandler(db, {
    events,
    rootRoutes: true,
  });
  let watcher;
  const server = http.createServer((request, response) => {
    requestHandler(request, response).catch((error) => {
      sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
    });
  });
  server.once('close', () => {
    watcher?.close();
    events.close();
    void db.close?.();
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

export function createJsonDbRequestHandler(db, options = {}) {
  const events = options.events ?? createViewerEventHub();
  const routes = resolveRequestRoutes(db.config, options);

  return async function jsonDbRequestHandler(request, response, next) {
    const handled = await handleRequest(db, request, response, events, routes);
    if (!handled && typeof next === 'function') {
      next();
    }
    return handled;
  };
}

async function handleRequest(db, request, response, events, routes) {
  const url = new URL(request.url, 'http://jsondb.local');
  const forkName = forkNameForRequest(url, routes);
  if (forkName) {
    try {
      const forkDb = await loadForkDb(db, forkName, openJsonFixtureDb);
      const forkRoutes = resolveRequestRoutes(forkDb.config, {
        ...routes,
        apiBase: forkApiBase(routes, forkName),
        rootRoutes: false,
        restBasePath: `${forkApiBase(routes, forkName)}/rest`,
        graphqlPath: `${forkApiBase(routes, forkName)}/graphql`,
        manifestPath: `${forkApiBase(routes, forkName)}/manifest`,
        manifestJsonPath: `${forkApiBase(routes, forkName)}/manifest.json`,
        manifestHtmlPath: `${forkApiBase(routes, forkName)}/manifest.html`,
        manifestMarkdownPath: `${forkApiBase(routes, forkName)}/manifest.md`,
      });
      return handleRequest(forkDb, request, response, events, forkRoutes);
    } catch (error) {
      sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
      return true;
    }
  }

  if (request.method === 'GET' && url.pathname === routes.eventsPath) {
    events.subscribe(request, response, db);
    return true;
  }

  const httpFeatures = defaultHttpFeatureRegistry();
  if (await httpFeatures.handle({ db, request, response, url, routes }, { phase: 'preMock' })) {
    return true;
  }

  const restUrl = restUrlForRequest(url, routes);
  const handlesRegisteredFeature = httpFeatures.matches({ db, request, response, url, routes }, { phase: 'postMock' });
  if (!restUrl && !handlesRegisteredFeature) {
    return false;
  }

  if (restUrl && !handlesRegisteredFeature && db.config.rest?.enabled === false) {
    await handleRestRequest(db, request, response, restUrl, routes);
    return true;
  }

  const mockResult = await runMockBehavior(db.config, url);
  if (mockResult) {
    sendJson(response, mockResult.status, mockResult.body);
    return true;
  }

  if (await httpFeatures.handle({ db, request, response, url, routes }, { phase: 'postMock' })) {
    return true;
  }

  await handleRestRequest(db, request, response, restUrl, routes);
  return true;
}

export async function reloadJsonFixtureDb(db) {
  const project = await syncJsonFixtureDb(db.config, { allowErrors: true });
  db.resources = new Map(project.resources.map((resource) => [resource.name, resource]));
  db.diagnostics = project.diagnostics;
  db.schemaVersion = Date.now();
  return project;
}

export async function watchSourceDir(db, events, options = {}) {
  await mkdir(db.config.sourceDir, { recursive: true });

  let timer;
  let enabled = true;
  const watchImpl = options.watch ?? watch;
  const warn = options.warn ?? ((message) => console.warn(message));
  let watcher;

  try {
    watcher = watchImpl(db.config.sourceDir, { recursive: true }, (_event, filename) => {
      if (!enabled || shouldIgnoreSourceEvent(db, filename)) {
        return;
      }

      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const project = await reloadJsonFixtureDb(db);
          events.publish({
            type: project.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'synced-with-errors' : 'synced',
            version: db.schemaVersion,
            diagnostics: project.diagnostics,
          });
        } catch (error) {
          const diagnostic = {
            code: 'SERVER_SOURCE_RELOAD_FAILED',
            severity: 'error',
            message: error.message,
            hint: 'Fix the source file and jsondb will try to reload it on the next change.',
          };
          db.diagnostics = [diagnostic];
          db.schemaVersion = Date.now();
          events.publish({
            type: 'sync-error',
            version: db.schemaVersion,
            diagnostics: db.diagnostics,
          });
        }
      }, 75);
    });
  } catch (error) {
    enabled = false;
    reportWatchUnavailable(db, events, error, warn);
    return {
      enabled,
      close() {
        clearTimeout(timer);
      },
    };
  }

  watcher.on?.('error', (error) => {
    if (!enabled) {
      return;
    }

    enabled = false;
    clearTimeout(timer);
    try {
      watcher.close();
    } catch {
      // The watcher may already be closed by the runtime.
    }
    reportWatchUnavailable(db, events, error, warn);
  });

  return {
    get enabled() {
      return enabled;
    },
    close() {
      enabled = false;
      clearTimeout(timer);
      try {
        watcher.close();
      } catch {
        // The watcher may already be closed after an error event.
      }
    },
  };
}

function reportWatchUnavailable(db, events, error, warn) {
  const diagnostic = {
    code: 'SERVER_WATCH_UNAVAILABLE',
    severity: 'warn',
    message: `File watching is disabled: ${error.message}`,
    hint: 'jsondb serve is still running, but fixture changes will require restarting the server.',
    details: {
      code: error.code,
    },
  };

  db.diagnostics = [...(db.diagnostics ?? []), diagnostic];
  db.schemaVersion = Date.now();
  events.publish({
    type: 'watch-disabled',
    version: db.schemaVersion,
    diagnostics: db.diagnostics,
  });
  warn(`jsondb serve: file watching disabled (${error.message}). Restart the server to pick up fixture changes.`);
}

function shouldIgnoreSourceEvent(db, filename) {
  if (!filename) {
    return false;
  }

  const relativePath = path.normalize(String(filename));
  if (relativePath.split(path.sep).some((part) => part.startsWith('.'))) {
    return true;
  }

  const absolutePath = path.join(db.config.sourceDir, relativePath);
  const relativeStatePath = path.relative(db.config.stateDir, absolutePath);
  return relativeStatePath === '' || (!relativeStatePath.startsWith('..') && !path.isAbsolute(relativeStatePath));
}

export function createViewerEventHub() {
  const clients = new Set();

  return {
    subscribe(request, response, db) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      writeViewerEvent(response, {
        type: 'connected',
        version: db.schemaVersion,
        diagnostics: db.diagnostics ?? [],
      });
      clients.add(response);
      request.on('close', () => {
        clients.delete(response);
      });
    },
    publish(payload) {
      for (const response of clients) {
        writeViewerEvent(response, payload);
      }
    },
    close() {
      for (const response of clients) {
        response.end();
      }
      clients.clear();
    },
  };
}

function writeViewerEvent(response, payload) {
  response.write(`event: jsondb\ndata: ${JSON.stringify(payload)}\n\n`);
}

function resolveRequestRoutes(config, options) {
  const apiBase = normalizeBasePath(options.apiBase ?? config.server?.apiBase ?? '/__jsondb');
  const restBasePath = options.restBasePath === undefined
    ? null
    : normalizeBasePath(options.restBasePath);
  const graphqlPath = normalizeBasePath(options.graphqlPath ?? config.graphql?.path ?? '/graphql');

  return {
    apiBase,
    rootRoutes: options.rootRoutes !== false,
    restBasePath,
    graphqlPath,
    viewerPath: apiBase,
    manifestPath: `${apiBase}/manifest`,
    manifestJsonPath: `${apiBase}/manifest.json`,
    manifestHtmlPath: `${apiBase}/manifest.html`,
    manifestMarkdownPath: `${apiBase}/manifest.md`,
    schemaPath: `${apiBase}/schema`,
    batchPath: `${apiBase}/batch`,
    importPath: `${apiBase}/import`,
    eventsPath: `${apiBase}/events`,
    logPath: `${apiBase}/log`,
  };
}

function forkNameForRequest(url, routes) {
  const prefix = `${routes.apiBase || ''}/forks/` || '/forks/';
  if (!url.pathname.startsWith(prefix)) {
    return null;
  }

  const [rawName] = url.pathname.slice(prefix.length).split('/');
  return rawName ? decodeURIComponent(rawName) : null;
}

function forkApiBase(routes, forkName) {
  return joinPaths(routes.apiBase || '', `/forks/${encodeURIComponent(forkName)}`);
}

function restUrlForRequest(url, routes) {
  if (routes.restBasePath && pathStartsWith(url.pathname, routes.restBasePath)) {
    return stripPathBase(url, routes.restBasePath);
  }

  if (routes.rootRoutes) {
    return url;
  }

  if ([routes.viewerPath, routes.schemaPath, routes.batchPath, routes.importPath].includes(url.pathname) || isManifestRoutePath(url.pathname, routes)) {
    return url;
  }

  return null;
}

function isManifestRoutePath(pathname, routes) {
  if ([routes.manifestPath, routes.manifestJsonPath, routes.manifestHtmlPath, routes.manifestMarkdownPath].includes(pathname)) {
    return true;
  }

  if (!pathname.startsWith(`${routes.manifestPath}.`)) {
    return false;
  }

  const extension = pathname.slice(routes.manifestPath.length + 1);
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(extension);
}

function joinPaths(basePath, routePath) {
  const base = `/${String(basePath ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  const route = `/${String(routePath ?? '').replace(/^\/+/, '')}`;
  if (base === '/') {
    return route;
  }
  return `${base}${route === '/' ? '' : route}`;
}

function stripPathBase(url, basePath) {
  const next = new URL(url.href);
  const stripped = next.pathname.slice(basePath.length);
  next.pathname = stripped.startsWith('/') ? stripped : `/${stripped}`;
  if (next.pathname === '/') {
    return next;
  }
  return next;
}

function pathStartsWith(pathname, basePath) {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function normalizeBasePath(value) {
  const pathValue = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return pathValue === '/' ? '' : pathValue;
}
