import {
  renderCollectionListPage,
  renderHomePage,
  renderRecordDetailPage,
} from './cms-ssr.mjs';
import { readManifest, renderSchemaUiHtml } from './render-admin.mjs';

/**
 * Handles Schema UI SSR routes (`/`, `/templates`, `/cms/...`).
 * Returns true when the response was fully handled (including SSR 404s).
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {{ cwd: string; db: object; basePath?: string; manifestUrl: URL }} context
 */
export async function handleSchemaUiSsrRequest(request, response, context) {
  if (request.method !== 'GET') {
    return false;
  }

  const host = request.headers.host ?? 'localhost';
  const url = new URL(request.url ?? '/', `http://${host}`);
  const basePath = normalizeBasePath(context.basePath);
  const route = parsePath(url.pathname, basePath);

  if (!route) {
    return false;
  }

  try {
    const { db, manifestUrl } = context;
    const manifest = await readManifest(manifestUrl);

    if (route.type === 'templates') {
      const html = renderSchemaUiHtml(manifest);
      sendHtml(response, html);
      return true;
    }

    const recordsByCollection = await loadRecordsByCollection(db, manifest);

    if (route.type === 'home') {
      sendHtml(response, renderHomePage(manifest, recordsByCollection, { basePath }));
      return true;
    }

    if (route.type === 'list') {
      const html = renderCollectionListPage(manifest, route.collection, recordsByCollection[route.collection] ?? [], { basePath });
      if (!html) {
        response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><meta charset="utf-8"><title>404</title><p>Unknown collection</p>');
        return true;
      }
      sendHtml(response, html);
      return true;
    }

    const record = await db.collection(route.collection).get(route.id);
    const html = renderRecordDetailPage(manifest, route.collection, record, recordsByCollection, { basePath });
    if (!html) {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><meta charset="utf-8"><title>404</title><p>Record not found</p>');
      return true;
    }

    sendHtml(response, html);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(message);
    return true;
  }
}

function sendHtml(response, html) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(html);
}

function parsePath(pathname, basePath = '') {
  const strippedPathname = stripBasePath(pathname, basePath);
  if (strippedPathname === null) {
    return null;
  }

  const normalized = strippedPathname === '' ? '/' : strippedPathname;
  if (normalized === '/' || normalized === '/index.html') {
    return { type: 'home' };
  }

  if (normalized === '/templates') {
    return { type: 'templates' };
  }

  const segments = normalized.replace(/^\/+|\/+$/gu, '').split('/').filter(Boolean);
  if (segments[0] === 'cms' && segments.length === 2) {
    return { type: 'list', collection: segments[1] };
  }

  if (segments[0] === 'cms' && segments.length === 3) {
    return { type: 'detail', collection: segments[1], id: decodeURIComponent(segments[2]) };
  }

  return null;
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

function normalizeBasePath(basePath) {
  if (!basePath || basePath === '/') {
    return '';
  }
  return `/${String(basePath).replace(/^\/+|\/+$/gu, '')}`;
}

async function loadRecordsByCollection(db, manifest) {
  /** @type {Record<string, unknown[]>} */
  const out = {};

  for (const name of Object.keys(manifest.collections ?? {})) {
    const meta = manifest.collections[name];
    if (meta?.kind !== 'collection') {
      continue;
    }

    out[name] = await db.collection(name).all();
  }

  return out;
}
