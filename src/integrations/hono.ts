import { openDb } from '../db.js';
import { dbError, serializeError } from '../errors.js';
import { executeGraphql } from '../graphql/index.js';
import { resolveResource } from '../names.js';
import { createDbOperationHandler } from '../operations.js';
import { shapeCollectionRead } from '../rest/shape.js';
import { makeGeneratedSchema } from '../schema.js';
import { openSqliteDb } from '../sqlite.js';
import { createRequestTrace, tracePhase } from '../tracing.js';

type HonoResourceKind = 'collection' | 'document' | string;
type HonoRouteMethod = 'list' | 'get' | 'create' | 'patch' | 'delete' | 'put' | 'operation' | string;
type HonoHookName = 'beforeList' | 'beforeGet' | 'beforeCreate' | 'beforePatch' | 'beforeDelete' | 'beforePut';

type HonoRequestLike = {
  url?: string;
  param(name: string): string;
  json(): Promise<unknown>;
  text?(): Promise<string>;
  raw?: {
    text?(): Promise<string>;
  };
  header?(name: string): string | undefined;
};

type HonoContextLike = {
  req: HonoRequestLike;
  set?(key: string, value: unknown): unknown;
  get?(key: string): unknown;
  json(body: unknown, status?: number): unknown;
  text(body: string, status?: number): unknown;
  body(body: unknown, status?: number, headers?: Record<string, unknown>): unknown;
  header(name: string, value: string): unknown;
  [key: string]: unknown;
};

type HonoNext = () => void | Promise<void>;
type HonoHandler = (context: HonoContextLike) => unknown | Promise<unknown>;
type HonoMiddleware = (context: HonoContextLike, next: HonoNext) => unknown | Promise<unknown>;

type HonoAppLike = {
  use(path: string, middleware: HonoMiddleware): unknown;
  onError(handler: (error: StatusError, context: HonoContextLike) => unknown): unknown;
  get(path: string, handler: HonoHandler): unknown;
  post(path: string, handler: HonoHandler): unknown;
  patch(path: string, handler: HonoHandler): unknown;
  delete(path: string, handler: HonoHandler): unknown;
  put(path: string, handler: HonoHandler): unknown;
};

type HonoRoutesAppLike = Pick<HonoAppLike, 'get' | 'post' | 'patch' | 'delete' | 'put'>;

type HonoModule = {
  Hono: new () => HonoAppLike;
};

