import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { dbError } from '../../errors.js';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';
import { resolveFrom } from '../../fs-utils.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { applyLifecycleToConfig, readLifecycleFile } from './lifecycle.js';
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
  profileConfig: ConfigRecord;
  inlineOptions: ConfigRecord;
};

type OutputPathResolution = {
  configPath: ConfigPath;
  outputPath?: ConfigPath;
};

const OUTPUT_PATH_RESOLUTIONS: readonly OutputPathResolution[] = [
  { configPath: ['stateDir'], outputPath: ['outputs', 'stateDir'] },
  { configPath: ['types', 'outFile'], outputPath: ['outputs', 'types'] },
  { configPath: ['types', 'commitOutFile'], outputPath: ['outputs', 'committedTypes'] },
  { configPath: ['schemaOutFile'], outputPath: ['outputs', 'schemaManifest'] },
  { configPath: ['viewerManifestOutFile'], outputPath: ['outputs', 'viewerManifest'] },
  { configPath: ['operations', 'sourceDir'] },
  { configPath: ['operations', 'outFile'], outputPath: ['outputs', 'operationRegistry'] },
  { configPath: ['operations', 'refsOutFile'], outputPath: ['outputs', 'operationRefs'] },
  { configPath: ['outputs', 'contractRefs'] },
  { configPath: ['generate', 'hono', 'outDir'], outputPath: ['outputs', 'honoStarterDir'] },
];

type UnsupportedRuntimeConfigDiagnostic = {
  code: 'CONFIG_UNSUPPORTED_RUNTIME_BOUNDARY';
  severity: 'error';
  path: string;
  message: string;
  hint: string;
};

type ConfigLoadError = Error & {
  code?: string;
  diagnostics?: Array<UnsupportedRuntimeConfigDiagnostic | ProfileConfigDiagnostic>;
};

type ProfileConfigDiagnostic = {
  code: 'CONFIG_PROFILE_INVALID';
  severity: 'error';
  path: string;
  message: string;
  hint: string;
};

type EnvVarRef = {
  kind: 'async-db.env.var';
  name: string;
  values?: Record<string, unknown>;
  default?: string;
};

type EnvSecretRef = {
  kind: 'async-db.env.secret';
  name: string;
};

