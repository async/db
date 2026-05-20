import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCsvRecords } from '../csv.js';
import { dbError, listChoices, serializeError } from '../errors.js';
import { resolveResource, resourceNameCandidates } from '../names.js';
import { makeGeneratedSchema } from '../schema.js';
import { syncDb } from '../sync.js';
import { renderViewerManifest } from '../viewer-manifest.js';
import { renderDbViewer } from '../web/viewer.js';
import { availableRestFormats, negotiateRestFormat, resolveRestFormat, restFormatMetadata } from './formats.js';
import { shapeCollectionRead } from './shape.js';

export async function handleRestRequest(db, request, response, url = new URL(request.url, 'http://db.local'), options = {}) {
  try {
    await handleRestRequestUnsafe(db, request, response, url, options);
  } catch (error) {
    sendJson(response, error.status ?? 500, serializeError(error, 'REST_ERROR'));
  }
}

async function handleRestRequestUnsafe(db, request, response, url, options) {
  const routeOptions = normalizeRestRouteOptions(db, options);

  if (request.method === 'GET' && url.pathname === routeOptions.viewerPath) {
    sendText(response, 200, renderDbViewer({
      graphqlPath: routeOptions.graphqlPath,
      schemaPath: routeOptions.schemaPath,
      manifestPath: routeOptions.manifestJsonPath,
      eventsPath: routeOptions.eventsPath,
      importPath: routeOptions.importPath,
      restBatchPath: routeOptions.batchPath,
      restBasePath: routeOptions.restBasePath,
      sourceDirLabel: sourceDirLabel(db.config),
    }), 'text/html; charset=utf-8');
    return;
  }

  if (request.method === 'POST' && url.pathname === routeOptions.batchPath) {
    if (!routeOptions.resourceRoutesEnabled) {
      sendRestDisabled(response, 'REST batch routes are disabled.');
      return;
    }

    const result = await tryRest(async () => executeRestBatch(db, await readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    }), routeOptions));
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === 'POST' && url.pathname === routeOptions.importPath) {
    sendJson(response, 201, await importCsvFixture(db, request, routeOptions));
    return;
  }

  if (request.method === 'GET' && url.pathname === routeOptions.schemaPath) {
    sendJson(response, 200, makeGeneratedSchema([...db.resources.values()], db.diagnostics ?? []));
    return;
  }

  const manifestFormat = request.method === 'GET'
    ? manifestResponseFormat(url, request, routeOptions, db.config)
    : null;
  if (manifestFormat) {
    const manifest = renderViewerManifest([...db.resources.values()], db.config, {
      diagnostics: db.diagnostics ?? [],
      routes: routeOptions,
    });

    const resolved = resolveRestFormat(db.config, manifestFormat, 'manifest');
    if (!resolved) {
      sendUnknownFormat(response, manifestFormat, db.config, 'manifest');
      return;
    }

    const result = await resolved.renderer({
      db,
      data: manifest,
      manifest,
      format: resolved.key,
      request,
      url,
      routes: routeOptions,
      target: 'manifest',
    });
    const normalized = normalizeFormatResult(result, resolved.contentType);
    sendText(response, normalized.status, normalized.body, normalized.contentType);
    return;
  }

  const resourceUrl = restResourceUrl(url, routeOptions);
  const [rawRouteName, rawId] = resourceUrl.pathname.split('/').filter(Boolean);
  const { routeName, id, format } = parseFormattedResourcePath(rawRouteName, rawId);
  if (!routeName) {
    const discovery = rootDiscovery(db, routeOptions);
    if (request.method === 'GET' && requestPrefersHtml(db.config, request)) {
      sendText(response, 200, renderRootDiscovery(discovery), 'text/html; charset=utf-8');
      return;
    }

    sendJson(response, 200, discovery);
    return;
  }

  const resource = findResourceByRoute(db, routeName);
  if (!resource) {
    sendJson(response, 404, {
      error: {
        code: 'REST_UNKNOWN_RESOURCE',
        message: `Unknown REST resource "${routeName}".`,
        hint: `Use one of: ${listChoices([...db.resources.values()].map((resource) => resource.routePath))}.`,
        details: {
          routeName,
          resource: routeName,
          requestedResource: routeName,
          normalizedCandidates: resourceNameCandidates(routeName),
          availableResources: db.resourceNames(),
          availableRoutes: [...db.resources.values()].map((resource) => resource.routePath),
        },
      },
    });
    return;
  }

  if (!routeOptions.resourceRoutesEnabled) {
    sendRestDisabled(response, `REST resource routes are disabled. Cannot serve "${routeName}".`, {
      resource: resource.name,
      routeName,
    });
    return;
  }

  if (resource.kind === 'collection') {
    await handleCollection(db, resource, id, request, response, resourceUrl, format);
  } else {
    await handleDocument(db, resource, request, response, format);
  }
}

