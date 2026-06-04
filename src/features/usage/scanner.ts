import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type UsageSurface =
  | 'client'
  | 'config'
  | 'falcor'
  | 'graphql'
  | 'hono'
  | 'json'
  | 'manifest'
  | 'operations'
  | 'package'
  | 'rest'
  | 'schema'
  | 'stores'
  | 'viewer'
  | 'vite';

export type UsageConfidence = 'high' | 'medium' | 'low';

export type UsageMatch = {
  surface: UsageSurface;
  kind: string;
  file: string;
  line: number;
  snippet: string;
  confidence: UsageConfidence;
};

export type UsageRecommendation = {
  code: string;
  severity: 'info';
  surface: UsageSurface;
  message: string;
  hint: string;
  details: Record<string, unknown>;
};

export type UsageManifest = {
  version: 1;
  kind: 'db.usageManifest';
  generatedAt: string;
  target: {
    path: string;
    kind: 'file' | 'directory';
  };
  summary: {
    filesScanned: number;
    filesWithMatches: number;
    matches: number;
    recommendations: number;
  };
  surfaces: Record<UsageSurface, {
    count: number;
    kinds: Record<string, number>;
  }>;
  recommendations: UsageRecommendation[];
  files: Array<{
    path: string;
    matches: UsageMatch[];
  }>;
};

export type UsageScanOptions = {
  cwd?: string;
  target?: string;
  generatedAt?: string;
  ignorePaths?: string[];
  production?: boolean;
};

const SURFACES: UsageSurface[] = [
  'client',
  'config',
  'falcor',
  'graphql',
  'hono',
  'json',
  'manifest',
  'operations',
  'package',
  'rest',
  'schema',
  'stores',
  'viewer',
  'vite',
];

const IGNORED_DIRS = new Set([
  '.cache',
  '.db',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.tmp',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const IGNORED_FILES = new Set([
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const SCANNABLE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.svelte',
  '.ts',
  '.tsx',
  '.vue',
]);

type FileScan = {
  path: string;
  matches: UsageMatch[];
};

type MatchInput = {
  surface: UsageSurface;
  kind: string;
  file: string;
  line: number;
  snippet: string;
  confidence?: UsageConfidence;
};

export async function scanDbUsage(options: UsageScanOptions = {}): Promise<UsageManifest> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const targetInput = options.target ?? '.';
  const targetPath = path.resolve(cwd, targetInput);
  const ignoredPaths = new Set((options.ignorePaths ?? []).map((filePath) => path.resolve(cwd, filePath)));
  const targetStats = await stat(targetPath);
  const targetKind = targetStats.isDirectory() ? 'directory' : 'file';
  const files = targetKind === 'file'
    ? [targetPath]
    : await collectFiles(targetPath);
  const fileScans: FileScan[] = [];
  let filesScanned = 0;

  for (const filePath of files.sort(comparePaths)) {
    if (ignoredPaths.has(path.resolve(filePath))) {
      continue;
    }
    if (!isScannableFile(filePath)) {
      continue;
    }
    filesScanned += 1;
    const relativePath = relativeProjectPath(cwd, filePath);
    const matches = scanFileContent(await readFile(filePath, 'utf8'), relativePath);
    if (matches.length > 0) {
      fileScans.push({
        path: relativePath,
        matches,
      });
    }
  }

  const matches = fileScans.flatMap((file) => file.matches);
  const surfaces = surfaceSummary(matches);
  const recommendations = options.production === true
    ? usageRecommendations(matches)
    : [];

  return {
    version: 1,
    kind: 'db.usageManifest',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    target: {
      path: relativeProjectPath(cwd, targetPath),
      kind: targetKind,
    },
    summary: {
      filesScanned,
      filesWithMatches: fileScans.length,
      matches: matches.length,
      recommendations: recommendations.length,
    },
    surfaces,
    recommendations,
    files: fileScans,
  };
}

