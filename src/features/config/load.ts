import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dbError } from '../../errors.js';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';
import { resolveFrom } from '../../fs-utils.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { normalizeSchemaLoadMode, resolveSchemaLocator, type SchemaLoadMode } from '../schema/locator.js';

type ConfigRecord = Record<string, any>;
type ConfigPath = readonly string[];

type LoadConfigOptions = string | (ConfigRecord & {
  configPath?: string;
  cwd?: string;
  fs?: DbFileSystem;
  from?: string;
  load?: SchemaLoadMode;
});

type NormalizedLoadConfigOptions = ConfigRecord & {
  configPath?: string;
  cwd?: string;
  fs?: DbFileSystem;
  from?: string;
  load?: SchemaLoadMode;
};

type SchemaLocatorResult = Awaited<ReturnType<typeof resolveSchemaLocator>>;

type ResolveConfigContext = {
  rawOptions: NormalizedLoadConfigOptions;
  locator: SchemaLocatorResult;
  cwd: string;
  configPath: string | null;
  userConfig: ConfigRecord;
  inlineOptions: ConfigRecord;
};

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
  const rawOptions = normalizeLoadConfigOptions(options);
  const locator = await resolveSchemaLocator(rawOptions);
  const fs = dbFileSystem(rawOptions);
  const cwd = locator.cwd;
  const configPath = await resolveConfigPath(rawOptions, cwd, fs);
  const userConfig = await loadUserConfig(configPath);
  const inlineOptions = inlineConfigOptions(rawOptions);

  rejectUnsupportedPublicConfig(userConfig, inlineOptions);

  const merged = mergeConfig(userConfig, inlineOptions);
  resolveConfigPaths(merged, {
    rawOptions,
    locator,
    cwd,
    configPath,
    userConfig,
    inlineOptions,
  });

  return merged;
}

function normalizeLoadConfigOptions(options: LoadConfigOptions): NormalizedLoadConfigOptions {
  return typeof options === 'string' ? { from: options } : options;
}

async function resolveConfigPath(rawOptions: NormalizedLoadConfigOptions, cwd: string, fs: DbFileSystem): Promise<string | null> {
  if (rawOptions.configPath) {
    return resolveFrom(cwd, rawOptions.configPath);
  }

  if (rawOptions.fs) {
    return null;
  }

  return await findConfigPath(cwd, fs);
}

async function loadUserConfig(configPath: string | null): Promise<ConfigRecord> {
  if (!configPath) {
    return {};
  }

  const url = pathToFileURL(configPath);
  url.searchParams.set('dbConfigLoad', String(Date.now()));
  const module = await import(url.href);
  return module.default ?? module.config ?? {};
}

function inlineConfigOptions(rawOptions: NormalizedLoadConfigOptions): ConfigRecord {
  const inlineOptions: ConfigRecord = { ...rawOptions };
  delete inlineOptions.cwd;
  delete inlineOptions.configPath;
  delete inlineOptions.from;
  delete inlineOptions.load;
  return inlineOptions;
}

function rejectUnsupportedPublicConfig(userConfig: ConfigRecord, inlineOptions: ConfigRecord): void {
  rejectUnsupportedRuntimeConfig(userConfig);
  rejectUnsupportedRuntimeConfig(inlineOptions);
  rejectRemovedFixtureForkConfig(userConfig);
  rejectRemovedFixtureForkConfig(inlineOptions);
}

function mergeConfig(userConfig: ConfigRecord, inlineOptions: ConfigRecord): ConfigRecord {
  const merged = mergeDeep(mergeDeep(structuredClone(DEFAULT_CONFIG), userConfig), inlineOptions) as ConfigRecord;
  normalizeOutputAliases(merged, userConfig, inlineOptions);
  return merged;
}

function resolveConfigPaths(config: ConfigRecord, context: ResolveConfigContext): void {
  const {
    rawOptions,
    locator,
    cwd,
    configPath,
  } = context;

  config.cwd = cwd;
  config.configPath = configPath;
  config.sourceDir = resolveConfiguredSourceDir(config, context);
  config.dbDir = config.sourceDir;
  config.schemaLocator = {
    ...locator,
    cwd,
    sourceDir: config.sourceDir,
  };
  config.schemaLoadMode = normalizeSchemaLoadMode(rawOptions.load ?? 'data');

  resolveOutputPaths(config, cwd);
}

