import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { parseCsvRecords } from '../csv.js';
import { dbError, listChoices, serializeError } from '../errors.js';
import { executeSequentialJsonBatch, readJsonBody, readRawBody, sendJson, sendText, tryJsonEndpoint } from '../features/http/json-endpoint.js';
import { resolveResource, resourceNameCandidates } from '../names.js';
import { makeGeneratedSchema } from '../schema.js';
import { syncDb } from '../sync.js';
import { renderViewerManifest } from '../viewer-manifest.js';
import { renderDbViewer } from '../web/viewer.js';
import { availableRestFormats, negotiateRestFormat, resolveRestFormat, restFormatMetadata } from './formats.js';
import { shapeCollectionRead } from './shape.js';
import { type RequestTrace, tracePhase, tracePhaseSync } from '../tracing.js';

type RestConfig = {
  cwd: string;
  sourceDir: string;
  stateDir: string;
  server?: {
    apiBase?: string;
    maxBodyBytes?: number;
    viewerLinks?: unknown[];
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
    formats?: Record<string, RestFormatInputLike> & {
      default?: RestFormatInputLike;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type RestRendererLike = (context: Record<string, unknown>) => unknown;

type RestFormatObjectLike = {
  mediaTypes?: string | string[];
  contentType?: string;
  render?: RestRendererLike;
  renderResource?: RestRendererLike;
  renderManifest?: RestRendererLike;
  [key: string]: unknown;
};

type RestFormatInputLike = string | RestRendererLike | RestFormatObjectLike | null | undefined;

type RestResource = {
  name: string;
  kind?: string;
  routePath?: string;
  idField?: string;
  dataPath?: string;
  schemaPath?: string;
  seed?: unknown;
  [key: string]: unknown;
};

type RestCollection = {
  all(): unknown[] | Promise<unknown[]>;
  get(id: string): unknown | Promise<unknown>;
  create(body: unknown): unknown | Promise<unknown>;
  patch(id: string, body: unknown): unknown | Promise<unknown>;
  delete(id: string): boolean | Promise<boolean>;
  replaceAll(records: unknown[]): unknown[] | Promise<unknown[]>;
};

type RestDocument = {
  all(): unknown | Promise<unknown>;
  put(body: unknown): unknown | Promise<unknown>;
  update(body: unknown): unknown | Promise<unknown>;
};

type RestDb = {
  config: RestConfig;
  resources: Map<string, RestResource>;
  diagnostics?: unknown[];
  schemaVersion?: number;
  collection(name: string): RestCollection;
  document(name: string): RestDocument;
  resourceNames(): string[];
};

type RestHeaderBag = {
  get?: (name: string) => string | null;
  [key: string]: unknown;
};

type RestRequest = (IncomingMessage | AsyncIterable<unknown>) & {
  method?: string;
  url?: string;
  headers?: RestHeaderBag;
};

type RestResponse = ServerResponse | {
  writeHead(status: number, headers?: Record<string, unknown>): unknown;
  end(chunk?: unknown): unknown;
};

type ErrorWithStatus = Error & {
  status?: number;
  code?: string;
};

type RestRouteOptionsInput = {
  apiBase?: string;
  viewerPath?: string;
  manifestPath?: string;
  manifestJsonPath?: string;
  manifestHtmlPath?: string;
  manifestMarkdownPath?: string;
  schemaPath?: string;
  batchPath?: string;
  importPath?: string;
  eventsPath?: string;
  graphqlPath?: string;
  falcorPath?: string;
  restBasePath?: string;
  resourceBasePath?: string;
  batchAliases?: string[];
  resourceRoutesEnabled?: boolean;
  trace?: unknown;
  traceNested?: boolean;
  [key: string]: unknown;
};

type RestRouteOptions = Required<Pick<
  RestRouteOptionsInput,
  'apiBase'
  | 'viewerPath'
  | 'manifestPath'
  | 'manifestJsonPath'
  | 'manifestHtmlPath'
  | 'manifestMarkdownPath'
  | 'schemaPath'
  | 'batchPath'
  | 'importPath'
  | 'eventsPath'
  | 'graphqlPath'
  | 'restBasePath'
  | 'resourceBasePath'
  | 'resourceRoutesEnabled'
  | 'traceNested'
>> & {
  trace: RequestTrace | null;
  batchAliases: string[];
};

type ParsedResourcePath = {
  routeName: string | undefined;
  id: string | undefined;
  format: string | null;
};

type BatchRequestItem = {
  method?: unknown;
  path?: unknown;
  body?: unknown;
  [key: string]: unknown;
};

type BulkResult = {
  index: number;
  id?: unknown;
  status: number;
  body: unknown;
};

type BulkEnvelope = {
  results: BulkResult[];
  summary: {
    ok: number;
    errors: number;
  };
};

type RestResult = {
  status: number;
  headers: Record<string, unknown>;
  body: unknown;
};

type ViewerLink = {
  label: string;
  href: string;
  source: string;
};

type RootDiscovery = {
  resources: string[];
  viewer: string;
  viewers: ViewerLink[];
  formats: unknown;
  manifest: string;
  manifestJson: string;
  manifestHtml: string;
  manifestMarkdown: string;
  schema: string;
  graphql: string | null;
  falcor: string | null;
  batchAliases: string[];
  resourceBasePath: string;
  links: {
    viewer: string;
    viewers: ViewerLink[];
    formats: unknown;
    manifest: string;
    manifestJson: string;
    manifestHtml: string;
    manifestMarkdown: string;
    schema: string;
    graphql: string | null;
    falcor: string | null;
    batchAliases: string[];
    resourceBasePath: string;
    resources: Record<string, string>;
    resourceAliases: Record<string, string>;
  };
};

type FormatResult = string | Buffer | {
  status?: number;
  body?: unknown;
  contentType?: string;
  headers?: Record<string, unknown>;
} | null | undefined;

export async function handleRestRequest(
  db: unknown,
  request: RestRequest,
  response: unknown,
  url = new URL(request.url ?? '/', 'http://db.local'),
  options: RestRouteOptionsInput = {},
): Promise<void> {
  try {
    await handleRestRequestUnsafe(db as RestDb, request, response as RestResponse, url, options);
  } catch (error) {
    asRequestTrace(options.trace)?.setError(error as ErrorWithStatus);
    sendJson(response, (error as ErrorWithStatus).status ?? 500, serializeError(error, 'REST_ERROR'));
  }
}

async function handleRestRequestUnsafe(
  db: RestDb,
  request: RestRequest,
  response: RestResponse,
  url: URL,
  options: RestRouteOptionsInput,
): Promise<void> {
  const routeOptions = normalizeRestRouteOptions(db, options);
  const trace = routeOptions.trace;

  if (request.method === 'GET' && url.pathname === routeOptions.viewerPath) {
    setRestTraceRoute(trace, routeOptions, { route: 'viewer', operation: 'render' });
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

  if (request.method === 'POST' && isBatchRoute(url.pathname, routeOptions)) {
    setRestTraceRoute(trace, routeOptions, { operation: 'batch' });
    if (!routeOptions.resourceRoutesEnabled) {
      sendRestDisabled(response, 'REST batch routes are disabled.');
      return;
    }

    const body = await tracePhase(trace, 'request-body', () => readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    }));
    const result = await tryJsonEndpoint(async () => tracePhase(trace, 'batch-execution', () => executeRestBatch(db, body, routeOptions), {
      itemCount: Array.isArray(body) ? body.length : Array.isArray((body as { requests?: unknown } | null)?.requests) ? ((body as { requests: unknown[] }).requests).length : undefined,
    }));
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === 'POST' && url.pathname === routeOptions.importPath) {
    setRestTraceRoute(trace, routeOptions, { route: 'import', operation: 'csv' });
    sendJson(response, 201, await tracePhase(trace, 'import-csv', () => importCsvFixture(db, request, routeOptions)));
    return;
  }

  if (request.method === 'GET' && url.pathname === routeOptions.schemaPath) {
    setRestTraceRoute(trace, routeOptions, { route: 'schema', operation: 'read' });
    sendJson(response, 200, makeGeneratedSchema([...db.resources.values()] as never, (db.diagnostics ?? []) as never));
    return;
  }

  const manifestFormat = request.method === 'GET'
    ? manifestResponseFormat(url, request, routeOptions, db.config)
    : null;
  if (manifestFormat) {
    setRestTraceRoute(trace, routeOptions, { route: 'manifest', operation: 'render' });
    const manifest = tracePhaseSync(trace, 'manifest-build', () => renderViewerManifest([...db.resources.values()] as never, db.config, {
      diagnostics: db.diagnostics ?? [],
      routes: routeOptions,
    }));

    const resolved = resolveRestFormat(db.config, manifestFormat, 'manifest');
    if (!resolved) {
      sendUnknownFormat(response, manifestFormat, db.config, 'manifest');
      return;
    }

    const result = await tracePhase(trace, 'response-formatting', () => resolved.renderer({
      db,
      data: manifest,
      manifest,
      format: resolved.key,
      request,
      url,
      routes: routeOptions,
      target: 'manifest',
    }), {
      format: resolved.key,
      target: 'manifest',
    });
    const normalized = normalizeFormatResult(result, resolved.contentType);
    sendText(response, normalized.status, normalized.body, normalized.contentType);
    return;
  }

  const resourceUrl = tracePhaseSync(trace, 'rest-route', () => restResourceUrl(url, routeOptions));
  const [rawRouteName, rawId] = resourceUrl.pathname.split('/').filter(Boolean);
  const { routeName, id, format } = parseFormattedResourcePath(rawRouteName, rawId);
  if (!routeName) {
    setRestTraceRoute(trace, routeOptions, { operation: 'discovery' });
    const discovery = rootDiscovery(db, routeOptions);
    if (request.method === 'GET' && requestPrefersHtml(db.config, request)) {
      sendText(response, 200, renderRootDiscovery(discovery), 'text/html; charset=utf-8');
      return;
    }

    sendJson(response, 200, discovery);
    return;
  }

  const resource = tracePhaseSync(trace, 'resource-lookup', () => findResourceByRoute(db, routeName), {
    routeName,
  });
  if (!resource) {
    setRestTraceRoute(trace, routeOptions, { resource: routeName, operation: 'unknown' });
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
    setRestTraceRoute(trace, routeOptions, { resource: resource.name, operation: 'disabled' });
    sendRestDisabled(response, `REST resource routes are disabled. Cannot serve "${routeName}".`, {
      resource: resource.name,
      routeName,
    });
    return;
  }

  if (resource.kind === 'collection') {
    await handleCollection(db, resource, id, request, response, resourceUrl, format, routeOptions);
  } else {
    await handleDocument(db, resource, request, response, format, routeOptions);
  }
}

function parseFormattedResourcePath(routeName: string | undefined, id: string | undefined): ParsedResourcePath {
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

function splitFormatExtension(value: unknown): { name: string; format: string | null } {
  const match = String(value).match(/^(.+)\.([A-Za-z][A-Za-z0-9_-]*)$/);
  if (!match) {
    return { name: String(value), format: null };
  }

  return {
    name: match[1],
    format: match[2],
  };
}

export function findResourceByRoute(db: RestDb, routeName: string): RestResource | undefined {
  return resolveResource(db.resources, routeName).resource
    ?? [...db.resources.values()].find((candidate) => (candidate.routePath as string).slice(1) === routeName);
}

export async function executeRestBatch(db: RestDb, body: unknown, options: RestRouteOptionsInput = {}): Promise<Array<RestResult & { index: number }>> {
  const requests = Array.isArray(body) ? body : (body as { requests?: unknown }).requests;
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

  return await executeSequentialJsonBatch(
    requests as unknown[],
    (request) => executeRestBatchItem(db, request, options),
    {
      trace: asRequestTrace(options.trace),
      phaseName: 'batch-item',
      itemDetails: batchItemTraceDetails,
      errorCode: 'REST_ERROR',
    },
  ) as Array<RestResult & { index: number }>;
}

export { readRawBody, readJsonBody, sendJson, sendText };

function maxBodyBytes(db: RestDb): number {
  return Number(db.config.server?.maxBodyBytes ?? 1048576);
}

function asRequestTrace(value: unknown): RequestTrace | null {
  return value ? value as RequestTrace : null;
}

function normalizeRestRouteOptions(db: RestDb, options: RestRouteOptionsInput = {}): RestRouteOptions {
  const apiBase = normalizeBasePath(options.apiBase ?? db.config.server?.apiBase ?? '/__db');
  const batchPath = options.batchPath ?? `${apiBase}/batch`;
  return {
    apiBase,
    viewerPath: options.viewerPath ?? apiBase,
    manifestPath: options.manifestPath ?? `${apiBase}/manifest`,
    manifestJsonPath: options.manifestJsonPath ?? `${apiBase}/manifest.json`,
    manifestHtmlPath: options.manifestHtmlPath ?? `${apiBase}/manifest.html`,
    manifestMarkdownPath: options.manifestMarkdownPath ?? `${apiBase}/manifest.md`,
    schemaPath: options.schemaPath ?? `${apiBase}/schema`,
    batchPath,
    importPath: options.importPath ?? `${apiBase}/import`,
    eventsPath: options.eventsPath ?? `${apiBase}/events`,
    graphqlPath: options.graphqlPath ?? db.config.graphql?.path ?? '/graphql',
    restBasePath: options.restBasePath ?? '',
    resourceBasePath: normalizeBasePath(options.resourceBasePath ?? '/resources'),
    resourceRoutesEnabled: options.resourceRoutesEnabled ?? db.config.rest?.enabled !== false,
    trace: asRequestTrace(options.trace),
    traceNested: options.traceNested === true,
    batchAliases: uniqueStrings([batchPath, ...(options.batchAliases ?? [])].map(normalizeBasePath)),
  };
}

function restResourceUrl(url: URL, options: RestRouteOptions): URL {
  if (!options.restBasePath || !pathStartsWith(url.pathname, options.restBasePath)) {
    if (!options.resourceBasePath || !pathStartsWith(url.pathname, options.resourceBasePath)) {
      return url;
    }

    const next = new URL(url.href);
    const stripped = next.pathname.slice(options.resourceBasePath.length);
    next.pathname = stripped.startsWith('/') ? stripped : `/${stripped}`;
    return next;
  }

  const next = new URL(url.href);
  const stripped = next.pathname.slice(options.restBasePath.length);
  next.pathname = stripped.startsWith('/') ? stripped : `/${stripped}`;
  return next;
}

function isBatchRoute(pathname: string, options: RestRouteOptions): boolean {
  return options.batchAliases.includes(pathname);
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

function sourceDirLabel(config: RestConfig): string {
  const relative = path.relative(config.cwd, config.sourceDir) || '.';
  return `${relative.split(path.sep).join('/')}/`;
}

function rootDiscovery(db: RestDb, options: RestRouteOptionsInput = {}): RootDiscovery {
  const apiBase = normalizeBasePath(options.apiBase ?? db.config.server?.apiBase ?? '/__db');
  const schemaPath = options.schemaPath ?? `${apiBase}/schema`;
  const manifestPath = options.manifestPath ?? `${apiBase}/manifest`;
  const manifestJsonPath = options.manifestJsonPath ?? `${apiBase}/manifest.json`;
  const manifestHtmlPath = options.manifestHtmlPath ?? `${apiBase}/manifest.html`;
  const manifestMarkdownPath = options.manifestMarkdownPath ?? `${apiBase}/manifest.md`;
  const viewerPath = options.viewerPath ?? apiBase;
  const graphqlPath = options.graphqlPath ?? db.config.graphql?.path ?? '/graphql';
  const falcorPath = typeof options.falcorPath === 'string' ? options.falcorPath : db.config.falcor?.path ?? '/model.json';
  const batchPath = options.batchPath ?? `${apiBase}/batch`;
  const batchAliases = uniqueStrings([batchPath, ...(options.batchAliases ?? [])].map(normalizeBasePath));
  const resourceBasePath = normalizeBasePath(options.resourceBasePath ?? '/resources');
  const graphqlEnabled = db.config.graphql?.enabled !== false;
  const falcorEnabled = db.config.falcor?.enabled !== false;
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
    falcor: falcorEnabled ? falcorPath : null,
    batchAliases,
    resourceBasePath,
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
      falcor: falcorEnabled ? falcorPath : null,
      batchAliases,
      resourceBasePath,
      resources: resourceRoutesEnabled
        ? Object.fromEntries([...db.resources.values()].map((resource) => [resource.name, joinPaths(options.restBasePath ?? '', resource.routePath as string)]))
        : {},
      resourceAliases: resourceRoutesEnabled
        ? Object.fromEntries([...db.resources.values()].map((resource) => [resource.name, joinPaths(resourceBasePath, resource.routePath as string)]))
        : {},
    },
  };
}

function viewerLinks(config: RestConfig, viewerPath: string): ViewerLink[] {
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

function normalizeViewerLink(link: unknown): ViewerLink | null {
  if (!link || typeof link !== 'object') {
    return null;
  }

  const record = link as Record<string, unknown>;
  const href = typeof record.href === 'string' ? record.href : record.url;
  if (typeof href !== 'string' || href.trim() === '') {
    return null;
  }

  return {
    label: typeof record.label === 'string' && record.label.trim() ? record.label : 'Custom Viewer',
    href,
    source: 'custom',
  };
}

function joinPaths(basePath: unknown, routePath: unknown): string {
  if (!basePath) {
    return String(routePath);
  }

  const base = `/${String(basePath).replace(/^\/+/, '').replace(/\/+$/, '')}`;
  const route = `/${String(routePath || '/').replace(/^\/+/, '')}`;
  return `${base}${route === '/' ? '' : route}`;
}

function requestPrefersHtml(config: RestConfig, request: RestRequest): boolean {
  return negotiateRestFormat(config, request, 'resource') === 'html';
}

function renderRootDiscovery(discovery: RootDiscovery): string {
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
    <p>Local data file resources and tools.</p>

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

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function importCsvFixture(db: RestDb, request: RestRequest, options: RestRouteOptionsInput = {}): Promise<Record<string, unknown>> {
  const filename = csvFilenameFromRequest(request);
  const body = await readRawBody(request, {
    maxBytes: maxBodyBytes(db),
  });
  parseCsvRecords(body.toString('utf8'), filename);

  await mkdir(db.config.sourceDir, { recursive: true });
  const outFile = path.join(db.config.sourceDir, filename);
  await writeFile(outFile, body);

  const project = await syncDb(db.config as never, { allowErrors: true });
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

function csvFilenameFromRequest(request: RestRequest): string {
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

function headerValue(request: RestRequest, name: string): unknown {
  if (typeof request.headers?.get === 'function') {
    return request.headers.get(name);
  }

  return request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
}

async function executeRestBatchItem(db: RestDb, item: unknown, options: RestRouteOptionsInput = {}): Promise<RestResult> {
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

  const batchItem = item as BatchRequestItem;
  const method = String(batchItem.method ?? 'GET').toUpperCase();
  const requestPath = String(batchItem.path ?? '/');

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
    makeBatchRequest(method, batchItem.body),
    response,
    new URL(requestPath, 'http://db.local'),
    { ...options, traceNested: true },
  );

  return {
    status: response.status,
    headers: response.headers,
    body: response.jsonBody(),
  };
}

function batchPathForOptions(options: RestRouteOptionsInput = {}, db: Pick<RestDb, 'config'> | null = null): string {
  return options.batchPath ?? `${normalizeBasePath(options.apiBase ?? db?.config?.server?.apiBase ?? '/__db')}/batch`;
}

function makeBatchRequest(method: string, body: unknown): RestRequest {
  return {
    method,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
  };
}

type BatchResponse = RestResponse & {
  status: number;
  headers: Record<string, unknown>;
  body: string;
  jsonBody(): unknown;
};

function makeBatchResponse(): BatchResponse {
  return {
    status: 200,
    headers: {},
    body: '',
    writeHead(status: number, headers: Record<string, unknown> = {}) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk: unknown = '') {
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

async function handleCollection(
  db: RestDb,
  resource: RestResource,
  id: string | undefined,
  request: RestRequest,
  response: RestResponse,
  url: URL,
  format: string | null,
  options: RestRouteOptions,
): Promise<void> {
  const trace = options.trace;
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
    setRestTraceRoute(trace, options, { resource: resource.name, operation: 'list' });
    const records = await tracePhase(trace, 'collection-read', () => collection.all(), {
      resource: resource.name,
      operation: 'all',
    });
    const shaped = await tracePhase(trace, 'response-shaping', () => shapeCollectionRead(db as never, resource, records as never, url, { allowPagination: true }), {
      resource: resource.name,
    });
    await sendFormattedResource(db, response, resource, shaped, format, request, url, trace);
    return;
  }

  if (request.method === 'GET' && recordId) {
    setRestTraceRoute(trace, options, { resource: resource.name, operation: 'get', id: recordId });
    const record = await tracePhase(trace, 'collection-read', () => collection.get(recordId), {
      resource: resource.name,
      operation: 'get',
    });
    const body = record
      ? await tracePhase(trace, 'response-shaping', () => shapeCollectionRead(db as never, resource, [record] as never, url, { allowPagination: false }), {
        resource: resource.name,
      })
      : null;
    if (!record) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    await sendFormattedResource(db, response, resource, body[0], format, request, url, trace);
    return;
  }

  if (request.method === 'POST' && !id) {
    setRestTraceRoute(trace, options, { resource: resource.name, operation: 'create' });
    const body = await tracePhase(trace, 'request-body', () => readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    }));
    if (Array.isArray(body)) {
      const result = await tracePhase(trace, 'collection-bulk-write', () => executeBulkCreate(collection, resource, body), {
        resource: resource.name,
        operation: 'bulk-create',
        itemCount: body.length,
      });
      sendJson(response, bulkStatus(result, 201), result);
      return;
    }
    sendJson(response, 201, await tracePhase(trace, 'collection-write', () => collection.create(body), {
      resource: resource.name,
      operation: 'create',
    }));
    return;
  }

  if (request.method === 'PATCH' && !id) {
    setRestTraceRoute(trace, options, { resource: resource.name, operation: 'bulk-patch' });
    const body = await tracePhase(trace, 'request-body', () => readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    }));
    const result = await tracePhase(trace, 'collection-bulk-write', () => executeBulkPatch(collection, resource, body), {
      resource: resource.name,
      operation: 'bulk-patch',
      itemCount: bulkItemCount(body),
    });
    sendJson(response, bulkStatus(result), result);
    return;
  }

  if (request.method === 'PUT' && !id) {
    setRestTraceRoute(trace, options, { resource: resource.name, operation: 'bulk-replace' });
    const body = await tracePhase(trace, 'request-body', () => readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    }));
    const result = await tracePhase(trace, 'collection-bulk-write', () => executeBulkReplace(collection, resource, body), {
      resource: resource.name,
      operation: 'bulk-replace',
      itemCount: bulkItemCount(body),
    });
    sendJson(response, bulkStatus(result), result);
    return;
  }

  if (request.method === 'PATCH' && id) {
    setRestTraceRoute(trace, options, { resource: resource.name, operation: 'patch', id });
    const body = await tracePhase(trace, 'request-body', () => readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    }));
    const record = await tracePhase(trace, 'collection-write', () => collection.patch(id, body), {
      resource: resource.name,
      operation: 'patch',
    });
    sendJson(response, record ? 200 : 404, record ?? { error: 'Not found' });
    return;
  }

  if (request.method === 'DELETE' && !id) {
    setRestTraceRoute(trace, options, { resource: resource.name, operation: 'bulk-delete' });
    const ids = await tracePhase(trace, 'request-body', () => bulkDeleteIds(request, url, db), {
      resource: resource.name,
      operation: 'bulk-delete',
    });
    const result = await tracePhase(trace, 'collection-bulk-write', () => executeBulkDelete(collection, resource, ids), {
      resource: resource.name,
      operation: 'bulk-delete',
      itemCount: ids.length,
    });
    sendJson(response, bulkStatus(result), result);
    return;
  }

  if (request.method === 'DELETE' && id) {
    setRestTraceRoute(trace, options, { resource: resource.name, operation: 'delete', id });
    const deleted = await tracePhase(trace, 'collection-write', () => collection.delete(id), {
      resource: resource.name,
      operation: 'delete',
    });
    sendJson(response, deleted ? 204 : 404, deleted ? null : { error: 'Not found' });
    return;
  }

  setRestTraceRoute(trace, options, { resource: resource.name, operation: 'method-not-allowed' });
  sendJson(response, 405, {
    error: 'Method not allowed',
  });
}

