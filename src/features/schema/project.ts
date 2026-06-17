import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseJsonc } from '../../jsonc.js';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';
import { buildResource } from './resource.js';
import { duplicateResourceDiagnostics, listSourceFiles, readRootSchemaFile, readSourceFile, trackResourceSource } from './sources.js';
import { makeGeneratedSchema } from './generated.js';
import { resourceAliasCollisionGroups } from '../../names.js';
import { validateProjectRelations } from './relations.js';
import { validateResourceSeed } from './validation.js';
import { normalizeSchemaLoadMode } from './locator.js';
import {
  isGitSource,
  normalizeResourceSource,
  type GitFilesSourceDefinition,
} from './source-definitions.js';
import { disallowedComponents, scanMdxBody, type MdxScan } from './mdx-scan.js';

type SchemaDiagnostic = {
  code: string;
  severity: 'error' | 'warn' | 'info';
  resource?: string;
  field?: string;
  file?: string;
  message: string;
  hint?: string;
  details?: unknown;
  [key: string]: unknown;
};

type SchemaLoadMode = 'data' | 'schema' | 'runtime' | string;

type SchemaLocator = {
  mode?: string;
  file?: string;
  [key: string]: unknown;
};

type ProjectConfig = {
  cwd?: string;
  sourceDir?: string;
  schemaLoadMode?: SchemaLoadMode;
  schemaLocator?: SchemaLocator | null;
  schema?: {
    source?: string;
    unknownFields?: string;
    [key: string]: unknown;
  };
  fs?: DbFileSystem;
  git?: {
    remotes?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type RawSchema = {
  source?: Parameters<typeof normalizeResourceSource>[0];
  parser?: string;
  seed?: unknown;
  store?: unknown;
  [key: string]: unknown;
};

type SourceRecord = {
  kind: 'data' | 'schema';
  name: string;
  file: string;
  sourceFile: string;
  format?: string;
  hash?: string;
  data?: unknown;
  schema?: RawSchema;
  baseDir?: string;
  /** Resolved content roots for files() globs; serve watches these for hot reload. */
  watchRoots?: string[];
};

type SourceReadResult = {
  sources: SourceRecord[];
  diagnostics: SchemaDiagnostic[];
};

type RootSchemaReadResult = SourceReadResult & {
  found: boolean;
  file: string | null;
};

type ResourceSourceMap = Map<string, unknown>;

type ProjectResource = ReturnType<typeof buildResource>;

type ProjectResult = {
  resources: ProjectResource[];
  diagnostics: SchemaDiagnostic[];
  schema: unknown;
  loadMode: SchemaLoadMode;
  locator: SchemaLocator | null;
  rootSchema: {
    found: boolean;
    file: string | null;
  };
};

type ContentDataSourceResult = {
  source: SourceRecord | null;
  diagnostics: SchemaDiagnostic[];
};

type GitRemoteDefinition = {
  kind?: string;
  type?: string;
  repo?: string;
  branch?: string;
  mode?: string;
  baseUrl?: string;
  token?: string;
  tokenEnv?: string;
  client?: {
    getTreeSnapshot?: (context: GitSnapshotContext) => unknown | Promise<unknown>;
    [key: string]: unknown;
  };
  snapshot?: unknown;
  [key: string]: unknown;
};

type GitSnapshotContext = {
  remote: GitRemoteDefinition;
  source: GitFilesSourceDefinition;
  resourceName: string;
  paths: string[];
};

type GitSnapshotFile = {
  path: string;
  content?: string;
  text?: string;
  sha?: string;
  encoding?: string;
};

type ParseContentOptions = {
  id?: string;
  idField?: string;
  bodyField?: string;
};

export async function loadProjectSchema(config: ProjectConfig, options: { load?: SchemaLoadMode } = {}): Promise<ProjectResult> {
  const loadMode = normalizeSchemaLoadMode(options.load ?? config.schemaLoadMode ?? 'data');
  const rootSchema = await readRootSchemaFile(config) as RootSchemaReadResult;
  const files = await sourceFilesForLoadMode(config, rootSchema, loadMode);
  const dataFiles = new Map<string, SourceRecord>();
  const schemaFiles = new Map<string, SourceRecord>();
  const resourceSources: ResourceSourceMap = new Map();
  const diagnostics: SchemaDiagnostic[] = [...rootSchema.diagnostics];

  for (const source of rootSchema.sources) {
    trackResourceSource(resourceSources, source.name, source.file, source.kind);
    schemaFiles.set(source.name, source);
  }

  for (const filename of files) {
    if (rootSchema.found && isSchemaSourceFilename(filename)) {
      continue;
    }

    const result = await readSourceFile(config, filename) as SourceReadResult;
    diagnostics.push(...result.diagnostics);

    for (const source of result.sources) {
      trackResourceSource(resourceSources, source.name, source.file, source.kind);
      if (source.kind === 'schema') {
        schemaFiles.set(source.name, source);
      } else {
        dataFiles.set(source.name, source);
      }
    }
  }

  for (const source of schemaFiles.values()) {
    if (config.schema?.source !== 'schema' && !dataFiles.has(source.name) && source.schema?.source) {
      if (loadMode === 'schema') {
        continue;
      }
      const contentSource = await contentDataSourceForSchema(config, source);
      diagnostics.push(...contentSource.diagnostics);
      if (contentSource.source) {
        dataFiles.set(source.name, contentSource.source);
      }
    }
  }

  const resourceNames = [...new Set([...dataFiles.keys(), ...schemaFiles.keys()])].sort();
  const resources: ProjectResource[] = [];
  diagnostics.push(...duplicateResourceDiagnostics(resourceSources));

  for (const name of resourceNames) {
    const dataSource = dataFiles.get(name);
    const schemaSource = schemaFiles.get(name);
    const rawData = dataSource?.data;
    const rawSchema = schemaSource?.schema;

    if (rawData === undefined && rawSchema === undefined) {
      continue;
    }

    if (rawData !== undefined && rawSchema && Object.prototype.hasOwnProperty.call(rawSchema, 'seed')) {
      diagnostics.push(mixedModeSchemaSeedDiagnostic(name, dataSource, schemaSource));
    }

    if (schemaSource && isFolderSchemaMarker(schemaSource) && !rawSchema?.source) {
      diagnostics.push(folderSourceRequiredDiagnostic(name, schemaSource));
    }

    if (rawSchema?.store) {
      diagnostics.push(schemaStoreIgnoredDiagnostic(name, schemaSource));
    }

    if (rawSchema?.parser) {
      diagnostics.push(schemaParserDeprecatedDiagnostic(name, schemaSource));
    }

    const resource = buildResource({
      name,
      dataPath: dataSource?.sourceFile,
      dataFormat: dataSource?.format,
      dataHash: dataSource?.hash,
      schemaPath: schemaSource?.sourceFile,
      schemaSource: schemaSource?.format,
      rawData,
      rawSchema: dataSource?.format === 'mdx' ? withMdxScanFields(rawSchema) : rawSchema,
      config,
      includeSeed: loadMode !== 'schema',
    });

    if (dataSource?.watchRoots?.length) {
      (resource as { watchRoots?: string[] }).watchRoots = dataSource.watchRoots;
    }

    if (loadMode !== 'schema') {
      diagnostics.push(...validateResourceSeed(resource as never, config as never));
    }
    diagnostics.push(...(resource.diagnostics ?? []));
    resources.push(resource);
  }

  diagnostics.push(...validateProjectRelations(resources as never));
  diagnostics.push(...resourceAliasCollisionDiagnostics(resources));

  return {
    resources,
    diagnostics,
    schema: makeGeneratedSchema(resources as never, diagnostics as never),
    loadMode,
    locator: config.schemaLocator ?? null,
    rootSchema: {
      found: rootSchema.found,
      file: rootSchema.file,
    },
  };
}

function isSchemaSourceFilename(filename: string): boolean {
  return filename.endsWith('.schema.json') || filename.endsWith('.schema.jsonc') || filename.endsWith('.schema.mjs') || filename.endsWith('.schema.js');
}

async function sourceFilesForLoadMode(config: ProjectConfig, rootSchema: RootSchemaReadResult, loadMode: SchemaLoadMode): Promise<string[]> {
  const locator = config.schemaLocator;
  if (locator?.mode === 'schema-file') {
    return singleSchemaFileSources(config, locator, loadMode);
  }

  const files = await listSourceFiles(config) as string[];
  if (loadMode === 'schema') {
    return files.filter(isSchemaSourceFilename);
  }

  return files;
}

async function singleSchemaFileSources(config: ProjectConfig, locator: SchemaLocator, loadMode: SchemaLoadMode): Promise<string[]> {
  const files = await listSourceFiles(config) as string[];
  const schemaFile = path.relative(config.sourceDir ?? '', locator.file);
  const normalizedSchemaFile = schemaFile.split(path.sep).join('/');
  const available = new Set(files.map((file) => file.split(path.sep).join('/')));
  const selected = available.has(normalizedSchemaFile) ? [normalizedSchemaFile] : [];

  if (loadMode === 'schema') {
    return selected;
  }

  for (const dataFile of siblingDataFilesForSchema(normalizedSchemaFile)) {
    if (available.has(dataFile)) {
      selected.push(dataFile);
    }
  }
  return selected;
}

function siblingDataFilesForSchema(schemaFile: string): string[] {
  const base = schemaFile.replace(/\.schema\.(?:json|jsonc|mjs|js)$/i, '');
  return [`${base}.json`, `${base}.jsonc`, `${base}.csv`];
}

function isFolderSchemaMarker(schemaSource: SourceRecord): boolean {
  const file = schemaSource.file.split(path.sep).join('/');
  return file.endsWith('/index.schema.mjs') || file.endsWith('/index.schema.js');
}

async function contentDataSourceForSchema(config: ProjectConfig, schemaSource: SourceRecord): Promise<ContentDataSourceResult> {
  const source = normalizeResourceSource(schemaSource.schema?.source, { read: schemaSource.schema?.parser });
  if (isGitSource(source)) {
    return gitContentDataSourceForSchema(config, schemaSource, source);
  }
  if (!source) {
    return {
      source: null,
      diagnostics: [],
    };
  }

  const baseDir = schemaSource.baseDir ?? path.dirname(schemaSource.sourceFile);
  const files: string[] = [];
  const diagnostics: SchemaDiagnostic[] = [];

  const watchRoots = new Set<string>();
  for (const pattern of source?.patterns ?? []) {
    const matched = await filesMatchingGlob(config, baseDir, String(pattern));
    files.push(...matched);
    // Record the resolved glob root so serve can watch content that lives
    // outside the data folder (for example files('../docs/**/*.md')).
    const staticParts: string[] = [];
    for (const part of String(pattern).split('/')) {
      if (part.includes('*')) {
        break;
      }
      staticParts.push(part);
    }
    // A trailing filename (no glob) belongs to the file, not the root.
    if (staticParts.length > 0 && /\.[A-Za-z0-9]+$/.test(staticParts[staticParts.length - 1])) {
      staticParts.pop();
    }
    watchRoots.add(path.resolve(baseDir, staticParts.join('/') || '.'));
  }

  if (source?.components && source.read !== 'mdx') {
    diagnostics.push(componentsIgnoredDiagnostic(schemaSource, source.read));
  }

  const uniqueFiles = [...new Set(files)].sort();
  const records = [];
  const hash = createHash('sha256');
  for (const filePath of uniqueFiles) {
    let text;
    try {
      text = await dbFileSystem(config).readFile(filePath, 'utf8') as string;
    } catch (error) {
      diagnostics.push(contentLoadDiagnostic(config, schemaSource, filePath, error));
      continue;
    }

    hash.update(filePath);
    hash.update('\0');
    hash.update(text);
    try {
      if (source.read === 'mdx') {
        const { record, scan } = mdxContentRecord(filePath, text);
        records.push(record);
        diagnostics.push(...mdxComponentDiagnostics(config, schemaSource, filePath, scan, source.components));
      } else {
        records.push(parseContentRecord(schemaSource, filePath, text, source.read));
      }
    } catch (error) {
      diagnostics.push(contentLoadDiagnostic(config, schemaSource, filePath, error));
    }
  }

  return {
    source: {
      kind: 'data',
      name: schemaSource.name,
      file: schemaSource.file,
      sourceFile: schemaSource.sourceFile,
      format: source?.read ?? 'frontmatter',
      hash: hash.digest('hex'),
      data: records,
      baseDir,
      watchRoots: [...watchRoots],
    },
    diagnostics,
  };
}

async function gitContentDataSourceForSchema(
  config: ProjectConfig,
  schemaSource: SourceRecord,
  source: GitFilesSourceDefinition,
): Promise<ContentDataSourceResult> {
  const diagnostics: SchemaDiagnostic[] = [];
  if (!source.remote) {
    return {
      source: null,
      diagnostics: [gitSourceDiagnostic(
        'GIT_SOURCE_REMOTE_REQUIRED',
        schemaSource,
        'Git-backed sources must reference a remote alias.',
        'Pass remote: "name" to gitFiles(), gitFile(), or gitCollectionFile(), and configure git.remotes.name in db.config.js.',
        { source: safeGitSourceMetadata(source) },
      )],
    };
  }

  const remote = remoteForGitSource(config, schemaSource, source);
  if (!remote.remote) {
    return {
      source: null,
      diagnostics: [remote.diagnostic],
    };
  }

  if (source.components && source.read !== 'mdx') {
    diagnostics.push(componentsIgnoredDiagnostic(schemaSource, source.read));
  }

  let snapshot;
  try {
    snapshot = await gitSnapshot(config, schemaSource, source, remote.remote);
  } catch (error) {
    return {
      source: null,
      diagnostics: [gitSourceDiagnostic(
        'GIT_SOURCE_SNAPSHOT_FAILED',
        schemaSource,
        `Could not read Git source "${source.remote}" for "${schemaSource.name}": ${error instanceof Error ? error.message : String(error)}`,
        'Check the configured GitHub remote, token mode, injected client, or @async/github-app bridge.',
        {
          resource: schemaSource.name,
          remote: source.remote,
          source: safeGitSourceMetadata(source),
        },
      )],
    };
  }

  const matched = snapshot
    .map((file) => normalizeGitSnapshotFile(file))
    .filter((file): file is GitSnapshotFile & { path: string; text: string } => Boolean(file))
    .map((file) => ({ file, match: matchGitSourcePath(file.path, source) }))
    .filter((entry) => entry.match.matched)
    .sort((left, right) => left.file.path.localeCompare(right.file.path));

  const hash = createHash('sha256');
  const records: unknown[] = [];
  const idField = String(schemaSource.schema?.idField ?? source.idField ?? 'id');
  const bodyField = source.bodyField ?? 'body';

  for (const { file, match } of matched) {
    const unsafe = unsafeGitPathReason(file.path);
    if (unsafe) {
      diagnostics.push(gitSourceDiagnostic(
        'GIT_SOURCE_UNSAFE_PATH',
        schemaSource,
        `Git source "${source.remote}" returned unsafe path "${file.path}".`,
        unsafe,
        { resource: schemaSource.name, remote: source.remote, path: file.path },
      ));
      continue;
    }

    hash.update(file.path);
    hash.update('\0');
    hash.update(file.sha ?? file.text);
    try {
      const recordId = String(match.params[idField] ?? match.params.id ?? match.params.slug ?? basenameId(file.path));
      const parseOptions = source.shape === 'files'
        ? { id: recordId, idField, bodyField }
        : { bodyField };
      if (source.read === 'mdx') {
        const { record, scan } = mdxContentRecord(file.path, file.text, parseOptions);
        records.push(record);
        diagnostics.push(...mdxComponentDiagnostics(config, schemaSource, file.path, scan, source.components));
      } else {
        records.push(parseContentRecord(schemaSource, file.path, file.text, source.read, parseOptions));
      }
    } catch (error) {
      diagnostics.push(contentLoadDiagnostic(config, schemaSource, file.path, error));
    }
  }

  const data = source.shape === 'collection-file'
    ? collectionDataFromGitFile(records, schemaSource, source, diagnostics)
    : source.shape === 'file'
      ? documentDataFromGitFile(records)
      : records;

  return {
    source: {
      kind: 'data',
      name: schemaSource.name,
      file: schemaSource.file,
      sourceFile: gitSourceFileLabel(source),
      format: source.read,
      hash: hash.digest('hex'),
      data,
      baseDir: schemaSource.baseDir ?? path.dirname(schemaSource.sourceFile),
      watchRoots: [],
    },
    diagnostics,
  };
}

function remoteForGitSource(
  config: ProjectConfig,
  schemaSource: SourceRecord,
  source: GitFilesSourceDefinition,
): { remote: GitRemoteDefinition | null; diagnostic: SchemaDiagnostic } {
  const remotes = config.git?.remotes;
  const remote = remotes?.[source.remote] as GitRemoteDefinition | undefined;
  if (!remote) {
    return {
      remote: null,
      diagnostic: gitSourceDiagnostic(
        'GIT_REMOTE_NOT_FOUND',
        schemaSource,
        `Git source "${schemaSource.name}" references missing remote "${source.remote}".`,
        `Configure git.remotes.${source.remote} in db.config.js, or change the source remote alias.`,
        {
          resource: schemaSource.name,
          remote: source.remote,
          availableRemotes: Object.keys(remotes ?? {}),
          source: safeGitSourceMetadata(source),
        },
      ),
    };
  }

  return {
    remote,
    diagnostic: gitSourceDiagnostic('GIT_REMOTE_NOT_FOUND', schemaSource, '', ''),
  };
}

async function gitSnapshot(
  config: ProjectConfig,
  schemaSource: SourceRecord,
  source: GitFilesSourceDefinition,
  remote: GitRemoteDefinition,
): Promise<GitSnapshotFile[]> {
  const context: GitSnapshotContext = {
    remote,
    source,
    resourceName: schemaSource.name,
    paths: source.patterns,
  };

  if (Array.isArray(remote.snapshot)) {
    return remote.snapshot as GitSnapshotFile[];
  }
  if (typeof remote.snapshot === 'function') {
    return await remote.snapshot(context) as GitSnapshotFile[];
  }
  if (typeof remote.client?.getTreeSnapshot === 'function') {
    return await remote.client.getTreeSnapshot(context) as GitSnapshotFile[];
  }

  if ((remote.kind ?? remote.type) === 'github') {
    return githubRestTreeSnapshot(config, source, remote);
  }

  throw new Error(`Unsupported git remote type "${String(remote.kind ?? remote.type ?? 'unknown')}". GitHub is the only built-in remote type in this slice.`);
}

async function githubRestTreeSnapshot(
  config: ProjectConfig,
  source: GitFilesSourceDefinition,
  remote: GitRemoteDefinition,
): Promise<GitSnapshotFile[]> {
  const mode = remote.mode ?? 'app';
  if (mode !== 'token') {
    throw new Error(`GitHub remote mode "${mode}" needs an @async/github-app client, Actions bridge snapshot, or token mode reader.`);
  }
  if (!remote.repo || typeof remote.repo !== 'string') {
    throw new Error('githubRemote() requires repo: "owner/name".');
  }

  const repo = parseGithubRepo(remote.repo);
  const headers = githubHeaders(remote);
  const baseUrl = githubApiBaseUrl(remote.baseUrl);
  const branch = encodeURIComponent(remote.branch ?? 'main');
  const treeUrl = `${baseUrl}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/git/trees/${branch}?recursive=1`;
  const tree = await githubFetchJson(treeUrl, headers) as { tree?: Array<{ path?: string; type?: string; sha?: string }> };
  const entries = Array.isArray(tree.tree) ? tree.tree : [];
  const blobs = entries
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string' && typeof entry.sha === 'string')
    .filter((entry) => matchGitSourcePath(entry.path as string, source).matched)
    .sort((left, right) => String(left.path).localeCompare(String(right.path)));

  const files: GitSnapshotFile[] = [];
  for (const blob of blobs) {
    const blobUrl = `${baseUrl}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/git/blobs/${encodeURIComponent(String(blob.sha))}`;
    const data = await githubFetchJson(blobUrl, headers) as { content?: string; encoding?: string; sha?: string };
    files.push({
      path: String(blob.path),
      content: data.content,
      encoding: data.encoding,
      sha: data.sha ?? blob.sha,
    });
  }
  return files;
}

function parseGithubRepo(repo: string): { owner: string; name: string } {
  const [owner, name, extra] = repo.split('/');
  if (!owner || !name || extra) {
    throw new Error('GitHub repo must use "owner/name" format.');
  }
  return { owner, name };
}

function githubApiBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
}

function githubHeaders(remote: GitRemoteDefinition): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': '@async/db git source',
    'x-github-api-version': '2022-11-28',
  };
  const token = githubToken(remote);
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

