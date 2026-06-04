import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeAppState } from '../framework/state.js';

export async function createLocalWebAppRuntime(options) {
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
  const db = runtime.db;
  let closed = false;

  return {
    db,
    async handleRequest(request, response) {
      try {
        const handled = await handleLocalAppRequest(request, response, {
          cwd,
          db,
          basePath: normalizedBasePath,
          sendJson,
        });
        if (handled) {
          return;
        }

        await runtime.handleRequest(request, response);
      } catch (error) {
        sendJson(response, error.status ?? 500, serializeError(error, 'LOCAL_APP_SERVER_ERROR'));
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

async function handleLocalAppRequest(request, response, context) {
  const host = request.headers.host ?? 'localhost';
  const url = new URL(request.url ?? '/', `http://${host}`);
  const pathname = stripBasePath(url.pathname, context.basePath);
  if (pathname === null) {
    return false;
  }

  if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const version = await appVersion(context.cwd);
    const html = await readFile(path.join(context.cwd, 'src/index.html'), 'utf8');
    sendHtml(response, html
      .replaceAll('__BASE_PATH__', context.basePath)
      .replaceAll('__APP_VERSION__', version));
    return true;
  }

  if (request.method === 'GET' && pathname === '/app.js') {
    sendJavaScript(response, await readFile(path.join(context.cwd, 'src/app.js'), 'utf8'));
    return true;
  }

  if (request.method === 'GET' && pathname === '/framework/state.js') {
    sendJavaScript(response, await readFile(path.join(context.cwd, 'framework/state.js'), 'utf8'));
    return true;
  }

  if (request.method === 'GET' && pathname === '/api/version') {
    context.sendJson(response, 200, { version: await appVersion(context.cwd) });
    return true;
  }

  if (request.method === 'GET' && pathname === '/api/state') {
    context.sendJson(response, 200, { state: normalizeAppState(await context.db.document('appState').get()) });
    return true;
  }

  if (request.method === 'PUT' && pathname === '/api/state') {
    const body = await readJsonRequest(request);
    const state = normalizeAppState(body?.state ?? body);
    const saved = await context.db.document('appState').put(state);
    context.sendJson(response, 200, { state: saved });
    return true;
  }

  return false;
}

async function appVersion(cwd) {
  const files = [
    'src/index.html',
    'src/app.js',
    'framework/state.js',
  ];
  const mtimes = await Promise.all(files.map(async (file) => {
    const fileStat = await stat(path.join(cwd, file));
    return fileStat.mtimeMs;
  }));
  return String(Math.max(...mtimes));
}

async function readJsonRequest(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
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
