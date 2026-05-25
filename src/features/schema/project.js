import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseJsonc } from '../../jsonc.js';
import { buildResource } from './resource.js';
import { duplicateResourceDiagnostics, listSourceFiles, readRootSchemaFile, readSourceFile, trackResourceSource } from './sources.js';
import { makeGeneratedSchema } from './generated.js';
import { resourceAliasCollisionGroups } from '../../names.js';
import { validateProjectRelations } from './relations.js';
import { validateResourceSeed } from './validation.js';
import { normalizeSchemaLoadMode } from './locator.js';
import { normalizeFilesSource } from './source-definitions.js';

export async function loadProjectSchema(config, options = {}) {
  const loadMode = normalizeSchemaLoadMode(options.load ?? config.schemaLoadMode ?? 'data');
  const rootSchema = await readRootSchemaFile(config);
  const files = await sourceFilesForLoadMode(config, rootSchema, loadMode);
  const dataFiles = new Map();
  const schemaFiles = new Map();
  const resourceSources = new Map();
  const diagnostics = [...rootSchema.diagnostics];

  for (const source of rootSchema.sources) {
    trackResourceSource(resourceSources, source.name, source.file, source.kind);
    schemaFiles.set(source.name, source);
  }

  for (const filename of files) {
    if (rootSchema.found && isSchemaSourceFilename(filename)) {
      continue;
    }

    const result = await readSourceFile(config, filename);
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
  const resources = [];
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
      rawSchema,
      config,
      includeSeed: loadMode !== 'schema',
    });

    if (loadMode !== 'schema') {
      diagnostics.push(...validateResourceSeed(resource, config));
    }
    diagnostics.push(...(resource.diagnostics ?? []));
    resources.push(resource);
  }

  diagnostics.push(...validateProjectRelations(resources));
  diagnostics.push(...resourceAliasCollisionDiagnostics(resources));

  return {
    resources,
    diagnostics,
    schema: makeGeneratedSchema(resources, diagnostics),
    loadMode,
    locator: config.schemaLocator ?? null,
    rootSchema: {
      found: rootSchema.found,
      file: rootSchema.found ? path.join(config.cwd, 'db.schema.mjs') : undefined,
    },
  };
}

function isSchemaSourceFilename(filename) {
  return filename.endsWith('.schema.json') || filename.endsWith('.schema.jsonc') || filename.endsWith('.schema.mjs');
}

async function sourceFilesForLoadMode(config, rootSchema, loadMode) {
  const locator = config.schemaLocator;
  if (locator?.mode === 'schema-file') {
    return singleSchemaFileSources(config, locator, loadMode);
  }

  const files = await listSourceFiles(config);
  if (loadMode === 'schema') {
    return files.filter(isSchemaSourceFilename);
  }

  return files;
}