function githubToken(remote: GitRemoteDefinition): string | undefined {
  if (typeof remote.token === 'string' && remote.token.length > 0) {
    return remote.token;
  }
  if (typeof remote.tokenEnv === 'string' && remote.tokenEnv.length > 0) {
    return process.env[remote.tokenEnv];
  }
  return undefined;
}

async function githubFetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text();
    const message = body ? `: ${body.slice(0, 300)}` : '';
    throw new Error(`GitHub API request failed with ${response.status} ${response.statusText}${message}`);
  }
  return response.json();
}

function normalizeGitSnapshotFile(value: unknown): GitSnapshotFile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const file = value as GitSnapshotFile;
  if (typeof file.path !== 'string') {
    return null;
  }
  const text = typeof file.text === 'string'
    ? file.text
    : typeof file.content === 'string'
      ? decodeGitSnapshotContent(file.content, file.encoding)
      : undefined;
  if (typeof text !== 'string') {
    return null;
  }
  return {
    path: normalizeSlash(file.path).replace(/^\.\//, ''),
    text,
    sha: typeof file.sha === 'string' ? file.sha : undefined,
  };
}

function decodeGitSnapshotContent(content: string, encoding: string | undefined): string {
  if (encoding === 'base64') {
    return Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf8');
  }
  return content;
}