function idQueryRequiresJsonRoute(resource: RestResource, id: string | null): Error {
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

async function executeBulkCreate(
  collection: RestCollection,
  resource: RestResource,
  records: unknown[],
): Promise<BulkEnvelope> {
  const results = await bulkResults(records, async (record, index) => {
    if (!isRecord(record)) {
      throw invalidBulkItem(resource, 'Bulk create items must be objects.', index);
    }
    const created = await collection.create(record);
    return {
      id: idForBulkBody(created, resource),
      status: 201,
      body: created,
    };
  });
  return bulkEnvelope(results);
}

async function executeBulkPatch(
  collection: RestCollection,
  resource: RestResource,
  body: unknown,
): Promise<BulkEnvelope> {
  const requests = normalizeBulkPatchRequests(resource, body);
  const results = await bulkResults(requests, async (request) => {
    const patched = await collection.patch(String(request.id), request.patch);
    if (!patched) {
      return {
        id: request.id,
        status: 404,
        body: { error: 'Not found' },
      };
    }
    return {
      id: request.id,
      status: 200,
      body: patched,
    };
  });
  return bulkEnvelope(results);
}

async function executeBulkReplace(
  collection: RestCollection,
  resource: RestResource,
  body: unknown,
): Promise<BulkEnvelope> {
  const records = normalizeBulkReplaceRecords(resource, body);
  const results = await bulkResults(records, async (record) => {
    const id = idForBulkBody(record, resource);
    const current = await collection.all() as Record<string, unknown>[];
    const index = current.findIndex((candidate) => idMatches(candidate?.[resource.idField], id));
    if (index === -1) {
      return {
        id,
        status: 404,
        body: { error: 'Not found' },
      };
    }

    const nextRecords = [...current];
    nextRecords[index] = {
      ...record,
      [resource.idField]: current[index]?.[resource.idField],
    };
    await collection.replaceAll(nextRecords);
    return {
      id,
      status: 200,
      body: nextRecords[index],
    };
  });
  return bulkEnvelope(results);
}

async function executeBulkDelete(
  collection: RestCollection,
  resource: RestResource,
  ids: unknown[],
): Promise<BulkEnvelope> {
  const results = await bulkResults(ids, async (id) => {
    const deleted = await collection.delete(String(id));
    return {
      id,
      status: deleted ? 204 : 404,
      body: deleted ? null : { error: 'Not found' },
    };
  });
  return bulkEnvelope(results);
}

async function bulkDeleteIds(request: RestRequest, url: URL, db: RestDb): Promise<unknown[]> {
  const queryIds = url.searchParams.getAll('id');
  if (queryIds.length > 0) {
    return queryIds;
  }

  const body = await readJsonBody(request, {
    maxBytes: maxBodyBytes(db),
  });
  if (!isRecord(body) || !Array.isArray(body.ids)) {
    throw dbError(
      'REST_BULK_DELETE_INVALID_BODY',
      'Bulk delete requires repeated id query parameters or a body with an ids array.',
      {
        status: 400,
        hint: 'Use DELETE /resources/users?id=u_1&id=u_2 or { "ids": ["u_1", "u_2"] }.',
      },
    );
  }
  return body.ids;
}

function normalizeBulkPatchRequests(
  resource: RestResource,
  body: unknown,
): Array<{ id: unknown; patch: Record<string, unknown> }> {
  if (Array.isArray(body)) {
    return body.map((item, index) => {
      if (!isRecord(item) || !('id' in item) || !isRecord(item.patch)) {
        throw invalidBulkItem(resource, 'Bulk patch array items must include id and patch object.', index);
      }
      return {
        id: item.id,
        patch: item.patch,
      };
    });
  }

  if (isRecord(body) && Array.isArray(body.ids) && isRecord(body.patch)) {
    return body.ids.map((id) => ({
      id,
      patch: body.patch as Record<string, unknown>,
    }));
  }

  throw dbError(
    'REST_BULK_PATCH_INVALID_BODY',
    `Bulk patch for ${resource.name} requires ids plus patch or an array of per-record patch items.`,
    {
      status: 400,
      hint: 'Use { "ids": ["u_1"], "patch": { "active": false } } or [{ "id": "u_1", "patch": { "name": "Ada" } }].',
      details: {
        resource: resource.name,
      },
    },
  );
}

function normalizeBulkReplaceRecords(resource: RestResource, body: unknown): Array<Record<string, unknown>> {
  const records = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.records)
      ? body.records
      : null;

  if (!records) {
    throw dbError(
      'REST_BULK_REPLACE_INVALID_BODY',
      `Bulk replace for ${resource.name} requires an array or a records array.`,
      {
        status: 400,
        hint: 'Use { "records": [{ "id": "u_1", "name": "Ada Lovelace" }] }.',
        details: {
          resource: resource.name,
        },
      },
    );
  }

  return records.map((record, index) => {
    if (!isRecord(record) || idForBulkBody(record, resource) === undefined) {
      throw invalidBulkItem(resource, `Bulk replace items must include ${resource.idField ?? 'id'}.`, index);
    }
    return record;
  });
}

