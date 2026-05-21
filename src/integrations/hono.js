import { openDb } from '../db.js';
import { dbError, serializeError } from '../errors.js';
import { executeGraphql } from '../graphql/index.js';
import { resolveResource } from '../names.js';
import { createDbOperationHandler } from '../operations.js';
import { shapeCollectionRead } from '../rest/shape.js';
import { makeGeneratedSchema } from '../schema.js';
import { openSqliteDb } from '../sqlite.js';
import { createRequestTrace, tracePhase } from '../tracing.js';

export async function createDbHonoApp(options = {}) {
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
    app.get(graphqlPath, (c) => c.text(makeGeneratedSchema([...db.resources.values()]).graphql));
    app.post(graphqlPath, async (c) => c.json(await executeGraphql(db, await c.req.json())));
  }

  return app;
}

export function dbContext(dbOrOptions) {
  const db = typeof dbOrOptions?.collection === 'function'
    ? dbOrOptions
    : null;
  let dbPromise = db ? Promise.resolve(db) : null;

  return async (c, next) => {
    dbPromise ??= openHonoDb(dbOrOptions ?? {});
    c.set('db', await dbPromise);
    await next();
  };
}

export async function createDbContext(options = {}) {
  return dbContext(await openHonoDb(options));
}

async function openHonoDb(options) {
  if (options.storage?.kind === 'sqlite') {
    return openSqliteDb(options);
  }

  return openDb(options);
}

export function registerDbRoutes(app, db, options = {}) {
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
          const shaped = await tracePhase(trace, 'response-shaping', () => shapeCollectionRead(db, resource, records, url, { allowPagination: true }), {
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
            ? await tracePhase(trace, 'response-shaping', () => shapeCollectionRead(db, resource, [record], url, { allowPagination: false }), {
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

function registerOperationRoutes(app, db, options) {
  const operationOptions = honoOperationOptions(db, options);
  if (!operationOptions) {
    return;
  }

  const operationHandler = createDbOperationHandler(db, operationOptions);
  const operationPath = joinPaths(options.prefix, '/operations/:ref');
  app.post(operationPath, async (c) => {
    const ref = c.req.param('ref');
    const trace = createRequestTrace(db, {
      method: 'POST',
      url: c.req?.url ?? operationPath,
    }, {
      trace: options.trace,
    });
    trace?.markHandled();
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
      trace?.setError(error);
      const response = c.json(serializeError(error, 'HONO_DB_OPERATION_ERROR'), error.status ?? 500);
      trace?.finish(db, response);
      return response;
    }
  });
}

function honoOperationOptions(db, options) {
  if (options.operations === false) {
    return null;
  }

  if (options.operations === undefined || options.operations === 'auto') {
    return db.config.operations?.enabled === true ? true : null;
  }

  return options.operations;
}

function sendHonoOperationResult(c, result) {
  const headers = result.headers ?? {};
  for (const [name, value] of Object.entries(headers)) {
    c.header(name, value);
  }

  const contentType = headers['content-type'] ?? '';
  if (result.status === 204) {
    return c.body(null, 204);
  }
  if (contentType.includes('application/json')) {
    return c.json(result.body, result.status);
  }
  return c.body(result.rawBody ?? String(result.body ?? ''), result.status);
}

async function runHonoOperationHooks(options, db, ref, c, extras = {}, trace = null) {
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

async function readHonoJsonBody(c, db) {
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
    throw dbError(
      'REST_INVALID_JSON_BODY',
      'Request body is not valid JSON.',
      {
        status: 400,
        hint: 'Check for trailing commas, unquoted property names, or an incomplete JSON object.',
        details: {
          parserMessage: error.message,
        },
      },
    );
  }
}

async function readHonoBodyText(c) {
  if (typeof c.req?.text === 'function') {
    return c.req.text();
  }
  if (typeof c.req?.raw?.text === 'function') {
    return c.req.raw.text();
  }
  return null;
}

function restResources(db, options) {
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

async function withHonoTrace(options, db, resource, operation, c, httpMethod, handler, details = {}) {
  const trace = createRequestTrace(db, {
    method: httpMethod,
    url: c.req?.url ?? resource.routePath ?? '/',
  }, {
    trace: options.trace,
  });
  trace?.markHandled();
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
    trace?.setError(error);
    trace?.finish(db);
    throw error;
  }
}

async function runHonoHooks(options, db, resource, method, c, extras = {}, trace = null) {
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
  const resourceHook = resourceRestOptions(options, resource)?.hooks?.[hookName];
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

function isWriteMethod(method) {
  return method === 'create'
    || method === 'patch'
    || method === 'put'
    || method === 'delete';
}

function methodAllowed(options, resource, method) {
  const globalMethods = normalizeMethodSet(options.methods);
  const resourceMethods = normalizeMethodSet(resourceRestOptions(options, resource)?.methods);

  return (!globalMethods || globalMethods.has(method))
    && (!resourceMethods || resourceMethods.has(method));
}

function hookNameForMethod(method) {
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

function normalizeResourceSet(db, values) {
  if (!Array.isArray(values)) {
    return null;
  }

  return new Set(values.map((value) => resolveResource(db.resources, value).resource?.name ?? String(value)));
}

function normalizeMethodSet(values) {
  if (!Array.isArray(values)) {
    return null;
  }

  return new Set(values.map((value) => String(value).toLowerCase()));
}

function resourceRestOptions(options, resource) {
  const configured = options.resourceOptions ?? options.resourcesOptions ?? {};
  return configured[resource.name] ?? configured[resource.routePath?.slice(1)] ?? configured[resource.name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)];
}

function resourceMethods(resource) {
  return resource.kind === 'collection'
    ? ['list', 'get', 'create', 'patch', 'delete']
    : ['get', 'put', 'patch'];
}

function joinPaths(prefix = '', routePath = '') {
  const left = `/${String(prefix ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  const right = `/${String(routePath ?? '').replace(/^\/+/, '')}`;
  if (left === '/') {
    return right;
  }
  return `${left}${right === '/' ? '' : right}`;
}

function normalizeApi(value) {
  return Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

async function importHono() {
  try {
    return await import('hono');
  } catch (error) {
    throw new Error(`db/hono requires hono to be installed in your app: ${error.message}`);
  }
}