function matchGitSourcePath(filePath: string, source: GitFilesSourceDefinition): { matched: boolean; params: Record<string, string> } {
  const normalizedPath = normalizeSlash(filePath).replace(/^\.\//, '');
  for (const pattern of source.patterns) {
    const match = gitPatternRegExp(pattern).exec(normalizedPath);
    if (match) {
      return {
        matched: true,
        params: match.groups ?? {},
      };
    }
  }
  return { matched: false, params: {} };
}

function gitPatternRegExp(pattern: string): RegExp {
  let source = '^';
  const normalized = normalizeSlash(pattern).replace(/^\.\//, '');
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '{') {
      const close = normalized.indexOf('}', index + 1);
      if (close > index + 1) {
        const name = normalized.slice(index + 1, close);
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
          source += `(?<${name}>[^/]+)`;
          index = close;
          continue;
        }
      }
    }
    if (char === '*' && next === '*') {
      if (normalized[index + 2] === '/') {
        source += '(?:.*\\/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegExp(char);
  }
  source += '$';
  return new RegExp(source);
}

function unsafeGitPathReason(filePath: string): string | null {
  const normalized = normalizeSlash(filePath);
  if (path.isAbsolute(filePath) || normalized.startsWith('/')) {
    return 'Git source paths must be repository-relative, not absolute.';
  }
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return 'Git source paths must not contain ".." path traversal segments.';
  }
  if (normalized === '.github/workflows' || normalized.startsWith('.github/workflows/')) {
    return 'Git source paths under .github/workflows are reserved for repository automation and are not content sources.';
  }
  return null;
}