async function bulkResults<T>(
  items: T[],
  execute: (item: T, index: number) => Promise<Omit<BulkResult, 'index'>>,
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const [index, item] of items.entries()) {
    try {
      const result = await execute(item, index);
      results.push({
        index,
        ...result,
      });
    } catch (error) {
      results.push({
        index,
        status: (error as ErrorWithStatus).status ?? 500,
        body: serializeError(error, 'REST_ERROR'),
      });
    }
  }
  return results;
}

function bulkEnvelope(results: BulkResult[]): BulkEnvelope {
  const ok = results.filter((result) => result.status >= 200 && result.status < 300).length;
  return {
    results,
    summary: {
      ok,
      errors: results.length - ok,
    },
  };
}

function bulkStatus(envelope: BulkEnvelope, defaultStatus = 200): number {
  if (envelope.results.length === 0) {
    return defaultStatus;
  }
  return envelope.summary.ok > 0 ? defaultStatus : 400;
}

function idForBulkBody(value: unknown, resource: RestResource): unknown {
  return isRecord(value) ? value[resource.idField ?? 'id'] : undefined;
}

function bulkItemCount(body: unknown): number | undefined {
  if (Array.isArray(body)) {
    return body.length;
  }
  if (isRecord(body) && Array.isArray(body.ids)) {
    return body.ids.length;
  }
  if (isRecord(body) && Array.isArray(body.records)) {
    return body.records.length;
  }
  return undefined;
}