function parseFormattedResourcePath(routeName, id) {
  if (!routeName) {
    return { routeName, id, format: null };
  }

  if (id) {
    const parsedId = splitFormatExtension(id);
    return {
      routeName,
      id: parsedId.name,
      format: parsedId.format,
    };
  }

  const parsedRoute = splitFormatExtension(routeName);
  return {
    routeName: parsedRoute.name,
    id,
    format: parsedRoute.format,
  };
}

function splitFormatExtension(value) {
  const match = String(value).match(/^(.+)\.([A-Za-z][A-Za-z0-9_-]*)$/);
  if (!match) {
    return { name: value, format: null };
  }

  return {
    name: match[1],
    format: match[2],
  };
}

export function findResourceByRoute(db, routeName) {
  return resolveResource(db.resources, routeName).resource
    ?? [...db.resources.values()].find((candidate) => candidate.routePath.slice(1) === routeName);
}

export async function executeRestBatch(db, body, options = {}) {
  const requests = Array.isArray(body) ? body : body.requests;
  const batchPath = batchPathForOptions(options, db);
  if (!Array.isArray(requests)) {
    throw dbError(
      'REST_BATCH_INVALID_BODY',
      'REST batch body must be an array or an object with a requests array.',
      {
        status: 400,
        hint: `Send POST ${batchPath} with [{ "method": "GET", "path": "/users" }].`,
        details: {
          receivedType: body === null ? 'null' : Array.isArray(body) ? 'array' : typeof body,
        },
      },
    );
  }

  const results = [];
  for (const [index, request] of requests.entries()) {
    try {
      results.push({
        index,
        ...await executeRestBatchItem(db, request, options),
      });
    } catch (error) {
      results.push({
        index,
        status: error.status ?? 500,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: serializeError(error, 'REST_ERROR'),
      });
    }
  }

  return results;
}

