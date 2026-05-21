import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFixturePath, resourceNameFromPath } from '../../config-public.js';
import { parseCsvRecords } from '../../csv.js';
import { parseJsonc } from '../../jsonc.js';
import { routePathForResource, typeNameForResource } from '../../names.js';

export async function listSourceFiles(sourceDirOrConfig) {
  const { sourceDir, ignoredDirs } = sourceFileListOptions(sourceDirOrConfig);
  try {
    return await listSourceFilesInDirectory(sourceDir, '', ignoredDirs);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function listSourceFilesInDirectory(directory, prefix = '', ignoredDirs = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

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
      files.push(...await listSourceFilesInDirectory(childDirectory, relativePath, ignoredDirs));
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function sourceFileListOptions(sourceDirOrConfig) {
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

function isIgnoredSourceDirectory(directory, ignoredDirs) {
  const resolved = path.resolve(directory);
  return ignoredDirs.some((ignoredDir) => resolved === ignoredDir || resolved.startsWith(`${ignoredDir}${path.sep}`));
}

function isInsideDirectory(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function readSourceFile(config, filename) {
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
    let matches = false;
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

async function createSourceReaderContext(config, filename) {
  const sourceFile = path.join(config.sourceDir, filename);
  const file = sourceFileLabel(config, filename);
  const parsed = parseFixturePath(file);
  let buffer;
  let text;

  const readBuffer = async () => {
    buffer ??= await readFile(sourceFile);
    return buffer;
  };

  const hash = createHash('sha256').update(await readBuffer()).digest('hex');

  return {
    ...parsed,
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

function sourceReaders(config) {
  return [
    ...normalizeUserSourceReaders(config.sources?.readers),
    ...builtInSourceReaders(),
  ];
}

function normalizeUserSourceReaders(readers) {
  if (!Array.isArray(readers)) {
    return [];
  }

  return readers.filter((reader) => reader && typeof reader.match === 'function' && typeof reader.read === 'function');
}

function builtInSourceReaders() {
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
      match: ({ file, config }) => config.schema?.source !== 'schema' && !isSchemaSourceFile(file) && file.endsWith('.json'),
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

function isSchemaSourceFile(file) {
  return file.endsWith('.schema.json') || file.endsWith('.schema.jsonc') || file.endsWith('.schema.mjs');
}

function normalizeSourceReaderResult(result, context, reader) {
  const rawSources = flattenSourceReaderResult(result);
  const diagnostics = [];
  const sources = [];
  const multipleSources = rawSources.length > 1;

  for (const [index, rawSource] of rawSources.entries()) {
    if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) {
      diagnostics.push(invalidSourceReaderResultDiagnostic(context, reader, `Result ${index + 1} must be an object.`));
      continue;
    }

    if (rawSource.kind !== 'data' && rawSource.kind !== 'schema') {
      diagnostics.push(invalidSourceReaderResultDiagnostic(context, reader, `Result ${index + 1} must set kind to "data" or "schema".`));
      continue;
    }

    if (multipleSources && !rawSource.resourceName) {
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

    if (!sourceKindAllowed(context.config, rawSource.kind)) {
      continue;
    }

    if (rawSource.kind === 'data' && !Object.prototype.hasOwnProperty.call(rawSource, 'data')) {
      diagnostics.push(invalidSourceReaderResultDiagnostic(context, reader, `Data result ${index + 1} must include data.`));
      continue;
    }

    if (rawSource.kind === 'schema' && !Object.prototype.hasOwnProperty.call(rawSource, 'schema')) {
      diagnostics.push(invalidSourceReaderResultDiagnostic(context, reader, `Schema result ${index + 1} must include schema.`));
      continue;
    }

    const name = rawSource.resourceName
      ? String(rawSource.resourceName)
      : resolveSourceResourceName(context.config, path.relative(context.config.sourceDir, context.sourceFile));
    const format = rawSource.format ? String(rawSource.format) : reader.name;

    sources.push({
      kind: rawSource.kind,
      name,
      file: context.file,
      sourceFile: context.sourceFile,
      format,
      hash: context.hash,
      data: rawSource.kind === 'data' ? rawSource.data : undefined,
      schema: rawSource.kind === 'schema' ? rawSource.schema : undefined,
    });
  }

  return {
    sources,
    diagnostics,
  };
}

function flattenSourceReaderResult(result) {
  if (result === null || result === undefined) {
    return [];
  }

  if (Array.isArray(result)) {
    return result.flatMap((item) => flattenSourceReaderResult(item));
  }

  return [result];
}

function sourceKindAllowed(config, kind) {
  if (kind === 'data') {
    return config.schema?.source !== 'schema';
  }

  return config.schema?.source !== 'data';
}

function resolveSourceResourceName(config, filename) {
  const file = sourceFileLabel(config, filename);
  const strategy = config.resources?.naming ?? 'basename';
  const defaultName = resourceNameFromPath(file, { strategy });
  const defaultResource = { name: defaultName };
  const customizeResource = config.resources?.customizeResource;

  if (typeof customizeResource !== 'function') {
    return defaultName;
  }

  const parsed = parseFixturePath(file);
  const customized = customizeResource({
    file,
    sourceFile: path.join(config.sourceDir, filename),
    basename: parsed.basename,
    folder: parsed.folder,
    folders: parsed.folders,
    extension: parsed.extension,
    defaultName,
    defaultResource,
  });

  return String(customized?.name ?? defaultName);
}

function sourceFileLabel(config, filename) {
  return path.relative(config.cwd, path.join(config.sourceDir, filename)).split(path.sep).join('/');
}

export function trackResourceSource(resourceSources, name, filename, kind) {
  const sources = resourceSources.get(name) ?? [];
  sources.push({ filename, kind });
  resourceSources.set(name, sources);
}

export function duplicateResourceDiagnostics(resourceSources) {
  const diagnostics = [];

  for (const [name, sources] of resourceSources.entries()) {
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

function sourceLoadDiagnostic(error, filePath, resource, config, options = {}) {
  const relativePath = path.relative(config.cwd, filePath);
  return {
    code: 'SOURCE_LOAD_FAILED',
    severity: 'error',
    resource,
    file: relativePath,
    message: `Could not load ${relativePath}: ${error.message}`,
    hint: error.hint ?? 'Fix this source file and db will reload the rest of the project.',
    details: {
      path: relativePath,
      reader: options.readerName,
      parserMessage: error.message,
      code: error.code,
    },
  };
}

function sourceReaderDiagnostic(error, context, reader) {
  return {
    code: 'SOURCE_READER_FAILED',
    severity: 'error',
    file: context.file,
    message: `Source reader "${reader.name}" could not inspect ${context.file}: ${error.message}`,
    hint: 'Update the source reader or return null so another reader can handle this file.',
    details: {
      reader: reader.name,
      path: context.file,
      parserMessage: error.message,
      code: error.code,
    },
  };
}

function invalidSourceReaderResultDiagnostic(context, reader, message) {
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