function invalidBulkItem(resource: RestResource, message: string, index: number): Error {
  return dbError(
    'REST_BULK_INVALID_ITEM',
    message,
    {
      status: 400,
      hint: 'Check the bulk request body for the expected ids, patch objects, or records array.',
      details: {
        resource: resource.name,
        index,
      },
    },
  );
}

function idMatches(left: unknown, right: unknown): boolean {
  return String(left) === String(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function handleDocument(
  db: RestDb,
  resource: RestResource,
  request: RestRequest,
  response: RestResponse,
  format: string | null,
  options: RestRouteOptions,
): Promise<void> {
  const trace = options.trace;
  const document = db.document(resource.name);

  if (request.method === 'GET') {
    setRestTraceRoute(trace, options, { resource: resource.name, operation: 'get' });
    const data = await tracePhase(trace, 'document-read', () => document.all(), {
      resource: resource.name,
      operation: 'all',
    });
    await sendFormattedResource(db, response, resource, data, format, request, new URL(request.url ?? '/', 'http://db.local'), trace);
    return;
  }

  if (request.method === 'PUT') {
    setRestTraceRoute(trace, options, { resource: resource.name, operation: 'put' });
    const body = await tracePhase(trace, 'request-body', () => readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    }));
    sendJson(response, 200, await tracePhase(trace, 'document-write', () => document.put(body), {
      resource: resource.name,
      operation: 'put',
    }));
    return;
  }

  if (request.method === 'PATCH') {
    setRestTraceRoute(trace, options, { resource: resource.name, operation: 'patch' });
    const body = await tracePhase(trace, 'request-body', () => readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    }));
    sendJson(response, 200, await tracePhase(trace, 'document-write', () => document.update(body), {
      resource: resource.name,
      operation: 'patch',
    }));
    return;
  }

  setRestTraceRoute(trace, options, { resource: resource.name, operation: 'method-not-allowed' });
  sendJson(response, 405, {
    error: 'Method not allowed',
  });
}