function resolveConfiguredSourceDir(config: ConfigRecord, context: ResolveConfigContext): string {
  const {
    rawOptions,
    locator,
    cwd,
    userConfig,
    inlineOptions,
  } = context;

  const hasInlineSourceDir = hasOwnConfigValue(inlineOptions, 'sourceDir') || hasOwnConfigValue(inlineOptions, 'dbDir');
  const hasUserSourceDir = hasOwnConfigValue(userConfig, 'sourceDir') || hasOwnConfigValue(userConfig, 'dbDir');
  const sourceDir = hasInlineSourceDir
    ? (hasOwnConfigValue(inlineOptions, 'sourceDir') ? config.sourceDir : config.dbDir)
    : rawOptions.from
      ? locator.sourceDir
      : hasUserSourceDir
        ? (hasOwnConfigValue(userConfig, 'sourceDir') ? config.sourceDir : config.dbDir)
        : config.dbDir;

  return resolveFrom(cwd, sourceDir);
}

function resolveOutputPaths(config: ConfigRecord, cwd: string): void {
  config.stateDir = resolveFrom(cwd, config.stateDir);
  config.outputs.stateDir = config.stateDir;

  if (config.types?.outFile) {
    config.types.outFile = resolveFrom(cwd, config.types.outFile);
  }
  config.outputs.types = config.types?.outFile ?? null;

  if (config.types?.commitOutFile) {
    config.types.commitOutFile = resolveFrom(cwd, config.types.commitOutFile);
  }
  config.outputs.committedTypes = config.types?.commitOutFile ?? null;

  if (config.schemaOutFile) {
    config.schemaOutFile = resolveFrom(cwd, config.schemaOutFile);
  }
  config.outputs.schemaManifest = config.schemaOutFile ?? null;

  if (config.viewerManifestOutFile) {
    config.viewerManifestOutFile = resolveFrom(cwd, config.viewerManifestOutFile);
  }
  config.outputs.viewerManifest = config.viewerManifestOutFile ?? null;

  if (config.operations?.sourceDir) {
    config.operations.sourceDir = resolveFrom(cwd, config.operations.sourceDir);
  }

  if (config.operations?.outFile) {
    config.operations.outFile = resolveFrom(cwd, config.operations.outFile);
  }
  config.outputs.operationRegistry = config.operations?.outFile ?? null;

  if (config.operations?.refsOutFile) {
    config.operations.refsOutFile = resolveFrom(cwd, config.operations.refsOutFile);
  }
  config.outputs.operationRefs = config.operations?.refsOutFile ?? null;

  if (config.outputs?.contractRefs) {
    config.outputs.contractRefs = resolveFrom(cwd, config.outputs.contractRefs);
  }

  if (config.generate?.hono?.outDir) {
    config.generate.hono.outDir = resolveFrom(cwd, config.generate.hono.outDir);
  }
  config.outputs.honoStarterDir = config.generate?.hono?.outDir ?? null;
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

async function findConfigPath(cwd: string, fs: DbFileSystem): Promise<string | null> {
  for (const filename of ['db.config.mjs', 'db.config.js']) {
    const candidate = path.join(cwd, filename);
    try {
      await fs.access(candidate);
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

function rejectRemovedFixtureForkConfig(config: unknown): void {
  if (!isPlainObject(config)) {
    return;
  }

  for (const key of ['forks', 'templates']) {
    if (!hasOwnConfigValue(config, key)) {
      continue;
    }

    throw dbError(
      'CONFIG_LEGACY_FIXTURE_FORKS_REMOVED',
      `Unsupported config "${key}". Fixture-folder forks were removed so forks only mean runtime logical databases.`,
      {
        hint: 'Use runtime forks with db.forks.create(), db.forks.open(), db.forks.ensure(), branches, and snapshots. Keep alternate seed data in normal fixture folders or app-owned import scripts.',
        details: {
          configKey: key,
        },
      },
    );
  }
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