type PackageInfo = {
  file: string;
  type: string | null;
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
  rejectInvalidProfiles(userConfig, inlineOptions);

  const profileConfig = selectedProfileConfig(userConfig, inlineOptions);
  const merged = mergeConfig(userConfig, profileConfig, inlineOptions);
  applyLifecycleToConfig(merged, await readLifecycleFile(cwd, fs));
  finalizeProfileConfig(merged, profileConfig);
  resolveEnvConfigValues(merged);
  resolveConfigPaths(merged, {
    rawOptions,
    locator,
    cwd,
    configPath,
    userConfig,
    profileConfig,
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

  try {
    await assertConfigJsModuleContext(configPath);
    const url = pathToFileURL(configPath);
    url.searchParams.set('dbConfigLoad', String(Date.now()));
    const module = await import(url.href);
    return module.default ?? module.config ?? {};
  } catch (error) {
    throw configLoadError(configPath, error);
  }
}

function configLoadError(configPath: string, error: unknown): Error {
  const loadError = error as Error & { code?: string };
  if (!configPath.endsWith('.js') || !isModuleContextError(loadError)) {
    return loadError;
  }

  return configJsModuleError(configPath, {
    parserMessage: loadError.message,
    code: loadError.code,
  });
}

async function assertConfigJsModuleContext(configPath: string): Promise<void> {
  if (!configPath.endsWith('.js')) {
    return;
  }

  const nearestPackage = await nearestPackageInfo(path.dirname(configPath));
  if (nearestPackage?.type === 'module') {
    return;
  }

  throw configJsModuleError(configPath, {
    packageFile: nearestPackage?.file ?? null,
    packageType: nearestPackage?.type ?? null,
  });
}

function configJsModuleError(
  configPath: string,
  details: Record<string, unknown>,
): Error {
  return dbError(
    'DB_CONFIG_JS_REQUIRES_MODULE',
    `JavaScript config files require ESM module context: ${path.basename(configPath)}.`,
    {
      hint: 'Add "type": "module" to the nearest package.json, or move db.config.js and imported .js files under an ESM package boundary.',
      details: {
        path: configPath,
        ...details,
      },
    },
  );
}

function isModuleContextError(error: Error & { code?: string }): boolean {
  const message = String(error.message ?? '');
  return error.code === 'ERR_REQUIRE_ESM'
    || message.includes('Cannot use import statement outside a module')
    || message.includes('Unexpected token \'export\'')
    || message.includes('Unexpected token "export"')
    || message.includes('Named export')
    || message.includes('CommonJS module');
}

async function nearestPackageInfo(directory: string): Promise<PackageInfo | null> {
  let current = path.resolve(directory);
  while (true) {
    const packageFile = path.join(current, 'package.json');
    const info = await packageInfo(packageFile);
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

async function packageInfo(packageFile: string): Promise<PackageInfo | null> {
  try {
    const json = JSON.parse(await readFile(packageFile, 'utf8'));
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

function mergeConfig(userConfig: ConfigRecord, profileConfig: ConfigRecord, inlineOptions: ConfigRecord): ConfigRecord {
  const merged = mergeDeep(mergeDeep(mergeDeep(structuredClone(DEFAULT_CONFIG), userConfig), profileConfig), inlineOptions) as ConfigRecord;
  normalizeOutputAliases(merged, userConfig, profileConfig, inlineOptions);
  return merged;
}

function selectedProfileConfig(userConfig: ConfigRecord, inlineOptions: ConfigRecord): ConfigRecord {
  const profiles = mergedProfiles(userConfig, inlineOptions);
  const profileValue = hasOwnConfigValue(inlineOptions, 'profile')
    ? inlineOptions.profile
    : userConfig.profile;
  const profile = resolveProfileValue(profileValue);

  if (!profile) {
    return {};
  }

  const profileConfig = profiles[profile];
  if (!isPlainObject(profileConfig)) {
    throw dbError(
      'CONFIG_PROFILE_NOT_FOUND',
      `Config profile "${profile}" was not found.`,
      {
        hint: 'Declare the profile under profiles, or choose one of the known profile names.',
        details: {
          profile,
          knownProfiles: Object.keys(profiles),
        },
      },
    );
  }

  return profileConfig;
}

function mergedProfiles(userConfig: ConfigRecord, inlineOptions: ConfigRecord): Record<string, unknown> {
  const userProfiles = isPlainObject(userConfig.profiles) ? userConfig.profiles : {};
  const inlineProfiles = isPlainObject(inlineOptions.profiles) ? inlineOptions.profiles : {};
  return mergeDeep(userProfiles, inlineProfiles) as Record<string, unknown>;
}

function resolveProfileValue(value: unknown): string | null {
  const resolved = isEnvVarRef(value)
    ? resolveEnvVarRef(value)
    : value;

  if (resolved === undefined || resolved === null || resolved === '') {
    return null;
  }

  if (typeof resolved !== 'string') {
    throw dbError(
      'CONFIG_PROFILE_INVALID',
      'Config profile must resolve to a string.',
      {
        hint: 'Use profile: "name" or profile: env.var("ASYNC_DB_PROFILE", { default: "name" }).',
        details: {
          profileType: typeof resolved,
        },
      },
    );
  }

  return resolved;
}

function finalizeProfileConfig(config: ConfigRecord, profileConfig: ConfigRecord): void {
  const selectedProfile = resolveProfileValue(config.profile);
  if (selectedProfile) {
    config.profile = selectedProfile;
  } else {
    delete config.profile;
  }
  delete config.profiles;
  rejectUnsupportedRuntimeConfig(profileConfig);
  rejectRemovedFixtureForkConfig(profileConfig);
}

function resolveEnvConfigValues(config: ConfigRecord): void {
  for (const [key, value] of Object.entries(config)) {
    config[key] = resolveEnvConfigValue(value);
  }
}

function resolveEnvConfigValue(value: unknown): unknown {
  if (isEnvVarRef(value)) {
    return resolveEnvVarRef(value);
  }

  if (isEnvSecretRef(value)) {
    return resolveEnvSecretRef(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveEnvConfigValue(entry));
  }

  if (!isEnvConfigContainer(value)) {
    return value;
  }

  const output: ConfigRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = resolveEnvConfigValue(entry);
  }
  return output;
}

function resolveEnvVarRef(ref: EnvVarRef): unknown {
  const raw = process.env[ref.name] ?? ref.default;
  if (raw === undefined) {
    throw dbError(
      'CONFIG_ENV_VAR_MISSING',
      `Environment variable "${ref.name}" is required for db config.`,
      {
        hint: `Set ${ref.name}, or provide env.var("${ref.name}", { default: "..." }).`,
        details: {
          name: ref.name,
        },
      },
    );
  }

  if (ref.values) {
    if (Object.prototype.hasOwnProperty.call(ref.values, raw)) {
      return ref.values[raw];
    }

    throw dbError(
      'CONFIG_ENV_VAR_UNMAPPED',
      `Environment variable "${ref.name}" resolved to an unmapped value.`,
      {
        hint: 'Add the value to the env.var mapping, change the environment variable, or provide a mapped default.',
        details: {
          name: ref.name,
          value: raw,
          knownValues: Object.keys(ref.values),
        },
      },
    );
  }

  return raw;
}

function resolveEnvSecretRef(ref: EnvSecretRef): string {
  const value = process.env[ref.name];
  if (value === undefined) {
    throw dbError(
      'CONFIG_ENV_SECRET_MISSING',
      `Environment secret "${ref.name}" is required for db config.`,
      {
        hint: `Set ${ref.name} in the runtime environment. Secret values are never printed in config diagnostics.`,
        details: {
          name: ref.name,
          secret: true,
          value: '<redacted>',
        },
      },
    );
  }

  return value;
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
    profileConfig,
    inlineOptions,
  } = context;

  return resolveFrom(cwd, configuredSourceDirValue({
    config,
    rawOptions,
    locator,
    userConfig,
    profileConfig,
    inlineOptions,
  }));
}

function configuredSourceDirValue({
  config,
  rawOptions,
  locator,
  userConfig,
  profileConfig,
  inlineOptions,
}: {
  config: ConfigRecord;
  rawOptions: NormalizedLoadConfigOptions;
  locator: SchemaLocatorResult;
  userConfig: ConfigRecord;
  profileConfig: ConfigRecord;
  inlineOptions: ConfigRecord;
}): string {
  if (hasSourceDirOverride(inlineOptions)) {
    return selectedSourceDir(config, inlineOptions);
  }

  if (rawOptions.from) {
    return locator.sourceDir;
  }

  if (hasSourceDirOverride(profileConfig)) {
    return selectedSourceDir(config, profileConfig);
  }

  if (hasSourceDirOverride(userConfig)) {
    return selectedSourceDir(config, userConfig);
  }

  return config.dbDir;
}

function hasSourceDirOverride(config: ConfigRecord): boolean {
  return hasOwnConfigValue(config, 'sourceDir') || hasOwnConfigValue(config, 'dbDir');
}

function selectedSourceDir(config: ConfigRecord, sourceConfig: ConfigRecord): string {
  return hasOwnConfigValue(sourceConfig, 'sourceDir') ? config.sourceDir : config.dbDir;
}

function resolveOutputPaths(config: ConfigRecord, cwd: string): void {
  for (const resolution of OUTPUT_PATH_RESOLUTIONS) {
    const value = resolvePathValue(config, resolution.configPath, cwd);
    if (resolution.outputPath) {
      setPath(config, resolution.outputPath, value ?? null);
    }
  }
}

function resolvePathValue(config: ConfigRecord, configPath: ConfigPath, cwd: string): unknown {
  const value = getPath(config, configPath);
  if (!value) {
    return value;
  }

  const resolved = resolveFrom(cwd, value as string);
  setPath(config, configPath, resolved);
  return resolved;
}

function normalizeOutputAliases(config: ConfigRecord, userConfig: ConfigRecord, profileConfig: ConfigRecord, inlineOptions: ConfigRecord): void {
  config.outputs = config.outputs ?? {};
  config.types = config.types ?? {};
  config.operations = config.operations ?? {};
  config.generate = config.generate ?? {};
  config.generate.hono = config.generate.hono ?? {};

  mirrorOutput(config, userConfig, profileConfig, inlineOptions, 'stateDir', ['stateDir']);
  mirrorOutput(config, userConfig, profileConfig, inlineOptions, 'types', ['types', 'outFile']);
  mirrorOutput(config, userConfig, profileConfig, inlineOptions, 'committedTypes', ['types', 'commitOutFile']);
  mirrorOutput(config, userConfig, profileConfig, inlineOptions, 'schemaManifest', ['schemaOutFile']);
  mirrorOutput(config, userConfig, profileConfig, inlineOptions, 'viewerManifest', ['viewerManifestOutFile']);
  mirrorOutput(config, userConfig, profileConfig, inlineOptions, 'operationRegistry', ['operations', 'outFile']);
  mirrorOutput(config, userConfig, profileConfig, inlineOptions, 'operationRefs', ['operations', 'refsOutFile']);
  mirrorOutput(config, userConfig, profileConfig, inlineOptions, 'honoStarterDir', ['generate', 'hono', 'outDir']);
}

function mirrorOutput(
  config: ConfigRecord,
  userConfig: ConfigRecord,
  profileConfig: ConfigRecord,
  inlineOptions: ConfigRecord,
  outputKey: string,
  legacyPath: ConfigPath,
): void {
  const outputPath = ['outputs', outputKey];
  const value = configuredOutputValue({
    config,
    userConfig,
    profileConfig,
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
  profileConfig,
  inlineOptions,
  outputPath,
  legacyPath,
}: {
  config: ConfigRecord;
  userConfig: ConfigRecord;
  profileConfig: ConfigRecord;
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

  if (hasOwnPath(profileConfig, outputPath)) {
    return getPath(profileConfig, outputPath);
  }

  if (hasOwnPath(profileConfig, legacyPath)) {
    return getPath(profileConfig, legacyPath);
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
  for (const filename of ['db.config.js', 'db.config.mjs']) {
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

function mergeDeep(base: unknown, override: unknown): unknown {
  if (!areMergeableRecords(base, override)) {
    return override === undefined ? base : override;
  }

  return mergeRecords(base, override);
}

function areMergeableRecords(base: unknown, override: unknown): base is ConfigRecord {
  return isPlainObject(base) && isPlainObject(override);
}

function mergeRecords(base: ConfigRecord, override: ConfigRecord): ConfigRecord {
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    mergeRecordValue(output, key, value);
  }

  return output;
}

function mergeRecordValue(output: ConfigRecord, key: string, value: unknown): void {
  if (value === undefined) {
    return;
  }

  output[key] = isPlainObject(value) && isPlainObject(output[key])
    ? mergeDeep(output[key], value)
    : value;
}

function isPlainObject(value: unknown): value is ConfigRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEnvConfigContainer(value: unknown): value is ConfigRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
      `Unsupported config "${key}". Legacy data-folder forks were removed so forks only mean runtime logical databases.`,
      {
        hint: 'Use runtime forks with db.forks.create(), db.forks.open(), db.forks.ensure(), branches, and snapshots. Keep alternate seed data in normal data folders or app-owned import scripts.',
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

function rejectInvalidProfiles(userConfig: ConfigRecord, inlineOptions: ConfigRecord): void {
  const diagnostics = [
    ...profileConfigDiagnostics(userConfig.profiles, 'profiles'),
    ...profileConfigDiagnostics(inlineOptions.profiles, 'profiles'),
  ];

  if (diagnostics.length === 0) {
    return;
  }

  const error = new Error(diagnostics.map((diagnostic) => diagnostic.message).join('\n')) as ConfigLoadError;
  error.code = diagnostics[0].code;
  error.diagnostics = diagnostics;
  throw error;
}

function profileConfigDiagnostics(profiles: unknown, pathPrefix: string): Array<ProfileConfigDiagnostic | UnsupportedRuntimeConfigDiagnostic> {
  if (profiles === undefined) {
    return [];
  }

  if (!isPlainObject(profiles)) {
    return [profileDiagnostic(pathPrefix, 'Config profiles must be an object keyed by profile name.')];
  }

  const diagnostics: Array<ProfileConfigDiagnostic | UnsupportedRuntimeConfigDiagnostic> = [];
  for (const [profileName, profileConfig] of Object.entries(profiles)) {
    const profilePath = `${pathPrefix}.${profileName}`;
    if (!isPlainObject(profileConfig)) {
      diagnostics.push(profileDiagnostic(profilePath, `Config profile "${profileName}" must be an object.`));
      continue;
    }

    for (const key of ['cwd', 'configPath', 'from', 'fs', 'profile', 'profiles']) {
      if (hasOwnConfigValue(profileConfig, key)) {
        diagnostics.push(profileDiagnostic(
          `${profilePath}.${key}`,
          `Config profile "${profileName}" cannot set loader context key "${key}".`,
        ));
      }
    }

    diagnostics.push(...unsupportedRuntimeConfigDiagnostics(profileConfig).map((diagnostic) => ({
      ...diagnostic,
      path: `${profilePath}.${diagnostic.path}`,
    })));
  }

  return diagnostics;
}

function profileDiagnostic(pathValue: string, message: string): ProfileConfigDiagnostic {
  return {
    code: 'CONFIG_PROFILE_INVALID',
    severity: 'error',
    path: pathValue,
    message,
    hint: 'Profiles may override static db policy, but loader context belongs to the caller and top-level config.',
  };
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
  const hint = configPath === 'mode'
    ? 'Use top-level profile/profiles for named config policy bundles. Use scoped mode only inside feature APIs such as validators, imports, and migrations.'
    : 'Use stores.default, named stores, and resources.<name>.store to configure the public storage boundary.';

  return {
    code: 'CONFIG_UNSUPPORTED_RUNTIME_BOUNDARY',
    severity: 'error',
    path: configPath,
    message: `Unsupported runtime config at "${configPath}". Runtime config is no longer a public configuration boundary.`,
    hint,
  };
}

function isEnvVarRef(value: unknown): value is EnvVarRef {
  return isPlainObject(value)
    && value.kind === 'async-db.env.var'
    && typeof value.name === 'string';
}

function isEnvSecretRef(value: unknown): value is EnvSecretRef {
  return isPlainObject(value)
    && value.kind === 'async-db.env.secret'
    && typeof value.name === 'string';
}