type DbConfig = {
  server?: {
    maxBodyBytes?: number;
    trace?: boolean | {
      enabled?: boolean;
      slowMs?: number;
      console?: boolean;
      events?: boolean;
      header?: string;
    } | null;
    [key: string]: unknown;
  };
  operations?: {
    enabled?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type HonoCollection = {
  all(): Promise<Record<string, unknown>[]>;
  get(id: string): Promise<Record<string, unknown> | null>;
  create(body: unknown): Promise<Record<string, unknown>>;
  patch(id: string, body: unknown): Promise<Record<string, unknown> | null>;
  delete(id: string): Promise<unknown>;
};

type HonoDocument = {
  all(): Promise<Record<string, unknown>>;
  put(body: unknown): Promise<Record<string, unknown>>;
  update(body: unknown): Promise<Record<string, unknown>>;
};

type HonoResource = {
  name: string;
  kind: HonoResourceKind;
  routePath?: string;
  [key: string]: unknown;
};

type HonoDb = {
  config: DbConfig;
  resources: Map<string, HonoResource>;
  collection(name: string): HonoCollection;
  document(name: string): HonoDocument;
  events?: {
    emit?(event: unknown): unknown;
  };
  [key: string]: unknown;
};

type HonoHookContext = Record<string, unknown> & {
  c: HonoContextLike;
  db: HonoDb;
  resource: HonoResource | null;
  resourceName: string | null;
  method: HonoRouteMethod;
  id?: string;
  body?: Record<string, unknown>;
  ref?: string;
};

type HonoHook = (context: HonoHookContext) => unknown | Promise<unknown>;

type HonoResourceRouteOptions = {
  methods?: unknown[];
  hooks?: Partial<Record<HonoHookName, HonoHook>>;
  [key: string]: unknown;
} | false;

type HonoRouteOptions = Record<string, unknown> & {
  prefix?: string;
  resources?: unknown[];
  exclude?: unknown[];
  methods?: unknown[];
  trace?: unknown;
  hooks?: Partial<Record<HonoHookName, HonoHook>>;
  lifecycleHooks?: {
    beforeRequest?: HonoHook;
    beforeWrite?: HonoHook;
    [key: string]: unknown;
  };
  resourceOptions?: Record<string, HonoResourceRouteOptions>;
  resourcesOptions?: Record<string, HonoResourceRouteOptions>;
  operations?: boolean | 'auto' | Record<string, unknown>;
};

type HonoAppOptions = HonoRouteOptions & {
  api?: string | string[];
  restRoutes?: HonoRouteOptions;
  rest?: HonoRouteOptions;
  graphqlPath?: string;
  graphql?: {
    path?: string;
    [key: string]: unknown;
  };
  storage?: {
    kind?: string;
    [key: string]: unknown;
  };
};

type HonoOperationResult = {
  status: number;
  headers?: Record<string, unknown>;
  body?: unknown;
  rawBody?: string;
};

type StatusError = Error & {
  status?: number;
};

type RequestTraceLike = NonNullable<ReturnType<typeof createRequestTrace>>;

export async function createDbHonoApp(options: HonoAppOptions = {}): Promise<HonoAppLike> {
  const { Hono } = await importHono();
  const app = new Hono();
  const db = await openHonoDb(options);
  const api = normalizeApi(options.api ?? ['rest']);

  app.use('*', dbContext(db));
  app.onError((error, c) => c.json(serializeError(error, 'HONO_DB_ERROR'), error.status ?? 500));

  if (api.includes('rest')) {
    const restOptions = options.restRoutes ?? options.rest ?? {};
    registerDbRoutes(app, db, {
      ...restOptions,
      trace: restOptions.trace ?? options.trace,
    });
  }

  if (api.includes('graphql')) {
    const graphqlPath = options.graphqlPath ?? options.graphql?.path ?? '/graphql';
    app.get(graphqlPath, (c) => c.text((makeGeneratedSchema([...db.resources.values()] as never) as unknown as { graphql: string }).graphql));
    app.post(graphqlPath, async (c) => c.json(await executeGraphql(db as never, await c.req.json())));
  }

  return app;
}

export function dbContext(dbOrOptions: HonoDb | HonoAppOptions = {}): HonoMiddleware {
  const db = typeof dbOrOptions?.collection === 'function'
    ? dbOrOptions as HonoDb
    : null;
  let dbPromise = db ? Promise.resolve(db) : null;

  return async (c, next) => {
    dbPromise ??= openHonoDb(dbOrOptions as HonoAppOptions);
    c.set('db', await dbPromise);
    await next();
  };
}

export async function createDbContext(options: HonoAppOptions = {}): Promise<HonoMiddleware> {
  return dbContext(await openHonoDb(options));
}

async function openHonoDb(options: HonoAppOptions): Promise<HonoDb> {
  if (options.storage?.kind === 'sqlite') {
    return await openSqliteDb(options) as unknown as HonoDb;
  }

  return await openDb(options) as unknown as HonoDb;
}

export function registerDbRoutes(app: HonoRoutesAppLike, db: HonoDb, options: HonoRouteOptions = {}): void {
  registerOperationRoutes(app, db, options);

  for (const resource of restResources(db, options)) {
    if (resource.kind === 'collection') {
      const collectionPath = joinPaths(options.prefix, resource.routePath);
      app.get(collectionPath, async (c) => {
        return withHonoTrace(options, db, resource, 'list', c, 'GET', async (trace) => {
          const shortCircuit = await runHonoHooks(options, db, resource, 'list', c, {}, trace);
          if (shortCircuit !== undefined) {
            return shortCircuit;
          }
          const url = new URL(c.req.url ?? collectionPath, 'http://db.local');
          const records = await tracePhase(trace, 'collection-read', () => db.collection(resource.name).all(), {
            resource: resource.name,
            operation: 'all',
          });
          const shaped = await tracePhase(trace, 'response-shaping', () => shapeCollectionRead(db as never, resource as never, records, url, { allowPagination: true }), {
            resource: resource.name,
          });
          return tracePhase(trace, 'response-formatting', () => c.json(shaped), {
            resource: resource.name,
            target: 'resource',
          });
        });
      });
      app.get(`${collectionPath}/:id`, async (c) => {
        const id = c.req.param('id');
        return withHonoTrace(options, db, resource, 'get', c, 'GET', async (trace) => {
          const shortCircuit = await runHonoHooks(options, db, resource, 'get', c, { id }, trace);
          if (shortCircuit !== undefined) {
            return shortCircuit;
          }
          const record = await tracePhase(trace, 'collection-read', () => db.collection(resource.name).get(id), {
            resource: resource.name,
            operation: 'get',
          });
          const url = new URL(c.req.url ?? `${collectionPath}/${id}`, 'http://db.local');
          const body = record
            ? await tracePhase(trace, 'response-shaping', () => shapeCollectionRead(db as never, resource as never, [record], url, { allowPagination: false }), {
              resource: resource.name,
            })
            : null;
          return tracePhase(trace, 'response-formatting', () => (record ? c.json(body[0]) : c.json({ error: 'Not found' }, 404)), {
            resource: resource.name,
            target: 'resource',
          });
        }, { id });
      });
      app.post(collectionPath, async (c) => {
        return withHonoTrace(options, db, resource, 'create', c, 'POST', async (trace) => {
          const body = await tracePhase(trace, 'request-body', () => c.req.json());
          const shortCircuit = await runHonoHooks(options, db, resource, 'create', c, { body }, trace);
          if (shortCircuit !== undefined) {
            return shortCircuit;
          }
          const record = await tracePhase(trace, 'collection-write', () => db.collection(resource.name).create(body), {
            resource: resource.name,
            operation: 'create',
          });
          return tracePhase(trace, 'response-formatting', () => c.json(record, 201), {
            resource: resource.name,
            target: 'resource',
          });
        });
      });
      app.patch(`${collectionPath}/:id`, async (c) => {
        const id = c.req.param('id');
        return withHonoTrace(options, db, resource, 'patch', c, 'PATCH', async (trace) => {
          const body = await tracePhase(trace, 'request-body', () => c.req.json());
          const shortCircuit = await runHonoHooks(options, db, resource, 'patch', c, { id, body }, trace);
          if (shortCircuit !== undefined) {
            return shortCircuit;
          }
          const record = await tracePhase(trace, 'collection-write', () => db.collection(resource.name).patch(id, body), {
            resource: resource.name,
            operation: 'patch',
          });
          return tracePhase(trace, 'response-formatting', () => (record ? c.json(record) : c.json({ error: 'Not found' }, 404)), {
            resource: resource.name,
            target: 'resource',
          });
        }, { id });
      });
      app.delete(`${collectionPath}/:id`, async (c) => {
        const id = c.req.param('id');
        return withHonoTrace(options, db, resource, 'delete', c, 'DELETE', async (trace) => {
          const shortCircuit = await runHonoHooks(options, db, resource, 'delete', c, { id }, trace);
          if (shortCircuit !== undefined) {
            return shortCircuit;
          }
          const deleted = await tracePhase(trace, 'collection-write', () => db.collection(resource.name).delete(id), {
            resource: resource.name,
            operation: 'delete',
          });
          return tracePhase(trace, 'response-formatting', () => (deleted ? c.body(null, 204) : c.json({ error: 'Not found' }, 404)), {
            resource: resource.name,
            target: 'resource',
          });
        }, { id });
      });
    } else {
      const documentPath = joinPaths(options.prefix, resource.routePath);
      app.get(documentPath, async (c) => {
        return withHonoTrace(options, db, resource, 'get', c, 'GET', async (trace) => {
          const shortCircuit = await runHonoHooks(options, db, resource, 'get', c, {}, trace);
          if (shortCircuit !== undefined) {
            return shortCircuit;
          }
          const document = await tracePhase(trace, 'document-read', () => db.document(resource.name).all(), {
            resource: resource.name,
            operation: 'all',
          });
          return tracePhase(trace, 'response-formatting', () => c.json(document), {
            resource: resource.name,
            target: 'resource',
          });
        });
      });
      app.put(documentPath, async (c) => {
        return withHonoTrace(options, db, resource, 'put', c, 'PUT', async (trace) => {
          const body = await tracePhase(trace, 'request-body', () => c.req.json());
          const shortCircuit = await runHonoHooks(options, db, resource, 'put', c, { body }, trace);
          if (shortCircuit !== undefined) {
            return shortCircuit;
          }
          const document = await tracePhase(trace, 'document-write', () => db.document(resource.name).put(body), {
            resource: resource.name,
            operation: 'put',
          });
          return tracePhase(trace, 'response-formatting', () => c.json(document), {
            resource: resource.name,
            target: 'resource',
          });
        });
      });
      app.patch(documentPath, async (c) => {
        return withHonoTrace(options, db, resource, 'patch', c, 'PATCH', async (trace) => {
          const body = await tracePhase(trace, 'request-body', () => c.req.json());
          const shortCircuit = await runHonoHooks(options, db, resource, 'patch', c, { body }, trace);
          if (shortCircuit !== undefined) {
            return shortCircuit;
          }
          const document = await tracePhase(trace, 'document-write', () => db.document(resource.name).update(body), {
            resource: resource.name,
            operation: 'patch',
          });
          return tracePhase(trace, 'response-formatting', () => c.json(document), {
            resource: resource.name,
            target: 'resource',
          });
        });
      });
    }
  }
}

function registerOperationRoutes(app: HonoRoutesAppLike, db: HonoDb, options: HonoRouteOptions): void {
  const operationOptions = honoOperationOptions(db, options);
  if (!operationOptions) {
    return;
  }

  const operationHandler = createDbOperationHandler(db, operationOptions as never);
  const operationPath = joinPaths(options.prefix, '/operations/:ref');
  app.post(operationPath, async (c) => {
    const ref = c.req.param('ref');
    const trace = createRequestTrace(db, {
      method: 'POST',
      url: c.req?.url ?? operationPath,
    }, {
      trace: options.trace,
    });
    trace?.markHandled(undefined as never);
    trace?.attachHonoHeader(c);
    trace?.setRoute({
      route: 'hono-operation',
      operation: 'execute',
      id: ref,
    });

    try {
      const shortCircuit = await runHonoOperationHooks(options, db, ref, c, {}, trace);
      if (shortCircuit !== undefined) {
        trace?.finish(db, shortCircuit);
        return shortCircuit;
      }

      const body = await tracePhase(trace, 'registered-operation-body', () => readHonoJsonBody(c, db));
      const result = await tracePhase(trace, 'registered-operation-execution', () => operationHandler.executeRequest(ref, body, {
        trace,
      }), {
        ref,
      });
      const response = sendHonoOperationResult(c, result);
      trace?.finish(db, response);
      return response;
    } catch (error) {
      const statusError = error as StatusError;
      trace?.setError(statusError);
      const response = c.json(serializeError(statusError, 'HONO_DB_OPERATION_ERROR'), statusError.status ?? 500);
      trace?.finish(db, response);
      return response;
    }
  });
}

function honoOperationOptions(db: HonoDb, options: HonoRouteOptions): boolean | Record<string, unknown> | null {
  if (options.operations === false) {
    return null;
  }

  if (options.operations === undefined || options.operations === 'auto') {
    return db.config.operations?.enabled === true ? true : null;
  }

  return options.operations;
}

function sendHonoOperationResult(c: HonoContextLike, result: HonoOperationResult): unknown {
  const headers = result.headers ?? {};
  for (const [name, value] of Object.entries(headers)) {
    c.header(name, String(value));
  }

  const contentType = String(headers['content-type'] ?? '');
  if (result.status === 204) {
    return c.body(null, 204);
  }
  if (contentType.includes('application/json')) {
    return c.json(result.body, result.status);
  }
  return c.body(result.rawBody ?? String(result.body ?? ''), result.status);
}

async function runHonoOperationHooks(
  options: HonoRouteOptions,
  db: HonoDb,
  ref: string,
  c: HonoContextLike,
  extras: Record<string, unknown> = {},
  trace: RequestTraceLike | null = null,
): Promise<unknown> {
  const beforeRequest = options.lifecycleHooks?.beforeRequest;
  if (typeof beforeRequest !== 'function') {
    return undefined;
  }

  const context = {
    c,
    db,
    resource: null,
    resourceName: null,
    method: 'operation',
    ref,
    ...extras,
  };
  const result = await tracePhase(trace, 'hono-hook', () => beforeRequest(context), {
    hook: 'beforeRequest',
    operation: 'operation',
    ref,
  });
  if (result !== undefined) {
    trace?.setRoute({
      hook: 'beforeRequest',
      shortCircuit: true,
    });
  }
  return result;
}

async function readHonoJsonBody(c: HonoContextLike, db: HonoDb): Promise<unknown> {
  const text = await readHonoBodyText(c);
  if (text === null) {
    return c.req.json();
  }

  const maxBytes = Number(db.config.server?.maxBodyBytes ?? 1048576);
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > maxBytes) {
    throw dbError(
      'JSON_BODY_TOO_LARGE',
      `Request body is too large. Received more than ${maxBytes} bytes.`,
      {
        status: 413,
        hint: 'Send a smaller JSON payload or increase server.maxBodyBytes in db.config.mjs for local development.',
        details: {
          maxBodyBytes: maxBytes,
        },
      },
    );
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const parseError = error as Error;
    throw dbError(
      'REST_INVALID_JSON_BODY',
      'Request body is not valid JSON.',
      {
        status: 400,
        hint: 'Check for trailing commas, unquoted property names, or an incomplete JSON object.',
        details: {
          parserMessage: parseError.message,
        },
      },
    );
  }
}

async function readHonoBodyText(c: HonoContextLike): Promise<string | null> {
  if (typeof c.req?.text === 'function') {
    return c.req.text();
  }
  if (typeof c.req?.raw?.text === 'function') {
    return c.req.raw.text();
  }
  return null;
}

function restResources(db: HonoDb, options: HonoRouteOptions): HonoResource[] {
  const allow = normalizeResourceSet(db, options.resources);
  const deny = normalizeResourceSet(db, options.exclude);
  const methods = new Set((options.methods ?? []).map((method) => String(method).toLowerCase()));

  return [...db.resources.values()].filter((resource) => {
    if (allow && !allow.has(resource.name)) {
      return false;
    }
    if (deny?.has(resource.name)) {
      return false;
    }
    const resourceOptions = resourceRestOptions(options, resource);
    if (resourceOptions === false) {
      return false;
    }
    if (methods.size > 0 && !resourceMethods(resource).some((method) => methods.has(method))) {
      return false;
    }
    return true;
  });
}

async function withHonoTrace(
  options: HonoRouteOptions,
  db: HonoDb,
  resource: HonoResource,
  operation: HonoRouteMethod,
  c: HonoContextLike,
  httpMethod: string,
  handler: (trace: RequestTraceLike | null) => unknown | Promise<unknown>,
  details: Record<string, unknown> = {},
): Promise<unknown> {
  const trace = createRequestTrace(db, {
    method: httpMethod,
    url: c.req?.url ?? resource.routePath ?? '/',
  }, {
    trace: options.trace,
  });
  trace?.markHandled(undefined as never);
  trace?.attachHonoHeader(c);
  trace?.setRoute({
    route: 'hono-rest',
    resource: resource.name,
    operation,
    ...details,
  });

  try {
    const response = await handler(trace);
    trace?.finish(db, response);
    return response;
  } catch (error) {
    trace?.setError(error as StatusError);
    trace?.finish(db, undefined as never);
    throw error;
  }
}

async function runHonoHooks(
  options: HonoRouteOptions,
  db: HonoDb,
  resource: HonoResource,
  method: HonoRouteMethod,
  c: HonoContextLike,
  extras: Record<string, unknown> = {},
  trace: RequestTraceLike | null = null,
): Promise<unknown> {
  if (!methodAllowed(options, resource, method)) {
    return c.json({ error: 'Method not allowed' }, 405);
  }

  const hookName = hookNameForMethod(method);
  const context = {
    c,
    db,
    resource,
    resourceName: resource.name,
    method,
    ...extras,
  };
  const beforeRequest = options.lifecycleHooks?.beforeRequest;
  const beforeWrite = isWriteMethod(method) ? options.lifecycleHooks?.beforeWrite : null;
  const globalHook = options.hooks?.[hookName];
  const resourceOptions = resourceRestOptions(options, resource);
  const resourceHook = resourceOptions ? resourceOptions.hooks?.[hookName] : undefined;
  const hooks = [
    ['beforeRequest', beforeRequest],
    ['beforeWrite', beforeWrite],
    [hookName, globalHook],
    [`resource:${hookName}`, resourceHook],
  ];

  for (const [name, hook] of hooks) {
    if (typeof hook !== 'function') {
      continue;
    }
    const result = await tracePhase(trace, 'hono-hook', () => hook(context), {
      hook: name,
      resource: resource.name,
      operation: method,
    });
    if (result !== undefined) {
      trace?.setRoute({
        hook: name,
        shortCircuit: true,
      });
      return result;
    }
  }

  return undefined;
}

function isWriteMethod(method: HonoRouteMethod): boolean {
  return method === 'create'
    || method === 'patch'
    || method === 'put'
    || method === 'delete';
}

function methodAllowed(options: HonoRouteOptions, resource: HonoResource, method: HonoRouteMethod): boolean {
  const globalMethods = normalizeMethodSet(options.methods);
  const resourceOptions = resourceRestOptions(options, resource);
  const resourceMethods = normalizeMethodSet(resourceOptions ? resourceOptions.methods : null);

  return (!globalMethods || globalMethods.has(method))
    && (!resourceMethods || resourceMethods.has(method));
}

function hookNameForMethod(method: HonoRouteMethod): HonoHookName | null {
  switch (method) {
    case 'list':
      return 'beforeList';
    case 'get':
      return 'beforeGet';
    case 'create':
      return 'beforeCreate';
    case 'patch':
      return 'beforePatch';
    case 'delete':
      return 'beforeDelete';
    case 'put':
      return 'beforePut';
    default:
      return null;
  }
}

function normalizeResourceSet(db: HonoDb, values: unknown): Set<string> | null {
  if (!Array.isArray(values)) {
    return null;
  }

  return new Set(values.map((value) => resolveResource(db.resources, value).resource?.name ?? String(value)));
}

function normalizeMethodSet(values: unknown): Set<string> | null {
  if (!Array.isArray(values)) {
    return null;
  }

  return new Set(values.map((value) => String(value).toLowerCase()));
}

function resourceRestOptions(options: HonoRouteOptions, resource: HonoResource): HonoResourceRouteOptions | undefined {
  const configured = options.resourceOptions ?? options.resourcesOptions ?? {};
  return configured[resource.name] ?? configured[resource.routePath?.slice(1)] ?? configured[resource.name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)];
}

function resourceMethods(resource: HonoResource): HonoRouteMethod[] {
  return resource.kind === 'collection'
    ? ['list', 'get', 'create', 'patch', 'delete']
    : ['get', 'put', 'patch'];
}

function joinPaths(prefix: unknown = '', routePath: unknown = ''): string {
  const left = `/${String(prefix ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  const right = `/${String(routePath ?? '').replace(/^\/+/, '')}`;
  if (left === '/') {
    return right;
  }
  return `${left}${right === '/' ? '' : right}`;
}

function normalizeApi(value: unknown): string[] {
  return Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

async function importHono(): Promise<HonoModule> {
  try {
    const moduleName = 'hono';
    return await import(moduleName) as HonoModule;
  } catch (error) {
    throw new Error(`db/hono requires hono to be installed in your app: ${(error as Error).message}`);
  }
}
