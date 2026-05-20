import { openDb } from '../db.js';
import { serializeError } from '../errors.js';
import { executeGraphql } from '../graphql/index.js';
import { resolveResource } from '../names.js';
import { shapeCollectionRead } from '../rest/shape.js';
import { makeGeneratedSchema } from '../schema.js';
import { openSqliteDb } from '../sqlite.js';

export async function createDbHonoApp(options = {}) {
  const { Hono } = await importHono();
  const app = new Hono();
  const db = await openHonoDb(options);
  const api = normalizeApi(options.api ?? ['rest']);

  app.use('*', dbContext(db));
  app.onError((error, c) => c.json(serializeError(error, 'HONO_DB_ERROR'), error.status ?? 500));

  if (api.includes('rest')) {
    registerDbRoutes(app, db, options.restRoutes ?? options.rest ?? {});
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
  for (const resource of restResources(db, options)) {
    if (resource.kind === 'collection') {
      const collectionPath = joinPaths(options.prefix, resource.routePath);
      app.get(collectionPath, async (c) => {
        const shortCircuit = await runHonoHooks(options, db, resource, 'list', c);
        if (shortCircuit !== undefined) {
          return shortCircuit;
        }
        const url = new URL(c.req.url ?? collectionPath, 'http://db.local');
        return c.json(await shapeCollectionRead(db, resource, await db.collection(resource.name).all(), url, { allowPagination: true }));
      });
      app.get(`${collectionPath}/:id`, async (c) => {
        const id = c.req.param('id');
        const shortCircuit = await runHonoHooks(options, db, resource, 'get', c, { id });
        if (shortCircuit !== undefined) {
          return shortCircuit;
        }
        const record = await db.collection(resource.name).get(id);
        const url = new URL(c.req.url ?? `${collectionPath}/${id}`, 'http://db.local');
        const body = record
          ? await shapeCollectionRead(db, resource, [record], url, { allowPagination: false })
          : null;
        return record ? c.json(body[0]) : c.json({ error: 'Not found' }, 404);
      });
      app.post(collectionPath, async (c) => {
        const body = await c.req.json();
        const shortCircuit = await runHonoHooks(options, db, resource, 'create', c, { body });
        if (shortCircuit !== undefined) {
          return shortCircuit;
        }
        return c.json(await db.collection(resource.name).create(body), 201);
      });
      app.patch(`${collectionPath}/:id`, async (c) => {
        const body = await c.req.json();
        const id = c.req.param('id');
        const shortCircuit = await runHonoHooks(options, db, resource, 'patch', c, { id, body });
        if (shortCircuit !== undefined) {
          return shortCircuit;
        }
        const record = await db.collection(resource.name).patch(id, body);
        return record ? c.json(record) : c.json({ error: 'Not found' }, 404);
      });
      app.delete(`${collectionPath}/:id`, async (c) => {
        const id = c.req.param('id');
        const shortCircuit = await runHonoHooks(options, db, resource, 'delete', c, { id });
        if (shortCircuit !== undefined) {
          return shortCircuit;
        }
        const deleted = await db.collection(resource.name).delete(id);
        return deleted ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
      });
    } else {
      const documentPath = joinPaths(options.prefix, resource.routePath);
      app.get(documentPath, async (c) => {
        const shortCircuit = await runHonoHooks(options, db, resource, 'get', c);
        if (shortCircuit !== undefined) {
          return shortCircuit;
        }
        return c.json(await db.document(resource.name).all());
      });
      app.put(documentPath, async (c) => {
        const body = await c.req.json();
        const shortCircuit = await runHonoHooks(options, db, resource, 'put', c, { body });
        if (shortCircuit !== undefined) {
          return shortCircuit;
        }
        return c.json(await db.document(resource.name).put(body));
      });
      app.patch(documentPath, async (c) => {
        const body = await c.req.json();
        const shortCircuit = await runHonoHooks(options, db, resource, 'patch', c, { body });
        if (shortCircuit !== undefined) {
          return shortCircuit;
        }
        return c.json(await db.document(resource.name).update(body));
      });
    }
  }
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

async function runHonoHooks(options, db, resource, method, c, extras = {}) {
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

  for (const hook of [beforeRequest, beforeWrite, globalHook, resourceHook]) {
    if (typeof hook !== 'function') {
      continue;
    }
    const result = await hook(context);
    if (result !== undefined) {
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
