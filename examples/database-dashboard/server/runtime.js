import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function createDatabaseDashboardRuntime(options) {
  const { cwd, basePath = '', repoRoot, skipSync = false } = options;
  const {
    createDbRuntime,
    serializeError,
    sendJson,
  } = await loadAsyncDbRuntime(repoRoot);
  const normalizedBasePath = normalizeBasePath(basePath);
  const runtime = await createDbRuntime({
    cwd,
    allowSourceErrors: true,
    syncOnOpen: !skipSync,
    handler: {
      rootRoutes: true,
      apiBase: joinPaths(normalizedBasePath, '/__db'),
      dataPath: joinPaths(normalizedBasePath, '/db'),
      graphqlPath: joinPaths(normalizedBasePath, '/graphql'),
    },
  });
  let closed = false;

  return {
    db: runtime.db,
    async handleRequest(request, response) {
      try {
        const handled = await handleDashboardRequest(request, response, {
          cwd,
          db: runtime.db,
          basePath: normalizedBasePath,
          sendJson,
        });
        if (handled) {
          return;
        }

        await runtime.handleRequest(request, response);
      } catch (error) {
        sendJson(response, error.status ?? 500, serializeError(error, 'DATABASE_DASHBOARD_SERVER_ERROR'));
      }
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await runtime.close();
    },
  };
}

async function loadAsyncDbRuntime(repoRoot) {
  const packageRoot = repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const distRoot = path.join(packageRoot, 'dist');
  const [indexModule, errorsModule, restModule] = await Promise.all([
    import(pathToFileURL(path.join(distRoot, 'index.js')).href),
    import(pathToFileURL(path.join(distRoot, 'errors.js')).href),
    import(pathToFileURL(path.join(distRoot, 'rest/handler.js')).href),
  ]);

  return {
    createDbRuntime: indexModule.createDbRuntime,
    serializeError: errorsModule.serializeError,
    sendJson: restModule.sendJson,
  };
}

async function handleDashboardRequest(request, response, context) {
  const host = request.headers.host ?? 'localhost';
  const url = new URL(request.url ?? '/', `http://${host}`);
  const pathname = stripBasePath(url.pathname, context.basePath);
  if (pathname === null) {
    return false;
  }

  if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const html = await readFile(path.join(context.cwd, 'src/index.html'), 'utf8');
    const version = await appVersion(context.cwd);
    sendHtml(response, html
      .replaceAll('__BASE_PATH__', context.basePath)
      .replaceAll('__APP_VERSION__', version));
    return true;
  }

  if (request.method === 'GET' && pathname === '/app.js') {
    sendJavaScript(response, await readFile(path.join(context.cwd, 'src/app.js'), 'utf8'));
    return true;
  }

  if (request.method === 'GET' && pathname === '/api/dashboard') {
    context.sendJson(response, 200, await dashboardPayload(context.db));
    return true;
  }

  return false;
}

async function dashboardPayload(db) {
  const resources = [...db.resources.values()].map((resource) => ({
    name: resource.name,
    kind: resource.kind,
    description: resource.description ?? '',
    idField: resource.idField ?? 'id',
    fields: resource.fields ?? {},
    relations: resource.relations ?? [],
    routePath: resource.routePath ?? `/${resource.name}`,
  }));
  const records = {};

  for (const resource of resources) {
    if (resource.kind === 'collection') {
      records[resource.name] = await db.collection(resource.name).all();
      continue;
    }
    records[resource.name] = await db.document(resource.name).all();
  }

  return {
    resources,
    records,
    diagnostics: db.diagnostics ?? [],
    generatedAt: new Date().toISOString(),
  };
}

async function appVersion(cwd) {
  const files = [
    'src/index.html',
    'src/app.js',
  ];
  const mtimes = await Promise.all(files.map(async (file) => {
    const fileStat = await stat(path.join(cwd, file));
    return fileStat.mtimeMs;
  }));
  return String(Math.max(...mtimes));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(html);
}

function sendJavaScript(response, source) {
  response.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(source);
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

function stripBasePath(pathname, basePath) {
  const normalizedBasePath = normalizeBasePath(basePath);
  if (!normalizedBasePath) {
    return pathname;
  }

  if (pathname === normalizedBasePath) {
    return '/';
  }

  if (pathname.startsWith(`${normalizedBasePath}/`)) {
    return pathname.slice(normalizedBasePath.length) || '/';
  }

  return null;
}