async function singleSchemaFileSources(config, locator, loadMode) {
  const files = await listSourceFiles(config);
  const schemaFile = path.relative(config.sourceDir, locator.file);
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

function siblingDataFilesForSchema(schemaFile) {
  const base = schemaFile.replace(/\.schema\.(?:json|jsonc|mjs)$/i, '');
  return [`${base}.json`, `${base}.jsonc`, `${base}.csv`];
}

function isFolderSchemaMarker(schemaSource) {
  return schemaSource.file.split(path.sep).join('/').endsWith('/index.schema.mjs');
}

async function contentDataSourceForSchema(config, schemaSource) {
  const source = normalizeFilesSource(schemaSource.schema?.source, { read: schemaSource.schema?.parser });
  const baseDir = schemaSource.baseDir ?? path.dirname(schemaSource.sourceFile);
  const files = [];
  const diagnostics = [];

  for (const pattern of source.patterns) {
    const matched = await filesMatchingGlob(baseDir, String(pattern));
    files.push(...matched);
  }

  const uniqueFiles = [...new Set(files)].sort();
  const records = [];
  const hash = createHash('sha256');
  for (const filePath of uniqueFiles) {
    let text;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (error) {
      diagnostics.push(contentLoadDiagnostic(config, schemaSource, filePath, error));
      continue;
    }

    hash.update(filePath);
    hash.update('\0');
    hash.update(text);
    try {
      records.push(parseContentRecord(schemaSource, filePath, text, source.read));
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
      format: source.read,
      hash: hash.digest('hex'),
      data: records,
      baseDir,
    },
    diagnostics,
  };
}

async function filesMatchingGlob(baseDir, pattern) {
  const normalizedPattern = normalizeSlash(pattern).replace(/^\.\//, '');
  const firstGlob = firstGlobIndex(normalizedPattern);
  const rootPart = firstGlob === -1
    ? path.dirname(normalizedPattern)
    : normalizedPattern.slice(0, firstGlob).split('/').slice(0, -1).join('/');
  const searchRoot = path.resolve(baseDir, rootPart || '.');
  const allFiles = await listFilesRecursive(searchRoot);
  const regexp = globRegExp(normalizedPattern);

  return allFiles.filter((filePath) => {
    const relative = normalizeSlash(path.relative(baseDir, filePath));
    return regexp.test(relative) || regexp.test(`./${relative}`);
  });
}

async function listFilesRecursive(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function firstGlobIndex(pattern) {
  const indexes = ['*', '?', '[', '{']
    .map((token) => pattern.indexOf(token))
    .filter((index) => index >= 0);
  return indexes.length === 0 ? -1 : Math.min(...indexes);
}

function globRegExp(pattern) {
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

function parseContentRecord(schemaSource, filePath, text, read) {
  if (read === 'json') {
    return JSON.parse(text);
  }
  if (read === 'jsonc') {
    return parseJsonc(text, filePath);
  }
  if (read === 'text') {
    return {
      id: basenameId(filePath),
      body: text,
    };
  }
  return frontmatterRecord(filePath, text);
}

function frontmatterRecord(filePath, text) {
  const { data, body } = parseFrontmatter(text);
  return {
    id: data.id ?? basenameId(filePath),
    ...data,
    body: body.trim(),
  };
}

function parseFrontmatter(text) {
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

function parseFrontmatterData(lines) {
  const data = {};
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    data[match[1]] = parseFrontmatterValue(match[2]);
  }
  return data;
}

function parseFrontmatterValue(value) {
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

function basenameId(filePath) {
  return path.basename(filePath).replace(/\.[^.]+$/, '');
}

function contentLoadDiagnostic(config, schemaSource, filePath, error) {
  const relative = path.relative(config.cwd, filePath);
  return {
    code: 'CONTENT_SOURCE_LOAD_FAILED',
    severity: 'error',
    resource: schemaSource.name,
    file: relative,
    message: `Could not load content source ${relative}: ${error.message}`,
    hint: 'Fix this content file and db will reload the rest of the project.',
    details: {
      resource: schemaSource.name,
      path: relative,
      parserMessage: error.message,
      code: error.code,
    },
  };
}

function folderSourceRequiredDiagnostic(resource, schemaSource) {
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

function schemaStoreIgnoredDiagnostic(resource, schemaSource) {
  return {
    code: 'SCHEMA_STORE_IGNORED',
    severity: 'warn',
    resource,
    file: schemaSource.file,
    message: `${schemaSource.file} declares schema-level store, but runtime stores are configured in db.config.mjs.`,
    hint: `Move this setting to resources.${resource}.store in db.config.mjs.`,
    details: {
      resource,
      file: schemaSource.file,
      property: 'store',
      replacement: `resources.${resource}.store`,
    },
  };
}

function schemaParserDeprecatedDiagnostic(resource, schemaSource) {
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

function normalizeSlash(value) {
  return String(value).split(path.sep).join('/').split('\\').join('/');
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function mixedModeSchemaSeedDiagnostic(resource, dataSource, schemaSource) {
  return {
    code: 'SCHEMA_SEED_IGNORED_IN_MIXED_MODE',
    severity: 'warn',
    resource,
    file: schemaSource.file,
    message: `${schemaSource.file} includes seed records, but ${dataSource.file} provides seed data for "${resource}".`,
    hint: `Remove "seed" from ${schemaSource.file}, or run async-db schema unbundle ${resource} to keep seed data in a separate fixture.`,
    details: {
      resource,
      schemaFile: schemaSource.file,
      dataFile: dataSource.file,
    },
  };
}

function resourceAliasCollisionDiagnostics(resources) {
  return resourceAliasCollisionGroups(resources).map((collision) => ({
    code: 'RESOURCE_ALIAS_COLLISION',
    severity: 'error',
    message: `Resource aliases are ambiguous for "${collision.alias}": ${collision.resources.map((resource) => `"${resource}"`).join(' and ')} both resolve through ${collision.aliases.map((alias) => `"${alias}"`).join(', ')}.`,
    hint: 'Rename one fixture or customize resource names so every camelCase and kebab-case alias maps to one resource.',
    details: {
      alias: collision.alias,
      aliases: collision.aliases,
      resources: collision.resources,
      candidates: collision.candidates,
    },
  }));
}