async function sendFormattedResource(
  db: RestDb,
  response: RestResponse,
  resource: RestResource,
  data: unknown,
  format: string | null,
  request: RestRequest,
  url: URL,
  trace: RequestTrace | null = null,
): Promise<void> {
  const effectiveFormat = format ?? negotiateRestFormat(db.config, request, 'resource');
  const resolved = resolveRestFormat(db.config, effectiveFormat, 'resource');
  if (!resolved) {
    sendUnknownFormat(response, effectiveFormat, db.config, 'resource');
    return;
  }

  const result = await tracePhase(trace, 'response-formatting', () => resolved.renderer({
    db,
    resource,
    resourceName: resource.name,
    data,
    format: resolved.key,
    request,
    url,
    target: 'resource',
  }), {
    resource: resource.name,
    format: resolved.key,
    target: 'resource',
  });
  const normalized = normalizeFormatResult(result, resolved.contentType);

  sendText(response, normalized.status, normalized.body, normalized.contentType);
}

function setRestTraceRoute(trace: RequestTrace | null | undefined, options: Pick<RestRouteOptions, 'traceNested'>, details: Record<string, unknown>): void {
  if (!trace || options.traceNested) {
    return;
  }
  trace.setRoute({
    route: trace.event.route === 'operation' ? undefined : 'rest',
    ...details,
  });
}

