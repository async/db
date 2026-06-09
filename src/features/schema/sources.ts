import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFixturePath, resourceNameFromPath } from '../../config-public.js';
import { parseCsvRecords } from '../../csv.js';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';
import { parseJsonc } from '../../jsonc.js';
import { routePathForResource, typeNameForResource } from '../../names.js';

type SourceKind = 'data' | 'schema';
type ResourceNamingStrategy = Parameters<typeof resourceNameFromPath>[1]['strategy'] | string;

type SchemaDiagnostic = {
  code: string;
  severity: 'error' | 'warn' | 'info';
  resource?: string;
  file?: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
};

type SchemaLocator = {
  mode?: 'project' | 'root-schema' | 'schema-file' | 'source-dir' | string;
  file?: string | null;
  [key: string]: unknown;
  fs?: DbFileSystem;
};

type SchemaConfig = {
  cwd?: string;
  sourceDir?: string;
  schema?: {
    source?: 'data' | 'schema' | string;
    allowJsonc?: boolean;
    autoModulePackageJson?: boolean;
    [key: string]: unknown;
  };
  schemaLocator?: SchemaLocator | null;
  operations?: {
    sourceDir?: string;
    [key: string]: unknown;
  };
  resources?: {
    naming?: ResourceNamingStrategy;
    customizeResource?: (context: ResourceCustomizeContext) => unknown;
    [key: string]: unknown;
  };
  sources?: {
    readers?: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type SourceFileListConfig = {
  sourceDir?: string;
  operations?: SchemaConfig['operations'];
  fs?: DbFileSystem;
};

type SourceFileListOptions = {
  sourceDir: string;
  ignoredDirs: string[];
};

type SourceRecord = {
  kind: SourceKind;
  name: string;
  file: string;
  sourceFile: string;
  format: string;
  hash?: string;
  data?: unknown;
  schema?: unknown;
  baseDir?: string;
};

type SourceReadResult = {
  sources: SourceRecord[];
  diagnostics: SchemaDiagnostic[];
};

type RootSchemaReadResult = SourceReadResult & {
  found: boolean;
  file?: string | null;
};

type RootSchemaFileResult = {
  sourceFile: string | null;
  diagnostics: SchemaDiagnostic[];
};

type ParsedFixture = {
  file: string;
  folders: string[];
  folder: string | null;
  filename: string;
  basename: string;
  extension: string;
};

type SourceReaderContext = ParsedFixture & {
  config: SchemaConfig;
  file: string;
  sourceFile: string;
  hash: string;
  readBuffer(): Promise<Buffer>;
  readText(): Promise<string>;
};

type SourceReader = {
  name: string;
  match(context: SourceReaderContext): unknown | Promise<unknown>;
  read(context: SourceReaderContext): unknown | Promise<unknown>;
};

type SourceReaderResultRecord = {
  kind?: unknown;
  resourceName?: unknown;
  format?: unknown;
  data?: unknown;
  schema?: unknown;
  [key: string]: unknown;
};

type ResourceCustomizeContext = {
  file: string;
  sourceFile: string;
  basename: string;
  folder: string | null;
  folders: string[];
  extension: string;
  defaultName: string;
  defaultResource: { name: string };
};

type ResourceSourceEntry = {
  filename: string;
  kind: SourceKind;
};

type DiagnosticError = Error & {
  code?: string;
  hint?: string;
};

type PackageInfo = {
  file: string;
  type: string | null;
};

export async function listSourceFiles(sourceDirOrConfig: string | SourceFileListConfig): Promise<string[]> {
  const { sourceDir, ignoredDirs } = sourceFileListOptions(sourceDirOrConfig);
  const fs = dbFileSystem(typeof sourceDirOrConfig === 'string' ? null : sourceDirOrConfig);
  try {
    return await listSourceFilesInDirectory(sourceDir, fs, '', ignoredDirs);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function readRootSchemaFile(config: SchemaConfig): Promise<RootSchemaReadResult> {
  if (config.schema?.source === 'data') {
    return {
      sources: [],
      diagnostics: [],
      found: false,
    };
  }

  const locator = config.schemaLocator;
  if (locator && locator.mode !== 'project' && locator.mode !== 'root-schema') {
    return {
      sources: [],
      diagnostics: [],
      found: false,
    };
  }

  const { sourceFile, diagnostics: rootDiagnostics } = await rootSchemaFile(config, locator);
  if (!sourceFile) {
    return {
      sources: [],
      diagnostics: rootDiagnostics,
      found: false,
    };
  }

  let buffer;
  try {
    buffer = await dbFileSystem(config).readFile(sourceFile) as Buffer;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        sources: [],
        diagnostics: rootDiagnostics,
        found: false,
      };
    }
    return {
      sources: [],
      diagnostics: [
        ...rootDiagnostics,
        sourceLoadDiagnostic(error, sourceFile, 'dbSchema', config, {
          readerName: rootSchemaReaderName(sourceFile),
        }),
      ],
      found: true,
      file: sourceFile,
    };
  }

  try {
    await ensureSchemaJsModuleContext(config, sourceFile, { autoPackageJson: false });
    const url = pathToFileURL(sourceFile);
    url.searchParams.set('dbRootSchemaLoad', String(Date.now()));
    const module = await import(url.href);
    const exported = module.default ?? module.schema ?? {};
    const hash = createHash('sha256').update(buffer).digest('hex');
    return {
      sources: rootSchemaSources(config, exported, sourceFile, hash),
      diagnostics: rootDiagnostics,
      found: true,
      file: sourceFile,
    };
  } catch (error) {
    return {
      sources: [],
      diagnostics: [
        ...rootDiagnostics,
        sourceLoadDiagnostic(error, sourceFile, 'dbSchema', config, {
          readerName: rootSchemaReaderName(sourceFile),
        }),
      ],
      found: true,
      file: sourceFile,
    };
  }
}

async function rootSchemaFile(config: SchemaConfig, locator?: SchemaLocator | null): Promise<RootSchemaFileResult> {
  if (locator?.mode === 'root-schema') {
    return {
      sourceFile: locator.file,
      diagnostics: [],
    };
  }

  const mjsFile = path.join(config.cwd, 'db.schema.mjs');
  const jsFile = path.join(config.cwd, 'db.schema.js');
  const mjsExists = await fileExists(config, mjsFile);
  const jsExists = await fileExists(config, jsFile);
  if (mjsExists) {
    return {
      sourceFile: mjsFile,
      diagnostics: jsExists ? [duplicateRootSchemaDiagnostic(config, mjsFile, jsFile)] : [],
    };
  }
  if (jsExists) {
    return {
      sourceFile: jsFile,
      diagnostics: [],
    };
  }
  return {
    sourceFile: null,
    diagnostics: [],
  };
}

async function fileExists(config: SchemaConfig, file: string): Promise<boolean> {
  try {
    await dbFileSystem(config).readFile(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function duplicateRootSchemaDiagnostic(config: SchemaConfig, preferredFile: string, ignoredFile: string): SchemaDiagnostic {
  const preferred = path.relative(config.cwd, preferredFile).split(path.sep).join('/');
  const ignored = path.relative(config.cwd, ignoredFile).split(path.sep).join('/');
  return {
    code: 'ROOT_SCHEMA_DUPLICATE_IGNORED',
    severity: 'warn',
    resource: 'dbSchema',
    file: ignored,
    message: `Both ${preferred} and ${ignored} exist; ${preferred} is authoritative and ${ignored} was ignored.`,
    hint: 'Remove the ignored root schema file or pass from: "./db.schema.js" to load it explicitly.',
    details: {
      preferred,
      ignored,
    },
  };
}

function rootSchemaReaderName(sourceFile: string): string {
  return sourceFile.endsWith('.js') ? 'db:root-schema-js' : 'db:root-schema-mjs';
}

async function ensureSchemaJsModuleContext(
  config: SchemaConfig,
  sourceFile: string,
  options: { autoPackageJson?: boolean } = {},
): Promise<void> {
  if (!sourceFile.endsWith('.js')) {
    return;
  }

  const nearestPackage = await nearestPackageInfo(config, path.dirname(sourceFile));
  if (nearestPackage?.type === 'module') {
    return;
  }

  if (options.autoPackageJson !== false && await shouldCreateFixtureModulePackageJson(config, sourceFile, nearestPackage)) {
    await writeFixtureModulePackageJson(config);
    if ((await nearestPackageInfo(config, path.dirname(sourceFile)))?.type === 'module') {
      return;
    }
  }

  const error = new Error('JavaScript schema files require ESM module context.') as DiagnosticError;
  error.code = 'DB_SCHEMA_JS_REQUIRES_MODULE';
  error.hint = 'Add "type": "module" to the nearest package.json, move .schema.js and imported .js files under an ESM package boundary, or keep schema.autoModulePackageJson enabled for fixture-folder schemas.';
  throw error;
}

async function shouldCreateFixtureModulePackageJson(
  config: SchemaConfig,
  sourceFile: string,
  nearestPackage: PackageInfo | null,
): Promise<boolean> {
  if (config.schema?.autoModulePackageJson === false || !config.cwd || !config.sourceDir) {
    return false;
  }
  if (!isInsideDirectory(config.sourceDir, sourceFile)) {
    return false;
  }
  if ((await packageInfo(config, path.join(config.cwd, 'package.json')))?.type === 'module') {
    return false;
  }

  const fixturePackageFile = path.join(config.sourceDir, 'package.json');
  if (nearestPackage && (
    path.resolve(nearestPackage.file) === path.resolve(fixturePackageFile)
    || isInsideDirectory(config.sourceDir, nearestPackage.file)
  )) {
    return false;
  }

  return !await fileExists(config, fixturePackageFile);
}

async function writeFixtureModulePackageJson(config: SchemaConfig): Promise<void> {
  await dbFileSystem(config).writeFile(
    path.join(config.sourceDir, 'package.json'),
    `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
    'utf8',
  );
}

async function nearestPackageInfo(config: SchemaConfig, directory: string): Promise<PackageInfo | null> {
  let current = path.resolve(directory);
  while (true) {
    const packageFile = path.join(current, 'package.json');
    const info = await packageInfo(config, packageFile);
    if (info) {
      return info;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function packageInfo(config: SchemaConfig, packageFile: string): Promise<PackageInfo | null> {
  try {
    const json = JSON.parse(await dbFileSystem(config).readFile(packageFile, 'utf8') as string);
    return {
      file: packageFile,
      type: typeof json?.type === 'string' ? json.type : null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    return {
      file: packageFile,
      type: null,
    };
  }
}

function rootSchemaSources(config: SchemaConfig, exported: unknown, sourceFile: string, hash: string): SourceRecord[] {
  if (!exported || typeof exported !== 'object' || Array.isArray(exported)) {
    return [];
  }

  const file = path.relative(config.cwd, sourceFile).split(path.sep).join('/') || path.basename(sourceFile);
  return Object.entries(exported)
    .filter(([, schema]) => schema && typeof schema === 'object' && !Array.isArray(schema))
    .map(([name, schema]) => ({
      kind: 'schema',
      name,
      file,
      sourceFile,
      format: 'root-mjs',
      hash,
      schema,
      baseDir: path.dirname(sourceFile),
    }));
}

async function listSourceFilesInDirectory(directory: string, fs: DbFileSystem, prefix = '', ignoredDirs: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const childDirectory = path.join(directory, entry.name);
      if (isIgnoredSourceDirectory(childDirectory, ignoredDirs)) {
        continue;
      }
      files.push(...await listSourceFilesInDirectory(childDirectory, fs, relativePath, ignoredDirs));
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function sourceFileListOptions(sourceDirOrConfig: string | SourceFileListConfig): SourceFileListOptions {
  if (typeof sourceDirOrConfig === 'string') {
    return {
      sourceDir: sourceDirOrConfig,
      ignoredDirs: [],
    };
  }

  const sourceDir = sourceDirOrConfig.sourceDir;
  const operationSourceDir = sourceDirOrConfig.operations?.sourceDir;
  return {
    sourceDir,
    ignoredDirs: operationSourceDir && isInsideDirectory(sourceDir, operationSourceDir)
      ? [path.resolve(operationSourceDir)]
      : [],
  };
}

function isIgnoredSourceDirectory(directory: string, ignoredDirs: string[]): boolean {
  const resolved = path.resolve(directory);
  return ignoredDirs.some((ignoredDir) => resolved === ignoredDir || resolved.startsWith(`${ignoredDir}${path.sep}`));
}

function isInsideDirectory(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function readSourceFile(config: SchemaConfig, filename: string): Promise<SourceReadResult> {
  let context;
  try {
    context = await createSourceReaderContext(config, filename);
  } catch (error) {
    const sourceFile = path.join(config.sourceDir, filename);
    return {
      sources: [],
      diagnostics: [sourceLoadDiagnostic(error, sourceFile, resolveSourceResourceName(config, filename), config, {
        readerName: 'db:source-context',
      })],
    };
  }

  const readers = sourceReaders(config);
  const diagnostics = [];

  for (const reader of readers) {
    let matches: unknown = false;
    try {
      matches = await reader.match(context);
    } catch (error) {
      return {
        sources: [],
        diagnostics: [sourceReaderDiagnostic(error, context, reader)],
      };
    }

    if (!matches) {
      continue;
    }

    let result;
    try {
      result = await reader.read(context);
    } catch (error) {
      return {
        sources: [],
        diagnostics: [sourceLoadDiagnostic(error, context.sourceFile, resolveSourceResourceName(config, filename), config, {
          readerName: reader.name,
        })],
      };
    }

    if (result === null || result === undefined) {
      continue;
    }

    const normalized = normalizeSourceReaderResult(result, context, reader);
    diagnostics.push(...normalized.diagnostics);
    return {
      sources: normalized.sources,
      diagnostics,
    };
  }

  return {
    sources: [],
    diagnostics,
  };
}

async function createSourceReaderContext(config: SchemaConfig, filename: string): Promise<SourceReaderContext> {
  const sourceFile = path.join(config.sourceDir, filename);
  const file = sourceFileLabel(config, filename);
  const parsed = parseFixturePath(file);
  let buffer;
  let text;

  const readBuffer = async () => {
    buffer ??= await dbFileSystem(config).readFile(sourceFile) as Buffer;
    return buffer;
  };

  const hash = createHash('sha256').update(await readBuffer()).digest('hex');

  return {
    ...(parsed as ParsedFixture),
    config,
    file,
    sourceFile,
    hash,
    async readBuffer() {
      return readBuffer();
    },
    async readText() {
      text ??= (await readBuffer()).toString('utf8');
      return text;
    },
  };
}

function sourceReaders(config: SchemaConfig): SourceReader[] {
  return [
    ...normalizeUserSourceReaders(config.sources?.readers),
    ...builtInSourceReaders(),
  ];
}

function normalizeUserSourceReaders(readers: unknown): SourceReader[] {
  if (!Array.isArray(readers)) {
    return [];
  }

  return readers.filter(isSourceReader);
}

function isSourceReader(reader: unknown): reader is SourceReader {
  return Boolean(reader)
    && typeof reader === 'object'
    && typeof (reader as SourceReader).name === 'string'
    && typeof (reader as SourceReader).match === 'function'
    && typeof (reader as SourceReader).read === 'function';
}

function builtInSourceReaders(): SourceReader[] {
  return [
    {
      name: 'db:schema-mjs',
      match: ({ file, config }) => config.schema?.source !== 'data' && file.endsWith('.schema.mjs'),
      async read({ sourceFile }) {
        const url = pathToFileURL(sourceFile);
        url.searchParams.set('dbSchemaLoad', String(Date.now()));
        const module = await import(url.href);
        return {
          kind: 'schema',
          format: 'mjs',
          schema: module.default,
        };
      },
    },
    {
      name: 'db:schema-js',
      match: ({ file, config }) => config.schema?.source !== 'data' && file.endsWith('.schema.js'),
      async read({ config, sourceFile }) {
        await ensureSchemaJsModuleContext(config, sourceFile);
        const url = pathToFileURL(sourceFile);
        url.searchParams.set('dbSchemaLoad', String(Date.now()));
        const module = await import(url.href);
        return {
          kind: 'schema',
          format: 'js',
          schema: module.default,
        };
      },
    },
    {
      name: 'db:schema-json',
      match: ({ file, config }) => config.schema?.source !== 'data' && file.endsWith('.schema.json'),
      async read({ readText }) {
        return {
          kind: 'schema',
          format: 'json',
          schema: JSON.parse(await readText()),
        };
      },
    },
    {
      name: 'db:schema-jsonc',
      match: ({ file, config }) => (
        config.schema?.source !== 'data'
        && config.schema?.allowJsonc !== false
        && file.endsWith('.schema.jsonc')
      ),
      async read({ readText, sourceFile }) {
        return {
          kind: 'schema',
          format: 'jsonc',
          schema: parseJsonc(await readText(), sourceFile),
        };
      },
    },
    {
      name: 'db:data-csv',
      match: ({ file, config }) => config.schema?.source !== 'schema' && file.endsWith('.csv'),
      async read({ readText, sourceFile }) {
        return {
          kind: 'data',
          format: 'csv',
          data: parseCsvRecords(await readText(), sourceFile),
        };
      },
    },
    {
      name: 'db:data-jsonc',
      match: ({ file, config }) => (
        config.schema?.source !== 'schema'
        && config.schema?.allowJsonc !== false
        && !isSchemaSourceFile(file)
        && file.endsWith('.jsonc')
      ),
      async read({ readText, sourceFile }) {
        return {
          kind: 'data',
          format: 'jsonc',
          data: parseJsonc(await readText(), sourceFile),
        };
      },
    },
    {
      name: 'db:data-json',
      match: ({ file, config }) => (
        config.schema?.source !== 'schema'
        && !isPackageJsonFile(file)
        && !isSchemaSourceFile(file)
        && file.endsWith('.json')
      ),
      async read({ readText }) {
        return {
          kind: 'data',
          format: 'json',
          data: JSON.parse(await readText()),
        };
      },
    },
  ];
}

function isSchemaSourceFile(file: string): boolean {
  return file.endsWith('.schema.json') || file.endsWith('.schema.jsonc') || file.endsWith('.schema.mjs') || file.endsWith('.schema.js');
}

function isPackageJsonFile(file: string): boolean {
  return path.basename(file) === 'package.json';
}

function normalizeSourceReaderResult(result: unknown, context: SourceReaderContext, reader: SourceReader): SourceReadResult {
  const rawSources = flattenSourceReaderResult(result);
  const diagnostics: SchemaDiagnostic[] = [];
  const sources: SourceRecord[] = [];
  const multipleSources = rawSources.length > 1;

  for (const [index, rawSource] of rawSources.entries()) {
    if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) {
      diagnostics.push(invalidSourceReaderResultDiagnostic(context, reader, `Result ${index + 1} must be an object.`));
      continue;
    }

    const source = rawSource as SourceReaderResultRecord;
    if (source.kind !== 'data' && source.kind !== 'schema') {
      diagnostics.push(invalidSourceReaderResultDiagnostic(context, reader, `Result ${index + 1} must set kind to "data" or "schema".`));
      continue;
    }
    const kind = source.kind;

    if (multipleSources && !source.resourceName) {
      diagnostics.push({
        code: 'SOURCE_READER_RESOURCE_NAME_REQUIRED',
        severity: 'error',
        file: context.file,
        message: `Source reader "${reader.name}" returned multiple sources from ${context.file}, but result ${index + 1} does not include resourceName.`,
        hint: 'Add resourceName to every source returned from a multi-source reader.',
        details: {
          reader: reader.name,
          sourceIndex: index,
          file: context.file,
        },
      });
      continue;
    }

    if (!sourceKindAllowed(context.config, kind)) {
      continue;
    }

    if (kind === 'data' && !Object.prototype.hasOwnProperty.call(source, 'data')) {
      diagnostics.push(invalidSourceReaderResultDiagnostic(context, reader, `Data result ${index + 1} must include data.`));
      continue;
    }

    if (kind === 'schema' && !Object.prototype.hasOwnProperty.call(source, 'schema')) {
      diagnostics.push(invalidSourceReaderResultDiagnostic(context, reader, `Schema result ${index + 1} must include schema.`));
      continue;
    }

    const name = source.resourceName
      ? String(source.resourceName)
      : resolveSourceResourceName(context.config, path.relative(context.config.sourceDir, context.sourceFile));
    const format = source.format ? String(source.format) : reader.name;

    sources.push({
      kind,
      name,
      file: context.file,
      sourceFile: context.sourceFile,
      format,
      hash: context.hash,
      data: kind === 'data' ? source.data : undefined,
      schema: kind === 'schema' ? source.schema : undefined,
      baseDir: path.dirname(context.sourceFile),
    });
  }

  return {
    sources,
    diagnostics,
  };
}

function flattenSourceReaderResult(result: unknown): unknown[] {
  if (result === null || result === undefined) {
    return [];
  }

  if (Array.isArray(result)) {
    return result.flatMap((item) => flattenSourceReaderResult(item));
  }

  return [result];
}

function sourceKindAllowed(config: SchemaConfig, kind: SourceKind): boolean {
  if (kind === 'data') {
    return config.schema?.source !== 'schema';
  }

  return config.schema?.source !== 'data';
}

function resolveSourceResourceName(config: SchemaConfig, filename: string): string {
  const file = sourceFileLabel(config, filename);
  const strategy = config.resources?.naming ?? 'basename';
  const parsed = parseFixturePath(file) as ParsedFixture;
  const isIndexSchema = parsed.basename === 'index' && parsed.extension.startsWith('.schema.');
  const defaultName = isIndexSchema && parsed.folder
    ? resourceNameFromPath(`db/${parsed.folder}.json`, { strategy: 'basename' })
    : resourceNameFromPath(file, { strategy: strategy as Parameters<typeof resourceNameFromPath>[1]['strategy'] });
  const defaultResource = { name: defaultName };
  const customizeResource = config.resources?.customizeResource;

  if (typeof customizeResource !== 'function') {
    return defaultName;
  }

  const customized = customizeResource({
    file,
    sourceFile: path.join(config.sourceDir, filename),
    basename: parsed.basename,
    folder: parsed.folder,
    folders: parsed.folders,
    extension: parsed.extension,
    defaultName,
    defaultResource,
  }) as { name?: unknown } | null | undefined;

  return String(customized?.name ?? defaultName);
}

function sourceFileLabel(config: SchemaConfig, filename: string): string {
  return path.relative(config.cwd, path.join(config.sourceDir, filename)).split(path.sep).join('/');
}

export function trackResourceSource(resourceSources: Map<string, unknown>, name: string, filename: string, kind: SourceKind): void {
  const sources = resourceSources.get(name) as ResourceSourceEntry[] | undefined ?? [];
  sources.push({ filename, kind });
  resourceSources.set(name, sources);
}

export function duplicateResourceDiagnostics(resourceSources: Map<string, unknown>): SchemaDiagnostic[] {
  const diagnostics: SchemaDiagnostic[] = [];

  for (const [name, rawSources] of resourceSources.entries()) {
    const sources = rawSources as ResourceSourceEntry[];
    const dataSources = sources.filter((source) => source.kind === 'data');
    const schemaSources = sources.filter((source) => source.kind === 'schema');
    const duplicates = dataSources.length > 1 ? dataSources : schemaSources.length > 1 ? schemaSources : [];
    if (duplicates.length === 0) {
      continue;
    }

    const files = duplicates.map((source) => source.filename.split(path.sep).join('/'));
    diagnostics.push({
      code: 'DUPLICATE_RESOURCE_NAME',
      severity: 'error',
      resource: name,
      file: files[0],
      message: `Duplicate resource name "${name}" from nested fixtures:\n${files.map((file) => `- ${file}`).join('\n')}`,
      hint: `Rename one fixture, set resources.naming to "folder-prefixed" or "path", or use resources.customizeResource to assign explicit names.`,
      details: {
        resource: name,
        files,
        apiEffects: [
          `.db/state/${name}.json`,
          `REST ${routePathForResource(name)}`,
          `GraphQL ${name}/${typeNameForResource(name)}`,
          `DbCollections["${name}"]`,
        ],
      },
    });
  }

  return diagnostics;
}

function sourceLoadDiagnostic(
  error: unknown,
  filePath: string,
  resource: string,
  config: SchemaConfig,
  options: { readerName?: string } = {},
): SchemaDiagnostic {
  const loadError = error as DiagnosticError;
  const relativePath = path.relative(config.cwd, filePath);
  return {
    code: 'SOURCE_LOAD_FAILED',
    severity: 'error',
    resource,
    file: relativePath,
    message: `Could not load ${relativePath}: ${loadError.message}`,
    hint: loadError.hint ?? schemaModuleLoadHint(relativePath, loadError) ?? 'Fix this source file and db will reload the rest of the project.',
    details: {
      path: relativePath,
      reader: options.readerName,
      parserMessage: loadError.message,
      code: loadError.code,
    },
  };
}

function schemaModuleLoadHint(relativePath: string, error: unknown): string | null {
  if (!relativePath.endsWith('.schema.js') && path.basename(relativePath) !== 'db.schema.js') {
    return null;
  }
  const message = String((error as DiagnosticError | null | undefined)?.message ?? '');
  if (message.includes('Cannot use import statement outside a module') || message.includes('Unexpected token \'export\'')) {
    return 'Add "type": "module" to the nearest package.json, move .schema.js and imported .js files under an ESM package boundary, or keep schema.autoModulePackageJson enabled for fixture-folder schemas.';
  }
  return null;
}

function sourceReaderDiagnostic(error: unknown, context: SourceReaderContext, reader: SourceReader): SchemaDiagnostic {
  const readerError = error as DiagnosticError;
  return {
    code: 'SOURCE_READER_FAILED',
    severity: 'error',
    file: context.file,
    message: `Source reader "${reader.name}" could not inspect ${context.file}: ${readerError.message}`,
    hint: 'Update the source reader or return null so another reader can handle this file.',
    details: {
      reader: reader.name,
      path: context.file,
      parserMessage: readerError.message,
      code: readerError.code,
    },
  };
}

function invalidSourceReaderResultDiagnostic(context: SourceReaderContext, reader: SourceReader, message: string): SchemaDiagnostic {
  return {
    code: 'SOURCE_READER_INVALID_RESULT',
    severity: 'error',
    file: context.file,
    message: `Source reader "${reader.name}" returned an invalid result for ${context.file}: ${message}`,
    hint: 'Return { kind: "data", data } or { kind: "schema", schema }, optionally with format and resourceName.',
    details: {
      reader: reader.name,
      path: context.file,
    },
  };
}
