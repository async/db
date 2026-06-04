import { dbFileSystem, type DbFileSystem } from '../fs/index.js';
import { resolveFrom, writeText } from '../../fs-utils.js';
import { restFormatMetadata } from '../../rest/formats.js';
import { loadProjectSchema } from '../schema/project.js';
import { renderSchemaManifest } from '../schema/manifest.js';

type ViewerConfig = {
  cwd?: string;
  viewerManifestOutFile?: string | null;
  fs?: DbFileSystem;
  rest?: {
    enabled?: boolean;
    formats?: Record<string, string | ((...args: unknown[]) => unknown) | Record<string, unknown> | null | undefined>;
  };
  graphql?: {
    enabled?: boolean;
    path?: string;
  };
  falcor?: {
    enabled?: boolean;
    path?: string;
  };
  server?: {
    apiBase?: string;
    viewerLinks?: unknown[];
  };
  [key: string]: unknown;
};

type ViewerRoutes = {
  apiBase?: string;
  viewerPath?: string;
  manifestPath?: string;
  manifestJsonPath?: string;
  manifestHtmlPath?: string;
  manifestMarkdownPath?: string;
  schemaPath?: string;
  eventsPath?: string;
  logPath?: string;
  batchPath?: string;
  importPath?: string;
  graphqlPath?: string;
  falcorPath?: string;
  restBasePath?: string | null;
  resourceBasePath?: string;
  [key: string]: unknown;
};

type NormalizedViewerRoutes = Required<Pick<
  ViewerRoutes,
  | 'apiBase'
  | 'viewerPath'
  | 'manifestPath'
  | 'manifestJsonPath'
  | 'manifestHtmlPath'
  | 'manifestMarkdownPath'
  | 'schemaPath'
  | 'eventsPath'
  | 'logPath'
  | 'batchPath'
  | 'importPath'
  | 'graphqlPath'
  | 'falcorPath'
>> & {
  restBasePath: string;
  resourceBasePath: string;
};

type ViewerResource = {
  name: string;
  kind: 'collection' | 'document' | string;
  typeName?: string;
  routePath: string;
  idField?: string;
  relations?: unknown[];
  [key: string]: unknown;
};

type SchemaManifestBucket = Record<string, Record<string, unknown>>;

type SchemaManifest = {
  collections?: SchemaManifestBucket;
  documents?: SchemaManifestBucket;
  [key: string]: unknown;
};

type ViewerProject = {
  resources: ViewerResource[];
  diagnostics: unknown[];
};

type GenerateViewerManifestOptions = {
  project?: unknown;
  outFile?: string;
  generatedAt?: string;
  routes?: ViewerRoutes;
};

type RenderViewerManifestOptions = {
  generatedAt?: string;
  routes?: ViewerRoutes;
  diagnostics?: unknown[];
};

type ViewerLink = {
  label: string;
  href: string;
  source: 'built-in' | 'custom';
};

export async function generateViewerManifest(config: ViewerConfig, options: GenerateViewerManifestOptions = {}) {
  const project = (options.project ?? await loadProjectSchema(config)) as ViewerProject;
  const manifest = renderViewerManifest(project.resources, config, {
    diagnostics: project.diagnostics,
    generatedAt: options.generatedAt,
    routes: options.routes,
  });
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const outFiles = outputFiles(config, options);

  for (const outFile of outFiles) {
    await writeText(outFile, content, dbFileSystem(config));
  }

  return {
    manifest,
    content,
    outFiles,
    diagnostics: project.diagnostics,
  };
}

export function renderViewerManifest(
  resources: ViewerResource[],
  config: ViewerConfig = {},
  options: RenderViewerManifestOptions = {},
) {
  const schemaManifest = renderSchemaManifest(resources as never, config as never) as SchemaManifest;
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
      log: routes.logPath,
      batch: routes.batchPath,
      import: routes.importPath,
      graphql: routes.graphqlPath,
      falcor: routes.falcorPath,
      restBasePath: routes.restBasePath ?? '',
      resourceBasePath: routes.resourceBasePath,
      resources: Object.fromEntries(resourceList.map((resource) => [resource.name, resourceApi(resource, routes)])),
    },
    capabilities: {
      collections: resourceList.some((resource) => resource.kind === 'collection'),
      documents: resourceList.some((resource) => resource.kind === 'document'),
      rest: restEnabled,
      writes: restEnabled,
      restBatch: restEnabled,
      graphql: config.graphql?.enabled !== false,
      falcor: config.falcor?.enabled !== false,
      csvImport: true,
      liveEvents: true,
    },
    collections,
    documents,
    diagnostics: options.diagnostics ?? [],
  };
}

function outputFiles(config: ViewerConfig, options: GenerateViewerManifestOptions): string[] {
  const outFile = options.outFile
    ? resolveFrom(config.cwd ?? '.', options.outFile)
    : config.viewerManifestOutFile;
  return outFile ? [outFile] : [];
}

function resourceBucketManifest(
  bucket: SchemaManifestBucket = {},
  resources: ViewerResource[],
  routes: NormalizedViewerRoutes,
): Record<string, Record<string, unknown>> {
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

function resourceApi(resource: ViewerResource, routes: NormalizedViewerRoutes): Record<string, unknown> {
  const route = joinPaths(routes.restBasePath ?? '', resource.routePath);
  const canonicalRoute = joinPaths(routes.resourceBasePath, resource.routePath);
  if (resource.kind === 'document') {
    return {
      kind: 'document',
      read: route,
      write: route,
      canonical: canonicalRoute,
    };
  }

  return {
    kind: 'collection',
    list: route,
    record: `${route}/{${resource.idField ?? 'id'}}`,
    canonicalList: canonicalRoute,
    canonicalRecord: `${canonicalRoute}/{${resource.idField ?? 'id'}}`,
  };
}

function normalizeViewerRoutes(config: ViewerConfig, routes: ViewerRoutes = {}): NormalizedViewerRoutes {
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
    logPath: routes.logPath ?? `${apiBase}/log`,
    batchPath: routes.batchPath ?? `${apiBase}/batch`,
    importPath: routes.importPath ?? `${apiBase}/import`,
    graphqlPath: routes.graphqlPath ?? config.graphql?.path ?? '/graphql',
    falcorPath: routes.falcorPath ?? config.falcor?.path ?? '/model.json',
    restBasePath,
    resourceBasePath: normalizeBasePath(routes.resourceBasePath ?? '/resources'),
  };
}

function viewerLinks(config: ViewerConfig, viewerPath: string): ViewerLink[] {
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
  if (!isRecord(link)) {
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

function joinPaths(basePath: string, routePath: string): string {
  if (!basePath) {
    return routePath;
  }

  const base = `/${String(basePath).replace(/^\/+/, '').replace(/\/+$/, '')}`;
  const route = `/${String(routePath || '/').replace(/^\/+/, '')}`;
  return `${base}${route === '/' ? '' : route}`;
}

function normalizeBasePath(value: unknown): string {
  const pathValue = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return pathValue === '/' ? '' : pathValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