function collectionDataFromGitFile(
  records: unknown[],
  schemaSource: SourceRecord,
  source: GitFilesSourceDefinition,
  diagnostics: SchemaDiagnostic[],
): unknown[] {
  if (records.length === 0) {
    return [];
  }
  const value = records[0];
  if (Array.isArray(value)) {
    return value;
  }
  diagnostics.push(gitSourceDiagnostic(
    'GIT_COLLECTION_FILE_INVALID',
    schemaSource,
    `Git collection file for "${schemaSource.name}" must parse to a JSON array.`,
    'Use gitFiles() for one-record-per-file collections, or make the collection file contain an array.',
    { resource: schemaSource.name, remote: source.remote, source: safeGitSourceMetadata(source) },
  ));
  return [];
}

function documentDataFromGitFile(records: unknown[]): unknown {
  return records[0] ?? {};
}

function gitSourceFileLabel(source: GitFilesSourceDefinition): string {
  return `git://${source.remote}/${source.patterns.join(',')}`;
}

function safeGitSourceMetadata(source: GitFilesSourceDefinition): Record<string, unknown> {
  return {
    kind: source.kind,
    shape: source.shape,
    remote: source.remote,
    patterns: [...source.patterns],
    read: source.read,
    bodyField: source.bodyField,
    idField: source.idField,
    allowJsoncWrites: source.allowJsoncWrites === true ? true : undefined,
  };
}