export async function writeUsageManifest(filePath: string, manifest: UsageManifest): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function normalizeUsageManifestForCheck(manifest: UsageManifest): unknown {
  return {
    ...manifest,
    generatedAt: '<generated>',
  };
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        files.push(...await collectFiles(path.join(directory, entry.name)));
      }
      continue;
    }
    if (entry.isFile() && !IGNORED_FILES.has(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function isScannableFile(filePath: string): boolean {
  return SCANNABLE_EXTENSIONS.has(path.extname(filePath));
}

function scanFileContent(content: string, file: string): UsageMatch[] {
  const matches: UsageMatch[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    matches.push(...scanLine(line, file, index + 1));
  });
  matches.push(...scanConfigBlocks(content, file));
  return dedupeMatches(matches);
}

function scanLine(line: string, file: string, lineNumber: number): UsageMatch[] {
  const matches: UsageMatch[] = [];
  const add = (surface: UsageSurface, kind: string, confidence: UsageConfidence = 'high') => {
    matches.push(match({
      surface,
      kind,
      file,
      line: lineNumber,
      snippet: line,
      confidence,
    }));
  };

  if (hasPackageImport(line, '@async/db')) add('package', 'package-import');
  if (hasPackageImport(line, '@async/db/client')) add('client', 'package-import');
  if (hasPackageImport(line, '@async/db/hono')) add('hono', 'package-import');
  if (hasPackageImport(line, '@async/db/vite')) add('vite', 'package-import');
  if (hasPackageImport(line, '@async/db/schema')) add('schema', 'package-import');
  if (hasPackageImport(line, '@async/db/json')) add('json', 'package-import');
  if (hasPackageImport(line, '@async/db/sqlite') || hasPackageImport(line, '@async/db/postgres') || hasPackageImport(line, '@async/db/kv') || hasPackageImport(line, '@async/db/redis')) {
    add('stores', 'package-import');
  }

  if (/\bcreateDbClient\s*\(/.test(line)) add('client', 'create-client-call');
  if (/\.\s*rest\s*\(/.test(line)) add('rest', 'client-rest-call');
  if (/\.\s*graphql\s*\(/.test(line)) add('graphql', 'client-graphql-call');
  if (/\.\s*query\s*\(/.test(line)) add('operations', 'client-query-call');
  if (/\bregisterDbRoutes\s*\(/.test(line)) add('hono', 'register-routes-call');
  if (/\bcreateDbHonoApp\s*\(/.test(line)) add('hono', 'create-hono-app-call');
  if (/\bdbPlugin\s*\(/.test(line)) add('vite', 'vite-plugin-call');

  if (routeLiteral(line, '/__db/operations')) add('operations', 'operation-route');
  if (routeLiteral(line, '/__db/batch')) add('rest', 'batch-route');
  if (routeLiteral(line, '/__db/manifest')) add('manifest', 'manifest-route');
  if (routeLiteral(line, '/__db/schema')) add('schema', 'schema-route');
  if (routeLiteral(line, '/__db')) add('viewer', 'viewer-route', 'medium');
  if (routeLiteral(line, '/graphql')) add('graphql', 'graphql-route');
  if (routeLiteral(line, '/model.json')) add('falcor', 'falcor-route');
  if (routeLiteral(line, '/db')) add('rest', 'rest-route');

  if (/\bkind\s*:\s*['"]graphql['"]/.test(line) || /"kind"\s*:\s*"graphql"/.test(line)) {
    add('operations', 'registered-graphql-operation');
  }

  return matches;
}

function scanConfigBlocks(content: string, file: string): UsageMatch[] {
  const matches: UsageMatch[] = [];
  addConfigBlockMatches(content, file, /\b(rest|graphql|falcor)\s*:\s*\{[\s\S]{0,160}?\benabled\s*:\s*(true|false)/g, (groups) => ({
    surface: groups[1] as UsageSurface,
    kind: `${groups[1]}.enabled:${groups[2]}`,
  }), matches);
  addConfigBlockMatches(content, file, /\boperations\s*:\s*\{[\s\S]{0,220}?\b(enabled|strict)\s*:\s*(true|false)/g, (groups) => ({
    surface: 'operations',
    kind: `operations.${groups[1]}:${groups[2]}`,
  }), matches);
  addConfigBlockMatches(content, file, /\bserver\s*:\s*\{[\s\S]{0,220}?\b(apiBase|dataPath)\s*:/g, (groups) => ({
    surface: 'config',
    kind: `server.${groups[1]}`,
  }), matches);
  addConfigBlockMatches(content, file, /\bexpose\s*:\s*\{[\s\S]{0,260}?\b(rest|graphql|viewer|schema|manifest)\s*:/g, (groups) => ({
    surface: groups[1] as UsageSurface,
    kind: `server.expose.${groups[1]}`,
  }), matches);
  return matches;
}

function addConfigBlockMatches(
  content: string,
  file: string,
  pattern: RegExp,
  describe: (groups: RegExpExecArray) => { surface: UsageSurface; kind: string },
  matches: UsageMatch[],
): void {
  for (const groups of content.matchAll(pattern)) {
    const description = describe(groups);
    const offset = groups.index ?? 0;
    matches.push(match({
      ...description,
      file,
      line: lineForOffset(content, offset),
      snippet: lineAtOffset(content, offset),
      confidence: 'medium',
    }));
    if (description.surface !== 'config') {
      matches.push(match({
        surface: 'config',
        kind: description.kind,
        file,
        line: lineForOffset(content, offset),
        snippet: lineAtOffset(content, offset),
        confidence: 'medium',
      }));
    }
  }
}

function usageRecommendations(matches: UsageMatch[]): UsageRecommendation[] {
  const recommendations: UsageRecommendation[] = [];
  const hasDirectRest = hasAny(matches, 'rest', ['rest-route', 'batch-route', 'client-rest-call']);
  const hasOperations = hasAny(matches, 'operations', ['client-query-call', 'operation-route', 'registered-graphql-operation', 'operations.enabled:true']);
  const hasDirectGraphql = hasAny(matches, 'graphql', ['client-graphql-call', 'graphql-route']);
  const hasRegisteredGraphqlOperations = hasAny(matches, 'operations', ['registered-graphql-operation']);
  const hasFalcor = hasAny(matches, 'falcor', ['falcor-route']);
  const hasDevSurface = (
    hasSurface(matches, 'viewer')
    || hasSurface(matches, 'schema')
    || hasSurface(matches, 'manifest')
  );

  if (!hasDirectRest && hasOperations) {
    recommendations.push(recommendation(
      'USAGE_RECOMMEND_REST_REGISTERED_ONLY',
      'rest',
      'No direct REST usage was detected, but registered operation usage was detected.',
      'Consider server.expose.rest: "registered-only" so public traffic uses registered operations instead of raw REST routes.',
      { suggestedConfig: 'server.expose.rest: "registered-only"' },
    ));
  }

  if (!hasDirectGraphql && !hasRegisteredGraphqlOperations) {
    recommendations.push(recommendation(
      'USAGE_RECOMMEND_GRAPHQL_DISABLED',
      'graphql',
      'No GraphQL usage was detected.',
      'Consider graphql.enabled: false when the app does not use GraphQL.',
      { suggestedConfig: 'graphql.enabled: false' },
    ));
  } else if (!hasDirectGraphql && hasRegisteredGraphqlOperations) {
    recommendations.push(recommendation(
      'USAGE_RECOMMEND_GRAPHQL_EXPOSE_DISABLED',
      'graphql',
      'Registered GraphQL operations were detected without direct GraphQL endpoint usage.',
      'Keep graphql.enabled: true for registered operation execution, and consider server.expose.graphql: false to hide the direct endpoint.',
      { suggestedConfig: 'server.expose.graphql: false' },
    ));
  }

  if (!hasFalcor) {
    recommendations.push(recommendation(
      'USAGE_RECOMMEND_FALCOR_DISABLED',
      'falcor',
      'No Falcor usage was detected.',
      'Consider falcor.enabled: false when the app does not use Falcor.',
      { suggestedConfig: 'falcor.enabled: false' },
    ));
  }

  if (!hasDevSurface) {
    recommendations.push(recommendation(
      'USAGE_RECOMMEND_DEV_SURFACES_PRIVATE',
      'viewer',
      'No app usage of viewer, schema, or manifest routes was detected.',
      'Keep server.expose.viewer, server.expose.schema, and server.expose.manifest set to "dev" or false for production-facing deployments.',
      {
        suggestedConfig: {
          'server.expose.viewer': 'dev or false',
          'server.expose.schema': 'dev or false',
          'server.expose.manifest': 'dev or false',
        },
      },
    ));
  }

  return recommendations;
}

function recommendation(
  code: string,
  surface: UsageSurface,
  message: string,
  hint: string,
  details: Record<string, unknown>,
): UsageRecommendation {
  return {
    code,
    severity: 'info',
    surface,
    message,
    hint,
    details,
  };
}

function surfaceSummary(matches: UsageMatch[]): UsageManifest['surfaces'] {
  const surfaces = Object.fromEntries(SURFACES.map((surface) => [
    surface,
    {
      count: 0,
      kinds: {},
    },
  ])) as UsageManifest['surfaces'];
  for (const usage of matches) {
    surfaces[usage.surface].count += 1;
    surfaces[usage.surface].kinds[usage.kind] = (surfaces[usage.surface].kinds[usage.kind] ?? 0) + 1;
  }
  return surfaces;
}

function hasSurface(matches: UsageMatch[], surface: UsageSurface): boolean {
  return matches.some((usage) => usage.surface === surface);
}

function hasAny(matches: UsageMatch[], surface: UsageSurface, kinds: string[]): boolean {
  return matches.some((usage) => usage.surface === surface && kinds.includes(usage.kind));
}

function hasPackageImport(line: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:from\\s+|import\\s*\\()["']${escaped}["']`).test(line);
}

function routeLiteral(line: string, route: string): boolean {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`["'\`]${escaped}(?:[/?.#"'\`]|$)`).test(line);
}

function match(input: MatchInput): UsageMatch {
  return {
    surface: input.surface,
    kind: input.kind,
    file: input.file,
    line: input.line,
    snippet: input.snippet.trim().replace(/\s+/g, ' ').slice(0, 160),
    confidence: input.confidence ?? 'high',
  };
}

function dedupeMatches(matches: UsageMatch[]): UsageMatch[] {
  const seen = new Set<string>();
  const deduped: UsageMatch[] = [];
  for (const usage of matches) {
    const key = `${usage.surface}\0${usage.kind}\0${usage.file}\0${usage.line}\0${usage.snippet}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(usage);
    }
  }
  return deduped;
}

function lineForOffset(content: string, offset: number): number {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function lineAtOffset(content: string, offset: number): string {
  const start = content.lastIndexOf('\n', offset) + 1;
  const end = content.indexOf('\n', offset);
  return content.slice(start, end === -1 ? content.length : end);
}

function relativeProjectPath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);
  return relative === '' ? '.' : relative.split(path.sep).join('/');
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right);
}
