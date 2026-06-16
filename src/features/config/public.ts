type PlainObject = Record<string, unknown>;
type ResourceNamingStrategy = 'basename' | 'folder-prefixed' | 'path';
type EnvVarMap = Record<string, unknown>;

export type ParsedFixturePath = {
  file: string;
  folders: string[];
  folder: string | null;
  filename: string;
  basename: string;
  extension: string;
};

export type DbEnvVarRef = {
  kind: 'async-db.env.var';
  name: string;
  values?: EnvVarMap;
  default?: string;
};

export type DbEnvSecretRef = {
  kind: 'async-db.env.secret';
  name: string;
};

export function defineConfig<TConfig extends PlainObject>(config: TConfig): TConfig {
  return config;
}

function envVar(name: string): DbEnvVarRef;
function envVar(name: string, options: { default: string }): DbEnvVarRef;
function envVar(name: string, values: EnvVarMap, options?: { default?: string }): DbEnvVarRef;
function envVar(name: string, valuesOrOptions?: EnvVarMap | { default: string }, options: { default?: string } = {}): DbEnvVarRef {
  if (!valuesOrOptions) {
    return { kind: 'async-db.env.var', name };
  }

  if (isDefaultOnlyEnvOptions(valuesOrOptions)) {
    return { kind: 'async-db.env.var', name, default: valuesOrOptions.default };
  }

  return {
    kind: 'async-db.env.var',
    name,
    values: { ...valuesOrOptions },
    default: options.default,
  };
}

export const env = {
  var: envVar,
  secret(name: string): DbEnvSecretRef {
    return { kind: 'async-db.env.secret', name };
  },
};

export function mergeManifest(base: unknown, patch: unknown): unknown {
  return mergePlainObjects(structuredClone(base), patch);
}

export function resourceNameFromPath(file: string, options: { strategy?: ResourceNamingStrategy } = {}): string {
  const strategy = options.strategy ?? 'basename';
  const parsed = parseFixturePath(file);
  const parts = strategy === 'basename'
    ? [parsed.basename]
    : strategy === 'folder-prefixed'
      ? [...parsed.folders.slice(-1), parsed.basename]
      : [...parsed.folders, parsed.basename];

  return camelCase(parts.filter(Boolean).join('-'));
}

export function parseFixturePath(file: string): ParsedFixturePath {
  const normalized = String(file).split('\\').join('/');
  const parts = normalized.split('/').filter(Boolean);
  const filename = parts.at(-1) ?? '';
  const extension = fixtureExtension(filename);
  const folders = parts.slice(1, -1);
  const basename = extension ? filename.slice(0, -extension.length) : filename;

  return {
    file: normalized,
    folders,
    folder: folders.at(-1) ?? null,
    filename,
    basename,
    extension,
  };
}

function mergePlainObjects(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return structuredClone(patch);
  }

  const output: PlainObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergePlainObjects(output[key], value);
      continue;
    }

    output[key] = structuredClone(value);
  }

  return output;
}

function isPlainObject(value: unknown): value is PlainObject {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isDefaultOnlyEnvOptions(value: EnvVarMap | { default: string }): value is { default: string } {
  return Object.keys(value).length === 1 && typeof value.default === 'string';
}

function camelCase(value: string): string {
  const words = String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());

  return words.map((word, index) => (
    index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`
  )).join('');
}

function fixtureExtension(filename: string): string {
  const schemaMatch = filename.match(/\.schema\.(json|jsonc|mjs|js)$/i);
  if (schemaMatch) {
    return `.schema.${schemaMatch[1].toLowerCase()}`;
  }

  const dataMatch = filename.match(/\.(json|jsonc|csv)$/i);
  if (dataMatch) {
    return `.${dataMatch[1].toLowerCase()}`;
  }

  const genericMatch = filename.match(/(\.[^./\\]+)$/);
  return genericMatch ? genericMatch[1].toLowerCase() : '';
}