function gitSourceDiagnostic(
  code: string,
  schemaSource: SourceRecord,
  message: string,
  hint: string,
  details: Record<string, unknown> = {},
): SchemaDiagnostic {
  return {
    code,
    severity: 'error',
    resource: schemaSource.name,
    file: schemaSource.file,
    message,
    hint,
    details: {
      resource: schemaSource.name,
      ...details,
    },
  };
}

async function filesMatchingGlob(config: ProjectConfig, baseDir: string, pattern: string): Promise<string[]> {
  const normalizedPattern = normalizeSlash(pattern).replace(/^\.\//, '');
  const firstGlob = firstGlobIndex(normalizedPattern);
  const rootPart = firstGlob === -1
    ? path.dirname(normalizedPattern)
    : normalizedPattern.slice(0, firstGlob).split('/').slice(0, -1).join('/');
  const searchRoot = path.resolve(baseDir, rootPart || '.');
  const allFiles = await listFilesRecursive(config, searchRoot);
  const regexp = globRegExp(normalizedPattern);

  return allFiles.filter((filePath) => {
    const relative = normalizeSlash(path.relative(baseDir, filePath));
    return regexp.test(relative) || regexp.test(`./${relative}`);
  });
}

async function listFilesRecursive(config: ProjectConfig, directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await dbFileSystem(config).readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(config, fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function firstGlobIndex(pattern: string): number {
  const indexes = ['*', '?', '[', '{']
    .map((token) => pattern.indexOf(token))
    .filter((index) => index >= 0);
  return indexes.length === 0 ? -1 : Math.min(...indexes);
}

function globRegExp(pattern: string): RegExp {
  let source = '^';
  const normalized = normalizeSlash(pattern);
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '*' && next === '*') {
      if (normalized[index + 2] === '/') {
        source += '(?:.*\\/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegExp(char);
  }
  source += '$';
  return new RegExp(source);
}

function parseContentRecord(
  schemaSource: SourceRecord,
  filePath: string,
  text: string,
  read = 'frontmatter',
  options: ParseContentOptions = {},
): unknown {
  if (read === 'json') {
    return withRecordIdentity(JSON.parse(text), filePath, options);
  }
  if (read === 'jsonc') {
    return withRecordIdentity(parseJsonc(text, filePath), filePath, options);
  }
  if (read === 'text') {
    return {
      [options.idField ?? 'id']: options.id ?? basenameId(filePath),
      [options.bodyField ?? 'body']: text,
    };
  }
  return frontmatterRecord(filePath, text, options);
}

function withRecordIdentity(value: unknown, filePath: string, options: ParseContentOptions): unknown {
  if (!options.id && !options.idField) {
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const idField = options.idField ?? 'id';
  const record = value as Record<string, unknown>;
  if (record[idField] !== undefined) {
    return record;
  }
  return {
    [idField]: options.id ?? basenameId(filePath),
    ...record,
  };
}

function frontmatterRecord(filePath: string, text: string, options: ParseContentOptions = {}): Record<string, unknown> {
  const { data, body } = parseFrontmatter(text);
  const idField = options.idField ?? 'id';
  const bodyField = options.bodyField ?? 'body';
  return {
    [idField]: data[idField] ?? options.id ?? data.id ?? basenameId(filePath),
    ...data,
    [bodyField]: body.trim(),
  };
}

function mdxContentRecord(
  filePath: string,
  text: string,
  options: ParseContentOptions = {},
): { record: Record<string, unknown>; scan: MdxScan } {
  const { data, body } = parseFrontmatter(text);
  const scan = scanMdxBody(body);
  const idField = options.idField ?? 'id';
  const bodyField = options.bodyField ?? 'body';
  return {
    record: {
      [idField]: data[idField] ?? options.id ?? data.id ?? basenameId(filePath),
      ...data,
      [bodyField]: body.trim(),
      components: scan.components,
      imports: scan.imports,
      exports: scan.exports,
    },
    scan,
  };
}

function mdxComponentDiagnostics(
  config: ProjectConfig,
  schemaSource: SourceRecord,
  filePath: string,
  scan: MdxScan,
  allowed: readonly string[] | undefined,
): SchemaDiagnostic[] {
  if (!Array.isArray(allowed)) {
    return [];
  }

  const disallowed = disallowedComponents(scan, allowed);
  if (disallowed.length === 0) {
    return [];
  }

  const relative = displayContentPath(config, filePath);
  const used = disallowed.map((name) => `<${name}>`).join(', ');
  const registered = allowed.length > 0 ? allowed.join(', ') : '(none)';
  return [{
    code: 'CONTENT_COMPONENT_NOT_ALLOWED',
    severity: 'error',
    resource: schemaSource.name,
    file: relative,
    message: `${relative} uses ${used} but the schema's components list only allows: ${registered}.`,
    hint: `Add the component to files(..., { components: [...] }) in ${schemaSource.file}, or remove the JSX from this doc. Components the doc imports or exports itself are allowed automatically.`,
    details: {
      resource: schemaSource.name,
      path: relative,
      components: disallowed,
      allowed: [...allowed],
    },
  }];
}

function componentsIgnoredDiagnostic(schemaSource: SourceRecord, read: string): SchemaDiagnostic {
  return {
    code: 'CONTENT_COMPONENTS_IGNORED',
    severity: 'warn',
    resource: schemaSource.name,
    file: schemaSource.file,
    message: `${schemaSource.name} declares a components list but read is '${read}'; component checking only runs with read: 'mdx'.`,
    hint: `Switch the files() source to read: 'mdx' to validate component usage, or drop the components list.`,
    details: {
      resource: schemaSource.name,
      read,
    },
  };
}

const MDX_SCAN_FIELDS: Record<string, { type: string; items: { type: string }; description: string }> = {
  components: {
    type: 'array',
    items: { type: 'string' },
    description: 'Capitalized JSX tags used in the body (scanned at sync; read: mdx).',
  },
  imports: {
    type: 'array',
    items: { type: 'string' },
    description: 'Module specifiers imported by the doc (scanned at sync; read: mdx).',
  },
  exports: {
    type: 'array',
    items: { type: 'string' },
    description: 'Top-level names exported by the doc (scanned at sync; read: mdx).',
  },
};

/**
 * read: 'mdx' always emits components/imports/exports on every record, so a
 * schema that declares fields gets those fields declared too -- keeping
 * unknown-field warnings away and putting the scan results into generated
 * types and the viewer's schema panel.
 */
function withMdxScanFields<T>(rawSchema: T): T {
  if (!rawSchema || typeof rawSchema !== 'object') {
    return rawSchema;
  }
  const schema = rawSchema as { fields?: Record<string, unknown> };
  if (!schema.fields || typeof schema.fields !== 'object') {
    return rawSchema;
  }
  const missing = Object.keys(MDX_SCAN_FIELDS).filter((name) => !(name in (schema.fields as Record<string, unknown>)));
  if (missing.length === 0) {
    return rawSchema;
  }
  return {
    ...schema,
    fields: {
      ...schema.fields,
      ...Object.fromEntries(missing.map((name) => [name, { ...MDX_SCAN_FIELDS[name] }])),
    },
  } as T;
}

function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  if (!text.startsWith('---')) {
    return {
      data: {},
      body: text,
    };
  }

  const lines = text.split(/\r?\n/);
  const closeIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closeIndex === -1) {
    return {
      data: {},
      body: text,
    };
  }

  return {
    data: parseFrontmatterData(lines.slice(1, closeIndex)),
    body: lines.slice(closeIndex + 1).join('\n'),
  };
}

function parseFrontmatterData(lines: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    data[match[1]] = parseFrontmatterValue(match[2]);
  }
  return data;
}

function parseFrontmatterValue(value: string): string | number | boolean {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function basenameId(filePath: string): string {
  return path.basename(filePath).replace(/\.[^.]+$/, '');
}

function displayContentPath(config: ProjectConfig, filePath: string): string {
  return path.isAbsolute(filePath)
    ? path.relative(config.cwd ?? '.', filePath)
    : normalizeSlash(filePath);
}

function contentLoadDiagnostic(config: ProjectConfig, schemaSource: SourceRecord, filePath: string, error: unknown): SchemaDiagnostic {
  const relative = displayContentPath(config, filePath);
  const parserMessage = error instanceof Error ? error.message : String(error);
  const errorCode = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return {
    code: 'CONTENT_SOURCE_LOAD_FAILED',
    severity: 'error',
    resource: schemaSource.name,
    file: relative,
    message: `Could not load content source ${relative}: ${parserMessage}`,
    hint: 'Fix this content file and db will reload the rest of the project.',
    details: {
      resource: schemaSource.name,
      path: relative,
      parserMessage,
      code: errorCode,
    },
  };
}

function folderSourceRequiredDiagnostic(resource: string, schemaSource: SourceRecord): SchemaDiagnostic {
  return {
    code: 'SCHEMA_UNBUNDLE_FOLDER_SOURCE_REQUIRED',
    severity: 'error',
    resource,
    file: schemaSource.file,
    message: `Folder collection marker ${schemaSource.file} must declare an explicit source glob.`,
    hint: `Add source: files('./**/*.mdx', { read: 'frontmatter' }) or another explicit files() source to ${schemaSource.file}.`,
    details: {
      command: 'schema unbundle --all',
      resource,
      file: schemaSource.file,
      marker: 'index.schema.mjs',
      requiredProperty: 'source',
    },
  };
}

function schemaStoreIgnoredDiagnostic(resource: string, schemaSource: SourceRecord): SchemaDiagnostic {
  return {
    code: 'SCHEMA_STORE_IGNORED',
    severity: 'warn',
    resource,
    file: schemaSource.file,
    message: `${schemaSource.file} declares schema-level store, but runtime stores are configured in db.config.js.`,
    hint: `Move this setting to resources.${resource}.store in db.config.js.`,
    details: {
      resource,
      file: schemaSource.file,
      property: 'store',
      replacement: `resources.${resource}.store`,
    },
  };
}

function schemaParserDeprecatedDiagnostic(resource: string, schemaSource: SourceRecord): SchemaDiagnostic {
  return {
    code: 'SCHEMA_PARSER_DEPRECATED',
    severity: 'warn',
    resource,
    file: schemaSource.file,
    message: `${schemaSource.file} declares parser, but file readers now belong on source: files(..., { read }).`,
    hint: `Replace parser with source: files(pattern, { read: ${JSON.stringify(schemaSource.schema?.parser)} }).`,
    details: {
      resource,
      file: schemaSource.file,
      property: 'parser',
      replacement: 'source.files.read',
    },
  };
}

function normalizeSlash(value: string): string {
  return String(value).split(path.sep).join('/').split('\\').join('/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function mixedModeSchemaSeedDiagnostic(resource: string, dataSource: SourceRecord, schemaSource: SourceRecord): SchemaDiagnostic {
  return {
    code: 'SCHEMA_SEED_IGNORED_IN_MIXED_MODE',
    severity: 'warn',
    resource,
    file: schemaSource.file,
    message: `${schemaSource.file} includes seed records, but ${dataSource.file} provides seed data for "${resource}".`,
    hint: `Remove "seed" from ${schemaSource.file}, or run async-db schema unbundle ${resource} to keep seed data in a separate data file.`,
    details: {
      resource,
      schemaFile: schemaSource.file,
      dataFile: dataSource.file,
    },
  };
}

function resourceAliasCollisionDiagnostics(resources: ProjectResource[]): SchemaDiagnostic[] {
  return resourceAliasCollisionGroups(resources).map((collision) => ({
    code: 'RESOURCE_ALIAS_COLLISION',
    severity: 'error',
    message: `Resource aliases are ambiguous for "${collision.alias}": ${collision.resources.map((resource) => `"${resource}"`).join(' and ')} both resolve through ${collision.aliases.map((alias) => `"${alias}"`).join(', ')}.`,
    hint: 'Rename one data file or customize resource names so every camelCase and kebab-case alias maps to one resource.',
    details: {
      alias: collision.alias,
      aliases: collision.aliases,
      resources: collision.resources,
      candidates: collision.candidates,
    },
  }));
}
