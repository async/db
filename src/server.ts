import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openDb } from './db.js';
import { serializeError } from './errors.js';
import { loadForkDb } from './features/config/forks.js';
import { defaultHttpFeatureRegistry } from './features/http/registry.js';
import { assertOperationStrictModeReady } from './features/operations/readiness.js';
import { runMockBehavior } from './mock.js';
import { createDbOperationHandler } from './operations.js';
import { handleRestRequest, readJsonBody, sendJson, sendText } from './rest/handler.js';
import { syncDb } from './sync.js';
import { createRequestTrace, type RequestTrace, tracePhase, tracePhaseSync } from './tracing.js';

type ServerTraceConfig = boolean | {
  enabled?: boolean;
  slowMs?: number;
  console?: boolean;
  events?: boolean;
  header?: string;
} | null;

type ServerDiagnostic = {
  code?: string;
  severity?: 'error' | 'warn' | 'info' | string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
};

type ServerConfig = {
  cwd?: string;
  sourceDir?: string;
  stateDir?: string;
  server?: {
    host?: string;
    port?: number | string;
    apiBase?: string;
    dataPath?: string | false | null;
    maxBodyBytes?: number;
    trace?: ServerTraceConfig;
    expose?: Record<string, unknown>;
    [key: string]: unknown;
  };
  graphql?: {
    enabled?: boolean;
    path?: string;
    [key: string]: unknown;
  };
  rest?: {
    enabled?: boolean;
    [key: string]: unknown;
  };
  operations?: {
    sourceDir?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ServerResource = {
  name: string;
  kind?: string;
  routePath?: string;
  [key: string]: unknown;
};

type ServerDb = {
  config: ServerConfig;
  resources: Map<string, ServerResource>;
  diagnostics?: unknown[];
  schemaVersion?: number;
  close?: () => unknown | Promise<unknown>;
};

type StartServerOptions = Record<string, unknown> & {
  host?: string;
  port?: string | number;
};

type RequestRoutesOptions = Record<string, unknown> & {
  apiBase?: string;
  rootRoutes?: boolean;
  restBasePath?: string | null;
  dataPath?: string | false | null;
  graphqlPath?: string;
  manifestPath?: string;
  manifestJsonPath?: string;
  manifestHtmlPath?: string;
  manifestMarkdownPath?: string;
};

type RequestRoutes = {
  apiBase: string;
  rootRoutes: boolean;
  restBasePath: string | null;
  dataPath: string | null;
  graphqlPath: string;
  viewerPath: string;
  manifestPath: string;
  manifestJsonPath: string;
  manifestHtmlPath: string;
  manifestMarkdownPath: string;
  schemaPath: string;
  batchPath: string;
  importPath: string;
  eventsPath: string;
  logPath: string;
};

type RequestHandlerOptions = RequestRoutesOptions & {
  events?: ViewerEventHub;
  trace?: ServerTraceConfig;
};

type DbRequestHandler = (request: IncomingMessage, response: ServerResponse, next?: () => unknown) => Promise<boolean>;

type ViewerEventPayload = Record<string, unknown> & {
  type: string;
  version?: number;
  diagnostics?: unknown[];
};

type ViewerEventHub = {
  subscribe(request: IncomingMessage, response: ServerResponse, db: ServerDb): void;
  publish(payload: ViewerEventPayload): void;
  close(): void;
};

type WatchSourceOptions = {
  watch?: typeof watch;
  warn?: (message: string) => unknown;
};

type SourceWatcher = {
  readonly enabled: boolean;
  close(): void;
};

type WatchError = Error & {
  code?: string;
};

type ErrorWithStatus = Error & {
  status?: number;
};

type OperationResult = {
  status: number;
  headers?: Record<string, unknown>;
  body?: unknown;
  rawBody?: unknown;
};

type RegisteredOperationHandler = {
  enabled: boolean;
  executeRequest(ref: string, body: unknown, options?: Record<string, unknown>): Promise<OperationResult>;
};

type RouteExposureKind = 'graphql' | 'manifest' | 'rest' | 'schema' | 'viewer';

type RouteExposureViolation = {
  kind: RouteExposureKind;
  exposure: unknown;
  path: string;
};

type RouteExposureLabel = {
  code: string;
  display: string;
};

type TraceRouteDetails = {
  route: string;
  operation?: string;
  [key: string]: unknown;
};

export async function startDbServer(options: StartServerOptions = {}): Promise<{ server: Server; db: ServerDb; url: string }> {
  const db = await openDb({
    ...options,
    allowSourceErrors: true,
  }) as unknown as ServerDb;
  try {
    await assertOperationStrictModeReady(db.config);
  } catch (error) {
    await db.close?.();
    throw error;
  }
  const host = options.host ?? db.config.server?.host ?? '127.0.0.1';
  const port = Number(options.port ?? db.config.server?.port ?? 7331);
  const events = createViewerEventHub();
  const requestHandler = createDbRequestHandler(db, {
    events,
    rootRoutes: true,
  });
  let watcher: SourceWatcher | undefined;
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
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
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

export function createDbRequestHandler(db: ServerDb, options: RequestHandlerOptions = {}): DbRequestHandler {
  const events = options.events ?? createViewerEventHub();
  const routes = resolveRequestRoutes(db.config, options);

  return async function dbRequestHandler(request, response, next) {
    const trace = createRequestTrace(db, request, { trace: options.trace });
    let handled = false;
    try {
      handled = await handleRequest(db, request, response, events, routes, trace);
      if (!handled && typeof next === 'function') {
        next();
      }
      return handled;
    } catch (error) {
      trace?.setError(error);
      throw error;
    } finally {
      trace?.finish(db, response);
    }
  };
}

async function handleRequest(
  db: ServerDb,
  request: IncomingMessage,
  response: ServerResponse,
  events: ViewerEventHub,
  routes: RequestRoutes,
  trace: RequestTrace | null = null,
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://db.local');
  const forkName = tracePhaseSync(trace, 'route-match', () => forkNameForRequest(url, routes), {
    family: 'fork',
  });
  if (forkName) {
    trace?.markHandled(response);
    trace?.setRoute({ route: 'fork', fork: forkName });
    try {
      const forkDb = await tracePhase(trace, 'fork-load', () => loadForkDb(db as never, forkName, openDb), {
        fork: forkName,
      }) as ServerDb;
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
      return tracePhase(trace, 'fork-dispatch', () => handleRequest(forkDb, request, response, events, forkRoutes, trace), {
        fork: forkName,
      });
    } catch (error) {
      trace?.setError(error as ErrorWithStatus);
      sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
      return true;
    }
  }

  if (request.method === 'GET' && url.pathname === routes.eventsPath) {
    trace?.markHandled(response);
    trace?.setRoute({ route: 'events', operation: 'subscribe' });
    events.subscribe(request, response, db);
    return true;
  }

  const operationRef = tracePhaseSync(trace, 'route-match', () => operationRefForRequest(url, routes), {
    family: 'operation',
  });
  if (operationRef) {
    trace?.markHandled(response);
    trace?.setRoute({ route: 'operation', operation: 'execute', id: operationRef });
    await handleRegisteredOperationRequest(db, request, response, operationRef, routes, trace);
    return true;
  }

  const exposureViolation = tracePhaseSync(trace, 'route-exposure', () => routeExposureViolation(db.config, url, routes));
  if (exposureViolation) {
    trace?.markHandled(response);
    trace?.setRoute({ route: exposureViolation.kind, operation: 'exposure-check' });
    sendRouteExposureViolation(response, exposureViolation, routes);
    return true;
  }

  const httpFeatures = defaultHttpFeatureRegistry();
  const featureContext = { db, request, response, url, routes } as never;
  if (httpFeatures.matches(featureContext, { phase: 'preMock' })) {
    trace?.markHandled(response);
    trace?.setRoute(featureTraceRoute(url, routes));
    await tracePhase(trace, 'registered-http-feature', () => httpFeatures.handle(featureContext, { phase: 'preMock' }), {
      phase: 'preMock',
    });
    return true;
  }

  const restUrl = tracePhaseSync(trace, 'route-match', () => restUrlForRequest(url, routes), {
    family: 'rest',
  });
  const handlesRegisteredFeature = httpFeatures.matches(featureContext, { phase: 'postMock' });
  if (!restUrl && !handlesRegisteredFeature) {
    return false;
  }

  if (restUrl && !handlesRegisteredFeature && db.config.rest?.enabled === false) {
    trace?.markHandled(response);
    await handleRestRequest(db, request, response, restUrl, { ...routes, trace });
    return true;
  }

  const mockResult = await tracePhase(trace, 'mock', () => runMockBehavior(db.config, url));
  if (mockResult) {
    trace?.markHandled(response);
    trace?.setRoute({ route: restUrl ? 'rest' : 'mock', operation: 'mock', shortCircuit: true });
    sendJson(response, mockResult.status, mockResult.body);
    return true;
  }

  if (handlesRegisteredFeature) {
    trace?.markHandled(response);
    trace?.setRoute(featureTraceRoute(url, routes));
    await tracePhase(trace, 'registered-http-feature', () => httpFeatures.handle(featureContext, { phase: 'postMock' }), {
      phase: 'postMock',
    });
    return true;
  }

  trace?.markHandled(response);
  await tracePhase(trace, 'rest-handler', () => handleRestRequest(db, request, response, restUrl, { ...routes, trace }));
  return true;
}

async function handleRegisteredOperationRequest(
  db: ServerDb,
  request: IncomingMessage,
  response: ServerResponse,
  ref: string,
  routes: RequestRoutes,
  trace: RequestTrace | null = null,
): Promise<void> {
  const operationHandler = createDbOperationHandler(db as never) as RegisteredOperationHandler;
  if (!operationHandler.enabled) {
    sendJson(response, 404, {
      error: {
        code: 'OPERATIONS_DISABLED',
        message: 'Registered operations are not enabled.',
        hint: 'Set operations.enabled to true and provide operations.registry or outputs.operationRegistry.',
      },
    });
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, {
      error: {
        code: 'OPERATION_METHOD_NOT_ALLOWED',
        message: 'Registered operations must be executed with POST.',
        hint: `Use POST ${joinPaths(routes.apiBase || '', `/operations/${encodeURIComponent(ref)}`)} with a JSON variables body.`,
        details: {
          method: request.method,
          ref,
        },
      },
    });
    return;
  }

  const body = await tracePhase(trace, 'registered-operation-body', () => readJsonBody(request, {
    maxBytes: Number(db.config.server?.maxBodyBytes ?? 1048576),
  }));
  const result = await tracePhase(trace, 'registered-operation-execution', () => operationHandler.executeRequest(ref, body, {
    routes,
    trace,
  }), {
    ref,
  });
  sendOperationResult(response, result);
}

function sendOperationResult(response: ServerResponse, result: OperationResult): void {
  const contentType = String(result.headers?.['content-type'] ?? '');
  if (contentType.includes('application/json')) {
    sendJson(response, result.status, result.body);
    return;
  }
  sendText(response, result.status, result.rawBody ?? String(result.body ?? ''), contentType || 'text/plain; charset=utf-8');
}

export async function reloadDb(db: ServerDb) {
  const project = await syncDb(db.config as never, { allowErrors: true });
  db.resources = new Map(project.resources.map((resource) => [resource.name, resource]));
  db.diagnostics = project.diagnostics;
  db.schemaVersion = Date.now();
  return project;
}

export async function watchSourceDir(db: ServerDb, events: ViewerEventHub, options: WatchSourceOptions = {}): Promise<SourceWatcher> {
  await mkdir(db.config.sourceDir, { recursive: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let enabled = true;
  const watchImpl = options.watch ?? watch;
  const warn = options.warn ?? ((message) => console.warn(message));
  let watcher: FSWatcher | undefined;

  try {
    watcher = watchImpl(db.config.sourceDir, { recursive: true }, (_event, filename) => {
      if (!enabled || shouldIgnoreSourceEvent(db, filename)) {
        return;
      }

      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const project = await reloadDb(db);
          events.publish({
            type: (project.diagnostics as ServerDiagnostic[]).some((diagnostic) => diagnostic.severity === 'error') ? 'synced-with-errors' : 'synced',
            version: db.schemaVersion,
            diagnostics: project.diagnostics,
          });
        } catch (error) {
          const diagnostic: ServerDiagnostic = {
            code: 'SERVER_SOURCE_RELOAD_FAILED',
            severity: 'error',
            message: error.message,
            hint: 'Fix the source file and db will try to reload it on the next change.',
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
    reportWatchUnavailable(db, events, error as WatchError, warn);
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
    reportWatchUnavailable(db, events, error as WatchError, warn);
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

function reportWatchUnavailable(db: ServerDb, events: ViewerEventHub, error: WatchError, warn: (message: string) => unknown): void {
  const diagnostic = {
    code: 'SERVER_WATCH_UNAVAILABLE',
    severity: 'warn',
    message: `File watching is disabled: ${error.message}`,
    hint: 'async-db serve is still running, but fixture changes will require restarting the server.',
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
  warn(`async-db serve: file watching disabled (${error.message}). Restart the server to pick up fixture changes.`);
}

function shouldIgnoreSourceEvent(db: ServerDb, filename: string | Buffer | null | undefined): boolean {
  if (!filename) {
    return false;
  }

  const relativePath = path.normalize(String(filename));
  if (relativePath.split(path.sep).some((part) => part.startsWith('.'))) {
    return true;
  }

  const absolutePath = path.join(db.config.sourceDir, relativePath);
  if (db.config.operations?.sourceDir && isInsideOrEqualPath(db.config.operations.sourceDir, absolutePath)) {
    return true;
  }

  const relativeStatePath = path.relative(db.config.stateDir, absolutePath);
  return relativeStatePath === '' || (!relativeStatePath.startsWith('..') && !path.isAbsolute(relativeStatePath));
}

function isInsideOrEqualPath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function createViewerEventHub(): ViewerEventHub {
  const clients = new Set<ServerResponse>();

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

function writeViewerEvent(response: ServerResponse, payload: unknown): void {
  response.write(`event: db\ndata: ${JSON.stringify(payload)}\n\n`);
}

function resolveRequestRoutes(config: ServerConfig, options: RequestRoutesOptions = {}): RequestRoutes {
  const apiBase = normalizeBasePath(options.apiBase ?? config.server?.apiBase ?? '/__db');
  const restBasePath = options.restBasePath === undefined
    ? `${apiBase}/rest`
    : normalizeOptionalBasePath(options.restBasePath);
  const dataPath = options.dataPath === undefined
    ? normalizeOptionalBasePath(config.server?.dataPath ?? '/db')
    : normalizeOptionalBasePath(options.dataPath);
  const graphqlPath = normalizeBasePath(options.graphqlPath ?? config.graphql?.path ?? '/graphql');

  return {
    apiBase,
    rootRoutes: options.rootRoutes !== false,
    restBasePath,
    dataPath,
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

function forkNameForRequest(url: URL, routes: RequestRoutes): string | null {
  const prefix = `${routes.apiBase || ''}/forks/` || '/forks/';
  if (!url.pathname.startsWith(prefix)) {
    return null;
  }

  const [rawName] = url.pathname.slice(prefix.length).split('/');
  return rawName ? decodeURIComponent(rawName) : null;
}

function forkApiBase(routes: RequestRoutes, forkName: string): string {
  return joinPaths(routes.apiBase || '', `/forks/${encodeURIComponent(forkName)}`);
}

function operationRefForRequest(url: URL, routes: RequestRoutes): string | null {
  const prefix = `${joinPaths(routes.apiBase || '', '/operations')}/`;
  if (!url.pathname.startsWith(prefix)) {
    return null;
  }

  const [ref] = url.pathname.slice(prefix.length).split('/');
  return ref ? decodeURIComponent(ref) : null;
}

function routeExposureViolation(config: ServerConfig, url: URL, routes: RequestRoutes): RouteExposureViolation | null {
  const kind = routeExposureKind(url, routes);
  if (!kind) {
    return null;
  }

  const exposure = config.server?.expose?.[kind] ?? 'open';
  if (routeExposureAllows(exposure)) {
    return null;
  }

  return {
    kind,
    exposure,
    path: url.pathname,
  };
}

function routeExposureKind(url: URL, routes: RequestRoutes): RouteExposureKind | null {
  if (url.pathname === routes.graphqlPath) {
    return 'graphql';
  }

  if (url.pathname === routes.schemaPath) {
    return 'schema';
  }

  if (isManifestRoutePath(url.pathname, routes)) {
    return 'manifest';
  }

  if ([routes.viewerPath, routes.eventsPath, routes.logPath, routes.importPath].includes(url.pathname)) {
    return 'viewer';
  }

  if (isRestExposurePath(url, routes)) {
    return 'rest';
  }

  return null;
}

function isRestExposurePath(url: URL, routes: RequestRoutes): boolean {
  if (url.pathname === routes.batchPath) {
    return true;
  }

  if (routes.restBasePath && pathStartsWith(url.pathname, routes.restBasePath)) {
    return true;
  }

  if (routes.dataPath && pathStartsWith(url.pathname, routes.dataPath)) {
    return true;
  }

  return routes.rootRoutes === true;
}

function routeExposureAllows(exposure: unknown): boolean {
  if (exposure === undefined || exposure === null || exposure === 'open') {
    return true;
  }

  if (exposure === 'dev') {
    return process.env.NODE_ENV !== 'production';
  }

  return false;
}

function sendRouteExposureViolation(response: ServerResponse, violation: RouteExposureViolation, routes: RequestRoutes): void {
  const label = routeExposureLabel(violation.kind);

  if (violation.kind === 'rest' && violation.exposure === 'registered-only') {
    sendJson(response, 403, {
      error: {
        code: 'REST_REGISTERED_ONLY',
        message: 'Raw REST routes are configured for registered operations only.',
        hint: `Use POST ${joinPaths(routes.apiBase || '', '/operations/{ref}')} with a registered operation ref.`,
        details: {
          path: violation.path,
          exposure: violation.exposure,
          route: violation.kind,
        },
      },
    });
    return;
  }

  if (violation.exposure === 'registered-only') {
    sendJson(response, 403, {
      error: {
        code: `${label.code}_REGISTERED_ONLY`,
        message: `${label.display} routes are configured for registered operations only.`,
        hint: `Set server.expose.${violation.kind} to "open" or "dev" when this route should be reachable.`,
        details: {
          path: violation.path,
          exposure: violation.exposure,
          route: violation.kind,
        },
      },
    });
    return;
  }

  if (violation.exposure === 'dev') {
    sendJson(response, 404, {
      error: {
        code: `${label.code}_DEV_ONLY`,
        message: `${label.display} routes are only exposed outside NODE_ENV=production.`,
        hint: `Set server.expose.${violation.kind} to "open" when this route should be reachable in production.`,
        details: {
          path: violation.path,
          exposure: violation.exposure,
          route: violation.kind,
        },
      },
    });
    return;
  }

  sendJson(response, 404, {
    error: {
      code: `${label.code}_DISABLED`,
      message: `${label.display} routes are disabled by server exposure policy.`,
      hint: `Set server.expose.${violation.kind} to "open" or "dev" when this route should be reachable.`,
      details: {
        path: violation.path,
        exposure: violation.exposure,
        route: violation.kind,
      },
    },
  });
}

function routeExposureLabel(kind: RouteExposureKind): RouteExposureLabel {
  const labels = {
    graphql: {
      code: 'GRAPHQL',
      display: 'GraphQL',
    },
    manifest: {
      code: 'MANIFEST',
      display: 'Manifest',
    },
    rest: {
      code: 'REST',
      display: 'REST',
    },
    schema: {
      code: 'SCHEMA',
      display: 'Schema',
    },
    viewer: {
      code: 'VIEWER',
      display: 'Viewer',
    },
  };
  return labels[kind] ?? {
    code: 'ROUTE',
    display: 'Route',
  };
}

function featureTraceRoute(url: URL, routes: RequestRoutes): TraceRouteDetails {
  if (url.pathname === routes.logPath) {
    return { route: 'runtime-log', operation: 'subscribe' };
  }
  if (url.pathname === routes.graphqlPath) {
    return { route: 'graphql', operation: 'execute' };
  }
  return { route: 'http-feature' };
}

function restUrlForRequest(url: URL, routes: RequestRoutes): URL | null {
  if (routes.restBasePath && pathStartsWith(url.pathname, routes.restBasePath)) {
    return stripPathBase(url, routes.restBasePath);
  }

  if ([routes.viewerPath, routes.schemaPath, routes.batchPath, routes.importPath].includes(url.pathname) || isManifestRoutePath(url.pathname, routes)) {
    return url;
  }

  if (routes.dataPath && pathStartsWith(url.pathname, routes.dataPath)) {
    return stripPathBase(url, routes.dataPath);
  }

  if (routes.rootRoutes) {
    return url;
  }

  return null;
}

function isManifestRoutePath(pathname: string, routes: RequestRoutes): boolean {
  if ([routes.manifestPath, routes.manifestJsonPath, routes.manifestHtmlPath, routes.manifestMarkdownPath].includes(pathname)) {
    return true;
  }

  if (!pathname.startsWith(`${routes.manifestPath}.`)) {
    return false;
  }

  const extension = pathname.slice(routes.manifestPath.length + 1);
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(extension);
}

function joinPaths(basePath: unknown, routePath: unknown): string {
  const base = `/${String(basePath ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  const route = `/${String(routePath ?? '').replace(/^\/+/, '')}`;
  if (base === '/') {
    return route;
  }
  return `${base}${route === '/' ? '' : route}`;
}

function stripPathBase(url: URL, basePath: string): URL {
  const next = new URL(url.href);
  const stripped = next.pathname.slice(basePath.length);
  next.pathname = stripped.startsWith('/') ? stripped : `/${stripped}`;
  if (next.pathname === '/') {
    return next;
  }
  return next;
}

function normalizeOptionalBasePath(value: unknown): string | null {
  return value === false || value === null
    ? null
    : normalizeBasePath(value);
}

function pathStartsWith(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function normalizeBasePath(value: unknown): string {
  const pathValue = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return pathValue === '/' ? '' : pathValue;
}