export async function readRawBody(request, options = {}) {
  const chunks = [];
  const maxBytes = Number(options.maxBytes ?? Infinity);
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    byteLength += buffer.length;
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
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export async function readJsonBody(request, options = {}) {
  const text = (await readRawBody(request, options)).toString('utf8').trim();
  try {
    return text ? JSON.parse(text) : {};
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

function maxBodyBytes(db) {
  return Number(db.config.server?.maxBodyBytes ?? 1048576);
}

function normalizeRestRouteOptions(db, options = {}) {
  const apiBase = normalizeBasePath(options.apiBase ?? db.config.server?.apiBase ?? '/__db');
  return {
    apiBase,
    viewerPath: options.viewerPath ?? apiBase,
    manifestPath: options.manifestPath ?? `${apiBase}/manifest`,
    manifestJsonPath: options.manifestJsonPath ?? `${apiBase}/manifest.json`,
    manifestHtmlPath: options.manifestHtmlPath ?? `${apiBase}/manifest.html`,
    manifestMarkdownPath: options.manifestMarkdownPath ?? `${apiBase}/manifest.md`,
    schemaPath: options.schemaPath ?? `${apiBase}/schema`,
    batchPath: options.batchPath ?? `${apiBase}/batch`,
    importPath: options.importPath ?? `${apiBase}/import`,
    eventsPath: options.eventsPath ?? `${apiBase}/events`,
    graphqlPath: options.graphqlPath ?? db.config.graphql?.path ?? '/graphql',
    restBasePath: options.restBasePath ?? '',
    resourceRoutesEnabled: options.resourceRoutesEnabled ?? db.config.rest?.enabled !== false,
  };
}

function restResourceUrl(url, options) {
  if (!options.restBasePath || !pathStartsWith(url.pathname, options.restBasePath)) {
    return url;
  }

  const next = new URL(url.href);
  const stripped = next.pathname.slice(options.restBasePath.length);
  next.pathname = stripped.startsWith('/') ? stripped : `/${stripped}`;
  return next;
}

function pathStartsWith(pathname, basePath) {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function normalizeBasePath(value) {
  const pathValue = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return pathValue === '/' ? '' : pathValue;
}

function sourceDirLabel(config) {
  const relative = path.relative(config.cwd, config.sourceDir) || '.';
  return `${relative.split(path.sep).join('/')}/`;
}

function rootDiscovery(db, options = {}) {
  const apiBase = normalizeBasePath(options.apiBase ?? db.config.server?.apiBase ?? '/__db');
  const schemaPath = options.schemaPath ?? `${apiBase}/schema`;
  const manifestPath = options.manifestPath ?? `${apiBase}/manifest`;
  const manifestJsonPath = options.manifestJsonPath ?? `${apiBase}/manifest.json`;
  const manifestHtmlPath = options.manifestHtmlPath ?? `${apiBase}/manifest.html`;
  const manifestMarkdownPath = options.manifestMarkdownPath ?? `${apiBase}/manifest.md`;
  const viewerPath = options.viewerPath ?? apiBase;
  const graphqlPath = options.graphqlPath ?? db.config.graphql?.path ?? '/graphql';
  const graphqlEnabled = db.config.graphql?.enabled !== false;
  const resourceRoutesEnabled = options.resourceRoutesEnabled ?? db.config.rest?.enabled !== false;
  const viewers = viewerLinks(db.config, viewerPath);
  const formats = restFormatMetadata(db.config, {
    manifestPath,
    manifestJsonPath,
    manifestHtmlPath,
    manifestMarkdownPath,
  });

  return {
    resources: db.resourceNames(),
    viewer: viewerPath,
    viewers,
    formats,
    manifest: manifestPath,
    manifestJson: manifestJsonPath,
    manifestHtml: manifestHtmlPath,
    manifestMarkdown: manifestMarkdownPath,
    schema: schemaPath,
    graphql: graphqlEnabled ? graphqlPath : null,
    links: {
      viewer: viewerPath,
      viewers,
      formats,
      manifest: manifestPath,
      manifestJson: manifestJsonPath,
      manifestHtml: manifestHtmlPath,
      manifestMarkdown: manifestMarkdownPath,
      schema: schemaPath,
      graphql: graphqlEnabled ? graphqlPath : null,
      resources: resourceRoutesEnabled
        ? Object.fromEntries([...db.resources.values()].map((resource) => [resource.name, joinPaths(options.restBasePath ?? '', resource.routePath)]))
        : {},
    },
  };
}

function viewerLinks(config, viewerPath) {
  const configuredLinks = Array.isArray(config.server?.viewerLinks)
    ? config.server.viewerLinks
    : [];
  return [
    {
      label: 'Data Viewer',
      href: viewerPath,
      source: 'built-in',
    },
    ...configuredLinks.map(normalizeViewerLink).filter(Boolean),
  ];
}

function normalizeViewerLink(link) {
  if (!link || typeof link !== 'object') {
    return null;
  }

  const href = typeof link.href === 'string' ? link.href : link.url;
  if (typeof href !== 'string' || href.trim() === '') {
    return null;
  }

  return {
    label: typeof link.label === 'string' && link.label.trim() ? link.label : 'Custom Viewer',
    href,
    source: 'custom',
  };
}

function joinPaths(basePath, routePath) {
  if (!basePath) {
    return routePath;
  }

  const base = `/${String(basePath).replace(/^\/+/, '').replace(/\/+$/, '')}`;
  const route = `/${String(routePath || '/').replace(/^\/+/, '')}`;
  return `${base}${route === '/' ? '' : route}`;
}

function requestPrefersHtml(config, request) {
  return negotiateRestFormat(config, request, 'resource') === 'html';
}

function renderRootDiscovery(discovery) {
  const viewerLinksHtml = discovery.links.viewers.map((viewer) => (
    `<li><a href="${escapeHtml(viewer.href)}">${escapeHtml(viewer.label)}</a> <code>${escapeHtml(viewer.href)}</code></li>`
  )).join('');
  const resourceLinks = Object.entries(discovery.links.resources).map(([name, routePath]) => (
    `<li><a href="${escapeHtml(routePath)}">${escapeHtml(name)}</a> <code>${escapeHtml(routePath)}</code></li>`
  )).join('');
  const graphqlLink = discovery.graphql
    ? `<li><a href="${escapeHtml(discovery.graphql)}">GraphQL</a> <code>${escapeHtml(discovery.graphql)}</code></li>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>db</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f8fafc; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 20px; }
    h1 { margin: 0 0 8px; font-size: 2rem; line-height: 1.1; }
    p { color: #4b5563; }
    section { margin-top: 24px; }
    ul { display: grid; gap: 10px; padding: 0; list-style: none; }
    li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; background: white; }
    a { font-weight: 700; color: #047857; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { color: #475569; }
  </style>
</head>
<body>
  <main>
    <h1>db</h1>
    <p>Local fixture database resources and tools.</p>

    <section aria-labelledby="tools-heading">
      <h2 id="tools-heading">Tools</h2>
      <ul>
        ${viewerLinksHtml}
        <li><a href="${escapeHtml(discovery.manifest)}">Viewer Manifest</a> <code>${escapeHtml(discovery.manifest)}</code></li>
        <li><a href="${escapeHtml(discovery.schema)}">Schema</a> <code>${escapeHtml(discovery.schema)}</code></li>
        ${graphqlLink}
      </ul>
    </section>

    <section aria-labelledby="resources-heading">
      <h2 id="resources-heading">Resources</h2>
      <ul>${resourceLinks || '<li>No resources loaded.</li>'}</ul>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function importCsvFixture(db, request, options = {}) {
  const filename = csvFilenameFromRequest(request);
  const body = await readRawBody(request, {
    maxBytes: maxBodyBytes(db),
  });
  parseCsvRecords(body.toString('utf8'), filename);

  await mkdir(db.config.sourceDir, { recursive: true });
  const outFile = path.join(db.config.sourceDir, filename);
  await writeFile(outFile, body);

  const project = await syncDb(db.config, { allowErrors: true });
  db.resources = new Map(project.resources.map((resource) => [resource.name, resource]));
  db.diagnostics = project.diagnostics;
  db.schemaVersion = Date.now();

  const resourceName = filename.replace(/\.csv$/i, '');
  const resource = db.resources.get(resourceName);

  return {
    resource: resourceName,
    filename,
    dataPath: path.relative(db.config.cwd, outFile),
    statePath: path.relative(db.config.cwd, path.join(db.config.stateDir, 'state', `${resourceName}.json`)),
    routePath: resource?.routePath ?? `/${resourceName}`,
    viewerPath: `${options.viewerPath ?? normalizeBasePath(db.config.server?.apiBase ?? '/__db')}?resource=${encodeURIComponent(resourceName)}`,
    logs: project.logs,
  };
}

function csvFilenameFromRequest(request) {
  const rawName = headerValue(request, 'x-db-file-name');
  if (!rawName) {
    throw dbError(
      'CSV_IMPORT_MISSING_FILENAME',
      'CSV import requires an x-db-file-name header.',
      {
        status: 400,
        hint: 'Upload with a filename ending in .csv.',
      },
    );
  }

  if (!String(rawName).toLowerCase().endsWith('.csv')) {
    throw dbError(
      'CSV_IMPORT_INVALID_EXTENSION',
      `CSV import only accepts .csv files: ${rawName}`,
      {
        status: 400,
        hint: 'Choose a CSV file such as users.csv or products.csv.',
      },
    );
  }

  const base = path.basename(String(rawName)).replace(/\.csv$/i, '');
  const words = base.match(/[A-Za-z0-9]+/g) ?? [];
  const resourceName = words.map((word, index) => {
    const lower = word.toLowerCase();
    return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('') || 'importedCsv';

  return `${/^\d/.test(resourceName) ? `csv${resourceName}` : resourceName}.csv`;
}

function headerValue(request, name) {
  if (typeof request.headers?.get === 'function') {
    return request.headers.get(name);
  }

  return request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
}

export function sendJson(response, status, body) {
  if (status === 204) {
    response.writeHead(status);
    response.end();
    return;
  }

  sendText(response, status, `${JSON.stringify(body, null, 2)}\n`, 'application/json; charset=utf-8');
}

export function sendText(response, status, body, contentType) {
  response.writeHead(status, {
    'content-type': contentType,
  });
  response.end(body);
}

async function executeRestBatchItem(db, item, options = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw dbError(
      'REST_BATCH_INVALID_ITEM',
      'Each REST batch item must be an object.',
      {
        status: 400,
        hint: 'Use an item like { "method": "GET", "path": "/users" }.',
      },
    );
  }

  const method = String(item.method ?? 'GET').toUpperCase();
  const requestPath = String(item.path ?? '/');

  if (!requestPath.startsWith('/')) {
    throw dbError(
      'REST_BATCH_INVALID_PATH',
      `REST batch path must start with "/": ${requestPath}`,
      {
        status: 400,
        hint: `Use absolute local paths such as "/users", "/settings", or "${options.schemaPath ?? `${normalizeBasePath(options.apiBase ?? db.config.server?.apiBase ?? '/__db')}/schema`}".`,
        details: { path: requestPath },
      },
    );
  }

  const batchPath = batchPathForOptions(options, db);
  if (requestPath === batchPath) {
    throw dbError(
      'REST_BATCH_NESTED_UNSUPPORTED',
      'Nested REST batch requests are not supported.',
      {
        status: 400,
        hint: 'Flatten the batch array instead of calling the batch endpoint from inside another batch.',
      },
    );
  }

  const response = makeBatchResponse();
  await handleRestRequest(
    db,
    makeBatchRequest(method, item.body),
    response,
    new URL(requestPath, 'http://db.local'),
    options,
  );

  return {
    status: response.status,
    headers: response.headers,
    body: response.jsonBody(),
  };
}

function batchPathForOptions(options = {}, db = null) {
  return options.batchPath ?? `${normalizeBasePath(options.apiBase ?? db?.config?.server?.apiBase ?? '/__db')}/batch`;
}

async function tryRest(fn) {
  try {
    const body = await fn();
    return {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body,
    };
  } catch (error) {
    return {
      status: error.status ?? 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: serializeError(error, 'REST_ERROR'),
    };
  }
}

function makeBatchRequest(method, body) {
  return {
    method,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
  };
}

function makeBatchResponse() {
  return {
    status: 200,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += chunk;
    },
    jsonBody() {
      if (!this.body) {
        return null;
      }

      try {
        return JSON.parse(this.body);
      } catch {
        return this.body;
      }
    },
  };
}

async function handleCollection(db, resource, id, request, response, url, format) {
  const collection = db.collection(resource.name);
  const hasQueryId = request.method === 'GET' && !id && url.searchParams.has('id');
  if (hasQueryId && format !== 'json') {
    throw idQueryRequiresJsonRoute(resource, url.searchParams.get('id'));
  }

  const queryId = hasQueryId
    ? url.searchParams.get('id')
    : null;
  const recordId = id ?? queryId;

  if (request.method === 'GET' && !recordId) {
    await sendFormattedResource(db, response, resource, await shapeCollectionRead(db, resource, await collection.all(), url, { allowPagination: true }), format, request, url);
    return;
  }

  if (request.method === 'GET' && recordId) {
    const record = await collection.get(recordId);
    const body = record
      ? await shapeCollectionRead(db, resource, [record], url, { allowPagination: false })
      : null;
    if (!record) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    await sendFormattedResource(db, response, resource, body[0], format, request, url);
    return;
  }

  if (request.method === 'POST' && !id) {
    sendJson(response, 201, await collection.create(await readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    })));
    return;
  }

  if (request.method === 'PATCH' && id) {
    const record = await collection.patch(id, await readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    }));
    sendJson(response, record ? 200 : 404, record ?? { error: 'Not found' });
    return;
  }

  if (request.method === 'DELETE' && id) {
    const deleted = await collection.delete(id);
    sendJson(response, deleted ? 204 : 404, deleted ? null : { error: 'Not found' });
    return;
  }

  sendJson(response, 405, {
    error: 'Method not allowed',
  });
}

function idQueryRequiresJsonRoute(resource, id) {
  const value = String(id ?? '');
  const encoded = encodeURIComponent(value);
  const route = resource.routePath ?? `/${resource.name}`;
  return dbError(
    'REST_ID_QUERY_REQUIRES_JSON_ROUTE',
    `The id query parameter is only supported on explicit JSON resource routes for ${resource.name}.`,
    {
      status: 400,
      hint: `Use ${route}.json?id=${encoded} or ${route}/${encoded}.`,
      details: {
        resource: resource.name,
        id: value,
        jsonRoute: `${route}.json`,
        recordRoute: `${route}/{${resource.idField ?? 'id'}}`,
      },
    },
  );
}

async function handleDocument(db, resource, request, response, format) {
  const document = db.document(resource.name);

  if (request.method === 'GET') {
    await sendFormattedResource(db, response, resource, await document.all(), format, request, new URL(request.url ?? '/', 'http://db.local'));
    return;
  }

  if (request.method === 'PUT') {
    sendJson(response, 200, await document.put(await readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    })));
    return;
  }

  if (request.method === 'PATCH') {
    sendJson(response, 200, await document.update(await readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    })));
    return;
  }

  sendJson(response, 405, {
    error: 'Method not allowed',
  });
}

async function sendFormattedResource(db, response, resource, data, format, request, url) {
  const effectiveFormat = format ?? negotiateRestFormat(db.config, request, 'resource');
  const resolved = resolveRestFormat(db.config, effectiveFormat, 'resource');
  if (!resolved) {
    sendUnknownFormat(response, effectiveFormat, db.config, 'resource');
    return;
  }

  const result = await resolved.renderer({
    db,
    resource,
    resourceName: resource.name,
    data,
    format: resolved.key,
    request,
    url,
    target: 'resource',
  });
  const normalized = normalizeFormatResult(result, resolved.contentType);

  sendText(response, normalized.status, normalized.body, normalized.contentType);
}

function manifestResponseFormat(url, request, routes, config) {
  if (url.pathname === routes.manifestJsonPath) {
    return 'json';
  }

  if (url.pathname === routes.manifestHtmlPath) {
    return 'html';
  }

  if (url.pathname === routes.manifestMarkdownPath) {
    return 'md';
  }

  if (url.pathname === routes.manifestPath) {
    return negotiateRestFormat(config, request, 'manifest');
  }

  const parsed = splitFormatExtension(url.pathname);
  return parsed.name === routes.manifestPath ? parsed.format : null;
}

function sendUnknownFormat(response, format, config, target) {
  const availableFormats = availableRestFormats(config, target);
  sendJson(response, 404, {
    error: {
      code: 'REST_UNKNOWN_FORMAT',
      message: `Unknown REST format "${format}".`,
      hint: `Use one of: ${listChoices(availableFormats.map((item) => `.${item}`))}.`,
      details: {
        format,
        availableFormats,
      },
    },
  });
}

function sendRestDisabled(response, message, details = {}) {
  sendJson(response, 404, {
    error: {
      code: 'REST_DISABLED',
      message,
      hint: 'Set rest.enabled to true in db.config.mjs to enable generated REST resource routes and REST batching.',
      details: {
        restEnabled: false,
        ...details,
      },
    },
  });
}

function normalizeFormatResult(result, defaultContentType = 'text/plain; charset=utf-8') {
  if (typeof result === 'string' || Buffer.isBuffer(result)) {
    return {
      status: 200,
      body: result,
      contentType: defaultContentType,
    };
  }

  return {
    status: result?.status ?? 200,
    body: result?.body ?? '',
    contentType: result?.contentType ?? result?.headers?.['content-type'] ?? defaultContentType,
  };
}
