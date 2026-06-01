import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveFrom } from '../../fs-utils.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { normalizeForks } from './forks.js';
import { normalizeSchemaLoadMode, resolveSchemaLocator, type SchemaLoadMode } from '../schema/locator.js';

type ConfigRecord = Record<string, any>;
type ConfigPath = readonly string[];

type LoadConfigOptions = string | (ConfigRecord & {
  configPath?: string;
  cwd?: string;
  from?: string;
  load?: SchemaLoadMode;
});

type UnsupportedRuntimeConfigDiagnostic = {
  code: 'CONFIG_UNSUPPORTED_RUNTIME_BOUNDARY';
  severity: 'error';
  path: string;
  message: string;
  hint: string;
};

type ConfigLoadError = Error & {
  code?: string;
  diagnostics?: UnsupportedRuntimeConfigDiagnostic[];
};

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ConfigRecord> {
  const rawOptions = typeof options === 'string' ? { from: options } : options;
  const locator = await resolveSchemaLocator(rawOptions);
  const cwd = locator.cwd;
  const configPath = rawOptions.configPath
    ? resolveFrom(cwd, rawOptions.configPath)
    : await findConfigPath(cwd);

  let userConfig: ConfigRecord = {};
  if (configPath) {
    const url = pathToFileURL(configPath);
    url.searchParams.set('dbConfigLoad', String(Date.now()));
    const module = await import(url.href);
    userConfig = module.default ?? module.config ?? {};
  }

  const inlineOptions: ConfigRecord = { ...rawOptions };
  delete inlineOptions.cwd;
  delete inlineOptions.configPath;
  delete inlineOptions.from;
  delete inlineOptions.load;

  rejectUnsupportedRuntimeConfig(userConfig);
  rejectUnsupportedRuntimeConfig(inlineOptions);

  const merged = mergeDeep(mergeDeep(structuredClone(DEFAULT_CONFIG), userConfig), inlineOptions) as ConfigRecord;
  normalizeOutputAliases(merged, userConfig, inlineOptions);
  merged.cwd = cwd;
  merged.configPath = configPath;
  const hasInlineSourceDir = hasOwnConfigValue(inlineOptions, 'sourceDir') || hasOwnConfigValue(inlineOptions, 'dbDir');
  const hasUserSourceDir = hasOwnConfigValue(userConfig, 'sourceDir') || hasOwnConfigValue(userConfig, 'dbDir');
  const sourceDir = hasInlineSourceDir
    ? (hasOwnConfigValue(inlineOptions, 'sourceDir') ? merged.sourceDir : merged.dbDir)
    : rawOptions.from
      ? locator.sourceDir
      : hasUserSourceDir
        ? (hasOwnConfigValue(userConfig, 'sourceDir') ? merged.sourceDir : merged.dbDir)
        : merged.dbDir;
  merged.sourceDir = resolveFrom(cwd, sourceDir);
  merged.dbDir = merged.sourceDir;
  merged.schemaLocator = {
    ...locator,
    cwd,
    sourceDir: merged.sourceDir,
  };
  merged.schemaLoadMode = normalizeSchemaLoadMode(rawOptions.load ?? 'data');
  merged.stateDir = resolveFrom(cwd, merged.stateDir);
  merged.outputs.stateDir = merged.stateDir;

  if (merged.types?.outFile) {
    merged.types.outFile = resolveFrom(cwd, merged.types.outFile);
  }
  merged.outputs.types = merged.types?.outFile ?? null;

  if (merged.types?.commitOutFile) {
    merged.types.commitOutFile = resolveFrom(cwd, merged.types.commitOutFile);
  }
  merged.outputs.committedTypes = merged.types?.commitOutFile ?? null;

  if (merged.schemaOutFile) {
    merged.schemaOutFile = resolveFrom(cwd, merged.schemaOutFile);
  }
  merged.outputs.schemaManifest = merged.schemaOutFile ?? null;

  if (merged.viewerManifestOutFile) {
    merged.viewerManifestOutFile = resolveFrom(cwd, merged.viewerManifestOutFile);
  }
  merged.outputs.viewerManifest = merged.viewerManifestOutFile ?? null;

  if (merged.operations?.sourceDir) {
    merged.operations.sourceDir = resolveFrom(cwd, merged.operations.sourceDir);
  }

  if (merged.operations?.outFile) {
    merged.operations.outFile = resolveFrom(cwd, merged.operations.outFile);
  }
  merged.outputs.operationRegistry = merged.operations?.outFile ?? null;

  if (merged.operations?.refsOutFile) {
    merged.operations.refsOutFile = resolveFrom(cwd, merged.operations.refsOutFile);
  }
  merged.outputs.operationRefs = merged.operations?.refsOutFile ?? null;

  if (merged.generate?.hono?.outDir) {
    merged.generate.hono.outDir = resolveFrom(cwd, merged.generate.hono.outDir);
  }
  merged.outputs.honoStarterDir = merged.generate?.hono?.outDir ?? null;

  merged.forks = normalizeForks(merged as Parameters<typeof normalizeForks>[0], merged.forks);

  return merged;
}

