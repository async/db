import { resolveFrom, writeText } from '../../fs-utils.js';
import { restFormatMetadata } from '../../rest/formats.js';
import { loadProjectSchema } from '../schema/project.js';
import { renderSchemaManifest } from '../schema/manifest.js';

export async function generateViewerManifest(config, options = {}) {
  const project = options.project ?? await loadProjectSchema(config);
  const manifest = renderViewerManifest(project.resources, config, {
    diagnostics: project.diagnostics,
    generatedAt: options.generatedAt,
    routes: options.routes,
  });
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const outFiles = outputFiles(config, options);

  for (const outFile of outFiles) {
    await writeText(outFile, content);
  }

  return {
    manifest,
    content,
    outFiles,
    diagnostics: project.diagnostics,
  };
}

export function renderViewerManifest(resources, config = {}, options = {}) {
  const schemaManifest = renderSchemaManifest(resources, config);
  const routes = normalizeViewerRoutes(config, options.routes);
  const resourceList = [...resources];
  const collections = resourceBucketManifest(schemaManifest.collections, resourceList, routes);
  const documents = resourceBucketManifest(schemaManifest.documents, resourceList, routes);
  const restEnabled = config.rest?.enabled !== false;

  return {
    version: 1,
    kind: 'db.viewerManifest',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    api: {
      viewer: routes.viewerPath,
      manifest: routes.manifestPath,
      manifestJson: routes.manifestJsonPath,
      manifestHtml: routes.manifestHtmlPath,
      manifestMarkdown: routes.manifestMarkdownPath,
      formats: restFormatMetadata(config, routes),
      viewers: viewerLinks(config, routes.viewerPath),
      schema: routes.schemaPath,
      events: routes.eventsPath,
      batch: routes.batchPath,
      import: routes.importPath,
      graphql: routes.graphqlPath,
      restBasePath: routes.restBasePath ?? '',
      resources: Object.fromEntries(resourceList.map((resource) => [resource.name, resourceApi(resource, routes)])),
    },
    capabilities: {
      collections: resourceList.some((resource) => resource.kind === 'collection'),
      documents: resourceList.some((resource) => resource.kind === 'document'),
      rest: restEnabled,
      writes: restEnabled,
      restBatch: restEnabled,
      graphql: config.graphql?.enabled !== false,
      csvImport: true,
      liveEvents: true,
    },
    collections,
    documents,
    diagnostics: options.diagnostics ?? [],
  };
}

function outputFiles(config, options) {
  const outFile = options.outFile
    ? resolveFrom(config.cwd, options.outFile)
    : config.viewerManifestOutFile;
  return outFile ? [outFile] : [];
}

function resourceBucketManifest(bucket = {}, resources, routes) {
  return Object.fromEntries(Object.entries(bucket).map(([resourceName, manifest]) => {
    const resource = resources.find((candidate) => candidate.name === resourceName);
    if (!resource) {
      return [resourceName, manifest];
    }

    return [resourceName, {
      ...manifest,
      typeName: resource.typeName,
      routePath: resource.routePath,
      api: resourceApi(resource, routes),
      relations: resource.relations ?? [],
    }];
  }));
}

function resourceApi(resource, routes) {
  const route = joinPaths(routes.restBasePath ?? '', resource.routePath);
  if (resource.kind === 'document') {
    return {
      kind: 'document',
      read: route,
      write: route,
    };
  }

  return {
    kind: 'collection',
    list: route,
    record: `${route}/{${resource.idField ?? 'id'}}`,
  };
}

function normalizeViewerRoutes(config, routes = {}) {
  const apiBase = normalizeBasePath(routes.apiBase ?? config.server?.apiBase ?? '/__db');
  const restBasePath = routes.restBasePath === null
    ? ''
    : normalizeBasePath(routes.restBasePath ?? '');

  return {
    apiBase,
    viewerPath: routes.viewerPath ?? apiBase,
    manifestPath: routes.manifestPath ?? `${apiBase}/manifest`,
    manifestJsonPath: routes.manifestJsonPath ?? `${apiBase}/manifest.json`,
    manifestHtmlPath: routes.manifestHtmlPath ?? `${apiBase}/manifest.html`,
    manifestMarkdownPath: routes.manifestMarkdownPath ?? `${apiBase}/manifest.md`,
    schemaPath: routes.schemaPath ?? `${apiBase}/schema`,
    eventsPath: routes.eventsPath ?? `${apiBase}/events`,
    batchPath: routes.batchPath ?? `${apiBase}/batch`,
    importPath: routes.importPath ?? `${apiBase}/import`,
    graphqlPath: routes.graphqlPath ?? config.graphql?.path ?? '/graphql',
    restBasePath,
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

function normalizeBasePath(value) {
  const pathValue = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return pathValue === '/' ? '' : pathValue;
}
