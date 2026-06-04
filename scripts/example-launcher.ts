import { access, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serializeError } from '../src/errors.js';
import { createDbRuntime } from '../src/index.js';
import { sendJson } from '../src/rest/handler.js';

/**
 * Create one example runtime. Uses `serve-example.mjs` when the example ships it;
 * otherwise wires the stock db request handler without binding another HTTP server.
 *
 * The examples host owns the single HTTP server. Examples own request handling by
 * exporting `createExampleRuntime(context)` from `serve-example.mjs`.
 *
 * @param {{ cwd: string; basePath?: string; url: string; repoRoot: string }} context
 * @returns {Promise<{
 *   db?: object;
 *   viewerUrl: string;
 *   demoUrl?: string;
 *   demoLinks?: Array<{ label: string; href: string }>;
 *   starterKind: 'db' | 'custom';
 *   handleRequest: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<unknown>;
 *   close: () => Promise<void> | void;
 * }>}
 */
export async function createExampleRuntime(context) {
  const { cwd, repoRoot, url } = context;
  const hookFsPath = path.join(cwd, 'serve-example.mjs');
  await ensureLocalPackageSelfReference(cwd, repoRoot);

  try {
    await access(hookFsPath);
  } catch {
    return createStockExampleRuntime(context);
  }

  const hookUrl = `${pathToFileURL(hookFsPath).href}`;
  const mod = await import(hookUrl);

  if (typeof mod.createExampleRuntime !== 'function') {
    throw new Error(
      `${path.relative(repoRoot, hookFsPath)} must export async function createExampleRuntime.`,
    );
  }

  const runtime = await mod.createExampleRuntime(context);
  if (!runtime || typeof runtime.handleRequest !== 'function') {
    throw new Error(`${path.relative(repoRoot, hookFsPath)} createExampleRuntime must return a handleRequest function.`);
  }

  return {
    starterKind: 'custom',
    ...runtime,
    viewerUrl: runtime.viewerUrl ?? `${url}/__db`,
    demoUrl: runtime.demoUrl,
    demoLinks: Array.isArray(runtime.demoLinks) ? runtime.demoLinks : [],
  };
}

async function createStockExampleRuntime(context) {
  const { cwd, url } = context;
  const basePath = normalizeBasePath(context.basePath);
  const runtime = await createDbRuntime({
    cwd,
    allowSourceErrors: true,
    handler: {
      rootRoutes: true,
      apiBase: joinPaths(basePath, '/__db'),
      dataPath: joinPaths(basePath, '/db'),
      graphqlPath: joinPaths(basePath, '/graphql'),
    },
  });
  let closed = false;

  return {
    starterKind: 'db',
    db: runtime.db,
    viewerUrl: `${url}/__db`,
    demoUrl: undefined,
    demoLinks: [],
    async handleRequest(request, response) {
      try {
        await runtime.handleRequest(request, response);
      } catch (error) {
        sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
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

async function ensureLocalPackageSelfReference(cwd, repoRoot) {
  try {
    await access(path.join(cwd, 'package.json'));
  } catch {
    return;
  }

  const packageScopeDir = path.join(cwd, 'node_modules', '@async');
  const packagePath = path.join(packageScopeDir, 'db');
  try {
    await access(packagePath);
    return;
  } catch {
    await mkdir(packageScopeDir, { recursive: true });
  }

  try {
    await symlink(path.resolve(repoRoot), packagePath, 'dir');
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}