function normalizeOutputAliases(config: ConfigRecord, userConfig: ConfigRecord, inlineOptions: ConfigRecord): void {
  config.outputs = config.outputs ?? {};
  config.types = config.types ?? {};
  config.operations = config.operations ?? {};
  config.generate = config.generate ?? {};
  config.generate.hono = config.generate.hono ?? {};

  mirrorOutput(config, userConfig, inlineOptions, 'stateDir', ['stateDir']);
  mirrorOutput(config, userConfig, inlineOptions, 'types', ['types', 'outFile']);
  mirrorOutput(config, userConfig, inlineOptions, 'committedTypes', ['types', 'commitOutFile']);
  mirrorOutput(config, userConfig, inlineOptions, 'schemaManifest', ['schemaOutFile']);
  mirrorOutput(config, userConfig, inlineOptions, 'viewerManifest', ['viewerManifestOutFile']);
  mirrorOutput(config, userConfig, inlineOptions, 'operationRegistry', ['operations', 'outFile']);
  mirrorOutput(config, userConfig, inlineOptions, 'operationRefs', ['operations', 'refsOutFile']);
  mirrorOutput(config, userConfig, inlineOptions, 'honoStarterDir', ['generate', 'hono', 'outDir']);
}

function mirrorOutput(
  config: ConfigRecord,
  userConfig: ConfigRecord,
  inlineOptions: ConfigRecord,
  outputKey: string,
  legacyPath: ConfigPath,
): void {
  const outputPath = ['outputs', outputKey];
  const value = configuredOutputValue({
    config,
    userConfig,
    inlineOptions,
    outputPath,
    legacyPath,
  });

  setPath(config, outputPath, value);
  setPath(config, legacyPath, value);
}

function configuredOutputValue({
  config,
  userConfig,
  inlineOptions,
  outputPath,
  legacyPath,
}: {
  config: ConfigRecord;
  userConfig: ConfigRecord;
  inlineOptions: ConfigRecord;
  outputPath: ConfigPath;
  legacyPath: ConfigPath;
}): unknown {
  if (hasOwnPath(inlineOptions, outputPath)) {
    return getPath(inlineOptions, outputPath);
  }

  if (hasOwnPath(inlineOptions, legacyPath)) {
    return getPath(inlineOptions, legacyPath);
  }

  if (hasOwnPath(userConfig, outputPath)) {
    return getPath(userConfig, outputPath);
  }

  if (hasOwnPath(userConfig, legacyPath)) {
    return getPath(userConfig, legacyPath);
  }

  return getPath(config, legacyPath);
}

async function findConfigPath(cwd: string): Promise<string | null> {
  for (const filename of ['db.config.mjs', 'db.config.js']) {
    const candidate = path.join(cwd, filename);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }

  return null;
}

export function mergeDeep(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergeDeep(output[key], value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

function isPlainObject(value: unknown): value is ConfigRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnConfigValue(config: unknown, key: string): boolean {
  if (!isPlainObject(config)) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(config, key) && config[key] !== undefined;
}

function hasOwnPath(config: unknown, pathParts: ConfigPath): boolean {
  let current = config;
  for (const pathPart of pathParts) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, pathPart)) {
      return false;
    }
    current = current[pathPart];
  }

  return current !== undefined;
}

function getPath(config: unknown, pathParts: ConfigPath): unknown {
  let current = config;
  for (const pathPart of pathParts) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[pathPart];
  }

  return current;
}

function setPath(config: ConfigRecord, pathParts: ConfigPath, value: unknown): void {
  const last = pathParts.at(-1);
  if (last === undefined) {
    return;
  }

  let current = config;
  for (const pathPart of pathParts.slice(0, -1)) {
    if (!isPlainObject(current[pathPart])) {
      current[pathPart] = {};
    }
    current = current[pathPart];
  }

  current[last] = value;
}

function rejectUnsupportedRuntimeConfig(config: unknown): void {
  const diagnostics = unsupportedRuntimeConfigDiagnostics(config);
  if (diagnostics.length === 0) {
    return;
  }

  const error = new Error(diagnostics.map((diagnostic) => diagnostic.message).join('\n')) as ConfigLoadError;
  error.code = 'CONFIG_UNSUPPORTED_RUNTIME_BOUNDARY';
  error.diagnostics = diagnostics;
  throw error;
}

function unsupportedRuntimeConfigDiagnostics(config: unknown): UnsupportedRuntimeConfigDiagnostic[] {
  if (!isPlainObject(config)) {
    return [];
  }

  const diagnostics: UnsupportedRuntimeConfigDiagnostic[] = [];
  if (hasOwnConfigValue(config, 'mode')) {
    diagnostics.push(unsupportedRuntimeConfigDiagnostic('mode'));
  }

  if (isPlainObject(config.runtime)) {
    if (hasOwnConfigValue(config.runtime, 'default')) {
      diagnostics.push(unsupportedRuntimeConfigDiagnostic('runtime.default'));
    }

    if (hasOwnConfigValue(config.runtime, 'adapters')) {
      diagnostics.push(unsupportedRuntimeConfigDiagnostic('runtime.adapters'));
    }
  } else if (hasOwnConfigValue(config, 'runtime')) {
    diagnostics.push(unsupportedRuntimeConfigDiagnostic('runtime'));
  }

  if (isPlainObject(config.resources)) {
    for (const [resourceName, resourceConfig] of Object.entries(config.resources)) {
      if (isPlainObject(resourceConfig) && hasOwnConfigValue(resourceConfig, 'runtime')) {
        diagnostics.push(unsupportedRuntimeConfigDiagnostic(`resources.${resourceName}.runtime`));
      }
    }
  }

  return diagnostics;
}

function unsupportedRuntimeConfigDiagnostic(configPath: string): UnsupportedRuntimeConfigDiagnostic {
  return {
    code: 'CONFIG_UNSUPPORTED_RUNTIME_BOUNDARY',
    severity: 'error',
    path: configPath,
    message: `Unsupported runtime config at "${configPath}". Runtime config is no longer a public configuration boundary.`,
    hint: 'Use stores.default, named stores, and resources.<name>.store to configure the public storage boundary.',
  };
}
