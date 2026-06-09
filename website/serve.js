#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDbRuntime } from '../dist/index.js';
import { serializeError } from '../dist/errors.js';
import { sendJson } from '../dist/rest/handler.js';
import { advancedRegistry, registry } from './db.schema.js';
import { buildExamplesPage, buildLandingPageHtml } from './src/landing.js';
import { renderGuidePage } from './src/site-shell.js';

const websiteRoot = path.dirname(fileURLToPath(import.meta.url));

const DOCS_REDIRECT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=./getting-started.html">
    <link rel="canonical" href="./getting-started.html">
    <title>Redirecting…</title>
  </head>
  <body>
    <p>Redirecting to <a href="./getting-started.html">Getting started</a>.</p>
  </body>
</html>`;

/**
 * @param {{ cwd?: string; host?: string; port?: number; skipSync?: boolean }} options
 */
export async function createDocsPreviewRuntime(options = {}) {
  const cwd = options.cwd ?? websiteRoot;
  const runtime = await createDbRuntime({
    cwd,
    allowSourceErrors: true,
    syncOnOpen: !options.skipSync,
    handler: {
      rootRoutes: true,
      apiBase: '/__db',
      dataPath: '/db',
      graphqlPath: '/graphql',
    },
  });
  const db = runtime.db;
  let closed = false;

  return {
    db,
    async handleRequest(request, response) {
      try {
        const handled = await handleDocsRequest(request, response, { cwd });
        if (handled) {
          return;
        }
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

async function handleDocsRequest(request, response, { cwd }) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/' || pathname === '/index.html') {
    const html = await buildLandingPageHtml();
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(html);
    return true;
  }

  if (pathname === '/docs' || pathname === '/docs/' || pathname === '/docs/index.html') {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(DOCS_REDIRECT_HTML);
    return true;
  }

  const advancedMatch = pathname.match(/^\/docs\/advanced\/([a-z0-9-]+)\.html$/u);
  if (advancedMatch) {
    const { pages, advanced } = await readDocsFresh(cwd);
    const page = advanced.find((record) => record.id === advancedMatch[1]);
    if (!page) {
      response.statusCode = 404;
      response.end('Not found');
      return true;
    }
    const html = renderGuidePage(pages, advanced, { ...page, section: 'advanced' }, { strictLinks: false });
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(html);
    return true;
  }

  if (pathname === '/docs/examples.html') {
    const html = await buildExamplesPage();
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(html);
    return true;
  }

  const guideMatch = pathname.match(/^\/docs\/([a-z0-9-]+)\.html$/u);
  if (guideMatch) {
    const { pages, advanced } = await readDocsFresh(cwd);
    const page = pages.find((record) => record.id === guideMatch[1]);
    if (!page) {
      response.statusCode = 404;
      response.end('Not found');
      return true;
    }
    const html = renderGuidePage(pages, advanced, { ...page, section: 'pages' }, { strictLinks: false });
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(html);
    return true;
  }

  return false;
}

/**
 * Live-preview liveness: re-read allowlisted markdown on every request.
 */
async function readDocsFresh(cwd) {
  const docsDir = path.resolve(cwd, '../docs');
  const advancedDir = path.join(docsDir, 'advanced');

  const pages = (await Promise.all(Object.keys(registry).map(async (id) => {
    try {
      return {
        id,
        body: await readFile(path.join(docsDir, `${id}.md`), 'utf8'),
      };
    } catch {
      return null;
    }
  }))).filter(Boolean);

  const advanced = (await Promise.all(Object.keys(advancedRegistry).map(async (id) => {
    try {
      return {
        id,
        body: await readFile(path.join(advancedDir, `${id}.md`), 'utf8'),
      };
    } catch {
      return null;
    }
  }))).filter(Boolean);

  return { pages, advanced };
}

/**
 * @param {{ host?: string; port?: number; skipSync?: boolean }} [options]
 */
export async function startDocsPreviewServer(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 7340;
  const runtime = await createDocsPreviewRuntime(options);
  const server = http.createServer((request, response) => {
    runtime.handleRequest(request, response).catch((error) => {
      sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
    });
  });

  server.once('close', () => {
    void runtime.close();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  return {
    server,
    url: `http://${host}:${boundPort}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await runtime.close();
    },
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const options = parseArgs(process.argv.slice(2));
  const app = await startDocsPreviewServer(options);
  console.log(`Docs preview: ${app.url}/`);
  console.log(`Docs area: ${app.url}/docs/getting-started.html`);
  console.log(`Built-in viewer: ${app.url}/__db`);
}

function parseArgs(argv) {
  let port = 7340;
  let host = '127.0.0.1';
  let skipSync = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port' && argv[index + 1]) {
      port = Number(argv[++index]);
    } else if (arg === '--host' && argv[index + 1]) {
      host = argv[++index];
    } else if (arg === '--no-sync') {
      skipSync = true;
    }
  }
  return { port, host, skipSync };
}
