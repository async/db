import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveFrom } from '../../fs-utils.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { normalizeForks } from './forks.js';

export async function loadConfig(options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const configPath = options.configPath
    ? resolveFrom(cwd, options.configPath)
    : await findConfigPath(cwd);

  let userConfig = {};
  if (configPath) {
    const url = pathToFileURL(configPath);
    url.searchParams.set('jsondbConfigLoad', String(Date.now()));
    const module = await import(url.href);
    userConfig = module.default ?? module.config ?? {};
  }

  const inlineOptions = { ...options };
  delete inlineOptions.cwd;
  delete inlineOptions.configPath;

  rejectUnsupportedRuntimeConfig(userConfig);
  rejectUnsupportedRuntimeConfig(inlineOptions);

  const merged = mergeDeep(mergeDeep(structuredClone(DEFAULT_CONFIG), userConfig), inlineOptions);
  merged.cwd = cwd;
  merged.configPath = configPath;
  const sourceDir = hasOwnConfigValue(userConfig, 'sourceDir') || hasOwnConfigValue(inlineOptions, 'sourceDir')
    ? merged.sourceDir
    : merged.dbDir;
  merged.sourceDir = resolveFrom(cwd, sourceDir);
  merged.dbDir = merged.sourceDir;
  merged.stateDir = resolveFrom(cwd, merged.stateDir);

  if (merged.types?.outFile) {
    merged.types.outFile = resolveFrom(cwd, merged.types.outFile);
  }

  if (merged.types?.commitOutFile) {
    merged.types.commitOutFile = resolveFrom(cwd, merged.types.commitOutFile);
  }

  if (merged.schemaOutFile) {
    merged.schemaOutFile = resolveFrom(cwd, merged.schemaOutFile);
  }

  merged.forks = normalizeForks(merged, merged.forks);

  return merged;
}

async function findConfigPath(cwd) {
  for (const filename of ['jsondb.config.mjs', 'jsondb.config.js']) {
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

export function mergeDeep(base, override) {
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnConfigValue(config, key) {
  return Object.prototype.hasOwnProperty.call(config, key) && config[key] !== undefined;
}

function rejectUnsupportedRuntimeConfig(config) {
  const diagnostics = unsupportedRuntimeConfigDiagnostics(config);
  if (diagnostics.length === 0) {
    return;
  }

  const error = new Error(diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  error.code = 'CONFIG_UNSUPPORTED_RUNTIME_BOUNDARY';
  error.diagnostics = diagnostics;
  throw error;
}

function unsupportedRuntimeConfigDiagnostics(config) {
  if (!isPlainObject(config)) {
    return [];
  }

  const diagnostics = [];
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

function unsupportedRuntimeConfigDiagnostic(configPath) {
  return {
    code: 'CONFIG_UNSUPPORTED_RUNTIME_BOUNDARY',
    severity: 'error',
    path: configPath,
    message: `Unsupported runtime config at "${configPath}". Runtime config is no longer a public configuration boundary.`,
    hint: 'Use stores.default, named stores, and resources.<name>.store to configure the public storage boundary.',
  };
}