function batchItemTraceDetails(index: number, request: unknown): Record<string, unknown> {
  const item = request as BatchRequestItem | null | undefined;
  const method = String(item?.method ?? 'GET').toUpperCase();
  const rawPath = String(item?.path ?? '/');
  const url = rawPath.startsWith('/')
    ? new URL(rawPath, 'http://db.local')
    : null;
  return {
    index,
    method,
    pathname: url?.pathname,
    queryKeys: url ? [...new Set([...url.searchParams.keys()])].sort() : [],
  };
}

function manifestResponseFormat(url: URL, request: RestRequest, routes: RestRouteOptions, config: RestConfig): string | null {
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

function sendUnknownFormat(response: RestResponse, format: string, config: RestConfig, target: 'resource' | 'manifest'): void {
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

function sendRestDisabled(response: RestResponse, message: string, details: Record<string, unknown> = {}): void {
  sendJson(response, 404, {
    error: {
      code: 'REST_DISABLED',
      message,
      hint: 'Set rest.enabled to true in db.config.js to enable generated REST resource routes and REST batching.',
      details: {
        restEnabled: false,
        ...details,
      },
    },
  });
}

function normalizeFormatResult(result: FormatResult, defaultContentType = 'text/plain; charset=utf-8'): { status: number; body: unknown; contentType: string } {
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
    contentType: String(result?.contentType ?? result?.headers?.['content-type'] ?? defaultContentType),
  };
}
