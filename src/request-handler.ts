import { mkdir, rm, writeFile } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { serializeError } from './errors.js';
import { defaultHttpFeatureRegistry } from './features/http/registry.js';
import { runMockBehavior } from './mock.js';
import { createDbOperationHandler } from './operations.js';
import { handleRestRequest, readJsonBody, sendJson, sendText } from './rest/handler.js';
import { isProductionEnv } from './shared/env.js';
import { createRequestTrace, type RequestTrace, tracePhase, tracePhaseSync } from './tracing.js';

export type ServerTraceConfig = boolean | {
  enabled?: boolean;
  slowMs?: number;
  console?: boolean;
  events?: boolean;
  header?: string;
} | null;

export type ServerConfig = {
  cwd?: string;
  sourceDir?: string;
  stateDir?: string;
  server?: {
    host?: string;
    port?: number | string;
    apiBase?: string;
    dataPath?: string | false | null;
    maxBodyBytes?: number;
    maxEventClients?: number;
    trace?: ServerTraceConfig;
    expose?: Record<string, unknown>;
    authorize?: ServerAuthorizeHook;
    [key: string]: unknown;
  };
  graphql?: {
    enabled?: boolean;
    path?: string;
    [key: string]: unknown;
  };
  falcor?: {
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

export type ServerResource = {
  name: string;
  kind?: string;
  routePath?: string;
  [key: string]: unknown;
};

export type ServerDb = {
  config: ServerConfig;
  resources: Map<string, ServerResource>;
  diagnostics?: unknown[];
  schemaVersion?: number;
  close?: () => unknown | Promise<unknown>;
};

type RequestRoutesOptions = Record<string, unknown> & {
  apiBase?: string;
  rootRoutes?: boolean;
  restBasePath?: string | null;
  dataPath?: string | false | null;
  graphqlPath?: string;
  falcorPath?: string;
  manifestPath?: string;
  manifestJsonPath?: string;
  manifestHtmlPath?: string;
  manifestMarkdownPath?: string;
  resourceBasePath?: string;
};

type RequestRoutes = {
  apiBase: string;
  rootRoutes: boolean;
  restBasePath: string | null;
  dataPath: string | null;
  graphqlPath: string;
  graphqlAliases: string[];
  falcorPath: string;
  falcorAliases: string[];
  viewerPath: string;
  manifestPath: string;
  manifestJsonPath: string;
  manifestHtmlPath: string;
  manifestMarkdownPath: string;
  schemaPath: string;
  batchPath: string;
  batchAliases: string[];
  resourceBasePath: string;
  importPath: string;
  eventsPath: string;
  logPath: string;
  healthPath: string;
};

export type RequestHandlerOptions = RequestRoutesOptions & {
  events?: ViewerEventHub;
  trace?: ServerTraceConfig;
};

export type DbRequestHandler = (request: IncomingMessage, response: ServerResponse, next?: () => unknown) => Promise<boolean>;

type ViewerEventPayload = Record<string, unknown> & {
  type: string;
  version?: number;
  diagnostics?: unknown[];
};

type RuntimeEventBus = {
  subscribe(listener: (payload: ViewerEventPayload) => void): () => void;
  publish(payload: ViewerEventPayload): void;
  close(): void;
};

export type ViewerEventHub = {
  subscribe(request: IncomingMessage, response: ServerResponse, db: ServerDb): void;
  publish(payload: ViewerEventPayload): void;
  close(): void;
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

type RouteExposureKind = 'falcor' | 'graphql' | 'health' | 'manifest' | 'rest' | 'schema' | 'viewer';

export type ServerAuthorizeContext = {
  request: IncomingMessage;
  url: URL;
  method: string;
  /** Matched route family: rest, graphql, falcor, viewer, schema, manifest, health, events, or operation. */
  route: string;
};

export type ServerAuthorizeResult = boolean | undefined | null | void | {
  status?: number;
  body?: unknown;
};

/**
 * App-owned per-request authorization seam for the core handler. Return true
 * (or nothing) to allow, false for a 403, or `{ status, body }` for a custom
 * denial such as a 401 challenge. Runs only for requests the db handler will
 * handle, so middleware chains keep working for app routes.
 */
export type ServerAuthorizeHook = (context: ServerAuthorizeContext) => ServerAuthorizeResult | Promise<ServerAuthorizeResult>;

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

const VIEWER_EVENT_HEARTBEAT_MS = 30_000;
const DEFAULT_MAX_EVENT_CLIENTS = 100;

export function createViewerEventHub(events?: RuntimeEventBus): ViewerEventHub {
  const clients = new Set<ServerResponse>();
  let heartbeat: NodeJS.Timeout | null = null;

  function dropClient(client: ServerResponse): void {
    clients.delete(client);
    if (clients.size === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  function writeToClient(client: ServerResponse, chunk: string): void {
    if (client.destroyed || client.writableEnded) {
      dropClient(client);
      return;
    }
    try {
      client.write(chunk);
    } catch {
      // A client that fails mid-write is gone; never let one dead socket
      // break event delivery for the others.
      dropClient(client);
    }
  }

  function broadcast(payload: ViewerEventPayload): void {
    for (const client of [...clients]) {
      writeToClient(client, viewerEventChunk(payload));
    }
  }

  function ensureHeartbeat(): void {
    if (heartbeat) {
      return;
    }
    // Periodic comments keep idle SSE connections alive through proxies and
    // surface dead sockets so they get cleaned up instead of leaking.
    heartbeat = setInterval(() => {
      for (const client of [...clients]) {
        writeToClient(client, ': ping\n\n');
      }
    }, VIEWER_EVENT_HEARTBEAT_MS);
    heartbeat.unref?.();
  }

  const unsubscribe = events?.subscribe((payload) => {
    broadcast(payload);
  });

  return {
    subscribe(request, response, db) {
      const maxClients = Number(db.config.server?.maxEventClients ?? DEFAULT_MAX_EVENT_CLIENTS);
      if (clients.size >= maxClients) {
        sendJson(response, 503, {
          error: {
            code: 'VIEWER_EVENTS_LIMIT',
            message: `The events endpoint already has ${clients.size} subscribers.`,
            hint: 'Close unused viewer tabs or raise server.maxEventClients when many local subscribers are expected.',
            details: {
              maxEventClients: maxClients,
            },
          },
        });
        return;
      }

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
      ensureHeartbeat();
      request.on?.('close', () => {
        dropClient(response);
      });
      response.on?.('close', () => {
        dropClient(response);
      });
      response.on?.('error', () => {
        dropClient(response);
      });
    },
    publish(payload) {
      if (events) {
        events.publish(payload);
        return;
      }
      broadcast(payload);
    },
    close() {
      unsubscribe?.();
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      for (const client of clients) {
        try {
          client.end();
        } catch {
          // Closing an already-broken client must not block hub shutdown.
        }
      }
      clients.clear();
    },
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
  if (request.method === 'GET' && url.pathname === routes.eventsPath) {
    trace?.markHandled(response);
    trace?.setRoute({ route: 'events', operation: 'subscribe' });
    if (!await authorizeRequest(db, request, response, url, 'events')) {
      return true;
    }
    events.subscribe(request, response, db);
    return true;
  }

  if (request.method === 'GET' && url.pathname === routes.healthPath) {
    trace?.markHandled(response);
    trace?.setRoute({ route: 'health', operation: 'check' });
    const healthViolation = routeExposureViolation(db.config, url, routes);
    if (healthViolation) {
      sendRouteExposureViolation(response, healthViolation, routes);
      return true;
    }
    if (!await authorizeRequest(db, request, response, url, 'health')) {
      return true;
    }
    await handleHealthRequest(db, response);
    return true;
  }

  const operationRef = tracePhaseSync(trace, 'route-match', () => operationRefForRequest(url, routes), {
    family: 'operation',
  });
  if (operationRef) {
    trace?.markHandled(response);
    trace?.setRoute({ route: 'operation', operation: 'execute', id: operationRef });
    if (!await authorizeRequest(db, request, response, url, 'operation')) {
      return true;
    }
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
    if (!await authorizeRequest(db, request, response, url, String(featureTraceRoute(url, routes).route))) {
      return true;
    }
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

  // From here the request is definitely db-handled (REST, viewer, manifest,
  // schema, or a registered feature), so the authorize hook runs exactly once.
  if (!await authorizeRequest(db, request, response, url, routeExposureKind(url, routes) ?? 'rest')) {
    trace?.markHandled(response);
    return true;
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

async function authorizeRequest(
  db: ServerDb,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  route: string,
): Promise<boolean> {
  const authorize = db.config.server?.authorize;
  if (typeof authorize !== 'function') {
    return true;
  }

  let result: ServerAuthorizeResult;
  try {
    result = await authorize({
      request,
      url,
      method: String(request.method ?? 'GET').toUpperCase(),
      route,
    });
  } catch (error) {
    sendJson(response, 500, serializeError(error, 'SERVER_AUTHORIZE_ERROR'));
    return false;
  }

  if (result === true || result === undefined || result === null) {
    return true;
  }

  if (result === false) {
    sendJson(response, 403, {
      error: {
        code: 'SERVER_AUTHORIZATION_DENIED',
        message: 'The server.authorize hook denied this request.',
        hint: 'Attach credentials this deployment accepts, or adjust the server.authorize hook.',
        details: {
          route,
          path: url.pathname,
        },
      },
    });
    return false;
  }

  const denial = result as { status?: number; body?: unknown };
  sendJson(response, Number(denial.status ?? 403), denial.body ?? {
    error: {
      code: 'SERVER_AUTHORIZATION_DENIED',
      message: 'The server.authorize hook denied this request.',
      details: {
        route,
        path: url.pathname,
      },
    },
  });
  return false;
}

const HEALTH_PROBE_CACHE_MS = 5_000;
const serverStartedAt = Date.now();
let healthProbeCache: { at: number; writable: boolean | null } | null = null;

async function handleHealthRequest(db: ServerDb, response: ServerResponse): Promise<void> {
  const stateDir = typeof db.config.stateDir === 'string' ? db.config.stateDir : null;
  const writable = await stateDirWritable(stateDir);
  const status = writable === false ? 'degraded' : 'ok';

  sendJson(response, status === 'ok' ? 200 : 503, {
    status,
    time: new Date().toISOString(),
    uptimeMs: Date.now() - serverStartedAt,
    schemaVersion: db.schemaVersion ?? null,
    resources: db.resources.size,
    diagnostics: (db.diagnostics ?? []).length,
    state: {
      dir: stateDir,
      writable,
    },
  });
}

/**
 * Writability probe for the state directory, cached briefly so frequent load
 * balancer checks do not turn into a write-per-probe.
 */
async function stateDirWritable(stateDir: string | null): Promise<boolean | null> {
  if (!stateDir) {
    return null;
  }
  if (healthProbeCache && Date.now() - healthProbeCache.at < HEALTH_PROBE_CACHE_MS) {
    return healthProbeCache.writable;
  }

  let writable: boolean;
  const probePath = path.join(stateDir, `.health-probe-${process.pid}`);
  try {
    await mkdir(stateDir, { recursive: true });
    await writeFile(probePath, String(Date.now()), 'utf8');
    await rm(probePath, { force: true });
    writable = true;
  } catch {
    writable = false;
  }

  healthProbeCache = { at: Date.now(), writable };
  return writable;
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

function resolveRequestRoutes(config: ServerConfig, options: RequestRoutesOptions = {}): RequestRoutes {
  const apiBase = normalizeBasePath(options.apiBase ?? config.server?.apiBase ?? '/__db');
  const restBasePath = options.restBasePath === undefined
    ? `${apiBase}/rest`
    : normalizeOptionalBasePath(options.restBasePath);
  const dataPath = options.dataPath === undefined
    ? normalizeOptionalBasePath(config.server?.dataPath ?? '/db')
    : normalizeOptionalBasePath(options.dataPath);
  const graphqlPath = normalizeBasePath(options.graphqlPath ?? config.graphql?.path ?? '/graphql');
  const falcorPath = normalizeBasePath(options.falcorPath ?? config.falcor?.path ?? '/model.json');
  const scopedGraphqlPath = `${apiBase}/graphql`;
  const scopedFalcorPath = `${apiBase}/model.json`;

  return {
    apiBase,
    rootRoutes: options.rootRoutes !== false,
    restBasePath,
    dataPath,
    graphqlPath,
    graphqlAliases: uniqueStrings([graphqlPath, scopedGraphqlPath].map(normalizeBasePath)),
    falcorPath,
    falcorAliases: uniqueStrings([falcorPath, scopedFalcorPath].map(normalizeBasePath)),
    viewerPath: apiBase,
    manifestPath: `${apiBase}/manifest`,
    manifestJsonPath: `${apiBase}/manifest.json`,
    manifestHtmlPath: `${apiBase}/manifest.html`,
    manifestMarkdownPath: `${apiBase}/manifest.md`,
    schemaPath: `${apiBase}/schema`,
    batchPath: `${apiBase}/batch`,
    batchAliases: uniqueStrings([`${apiBase}/batch`, '/batch'].map(normalizeBasePath)),
    resourceBasePath: normalizeBasePath(options.resourceBasePath ?? '/resources'),
    importPath: `${apiBase}/import`,
    eventsPath: `${apiBase}/events`,
    logPath: `${apiBase}/log`,
    healthPath: `${apiBase}/health`,
  };
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
  if (url.pathname === routes.healthPath) {
    return 'health';
  }

  if (routes.graphqlAliases.includes(url.pathname)) {
    return 'graphql';
  }

  if (routes.falcorAliases.includes(url.pathname)) {
    return 'falcor';
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
  if (routes.batchAliases.includes(url.pathname) && (url.pathname !== '/batch' || routes.rootRoutes)) {
    return true;
  }

  if (routes.restBasePath && pathStartsWith(url.pathname, routes.restBasePath)) {
    return true;
  }

  if (routes.rootRoutes && pathStartsWith(url.pathname, routes.resourceBasePath)) {
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
    return !isProductionEnv();
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
    health: {
      code: 'HEALTH',
      display: 'Health',
    },
    manifest: {
      code: 'MANIFEST',
      display: 'Manifest',
    },
    rest: {
      code: 'REST',
      display: 'REST',
    },
    falcor: {
      code: 'FALCOR',
      display: 'Falcor',
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
  if (routes.graphqlAliases.includes(url.pathname)) {
    return { route: 'graphql', operation: 'execute' };
  }
  if (routes.falcorAliases.includes(url.pathname)) {
    return { route: 'falcor', operation: 'execute' };
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

  if (routes.rootRoutes && routes.batchAliases.includes(url.pathname)) {
    return url;
  }

  if (routes.rootRoutes && pathStartsWith(url.pathname, routes.resourceBasePath)) {
    return stripPathBase(url, routes.resourceBasePath);
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function viewerEventChunk(payload: unknown): string {
  return `event: db\ndata: ${JSON.stringify(payload)}\n\n`;
}

function writeViewerEvent(response: ServerResponse, payload: unknown): void {
  response.write(viewerEventChunk(payload));
}
