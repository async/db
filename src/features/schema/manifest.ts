import path from 'node:path';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';
import { resolveFrom, writeText } from '../../fs-utils.js';
import type { SchemaField } from './fields.js';
import { loadProjectSchema } from './project.js';

type ResourceKind = 'collection' | 'document';

type ManifestDiagnostic = {
  code: string;
  severity: 'error' | 'warn' | 'info';
  resource?: string;
  field?: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
};

type SchemaResource = {
  kind: ResourceKind;
  name: string;
  idField?: string;
  description?: string;
  fields?: Record<string, SchemaField>;
  schemaPath?: string | null;
  dataPath?: string | null;
};

type SchemaProject = {
  resources: SchemaResource[];
  diagnostics: ManifestDiagnostic[];
};

type FieldUiManifest = Record<string, unknown> & {
  label: string;
  component: string;
  readonly?: boolean;
  optionsFrom?: string;
};

type FieldManifest = Record<string, unknown> & {
  type: string;
  required: boolean;
  nullable: boolean;
  items?: FieldManifest;
  fields?: Record<string, unknown>;
  variants?: Record<string, VariantManifest>;
  ui?: FieldUiManifest;
};

type VariantManifest = Record<string, unknown> & {
  fields: Record<string, unknown>;
  additionalProperties?: boolean;
};

type ResourceManifest = Record<string, unknown> & {
  kind: ResourceKind;
  name: string;
  fields: Record<string, unknown>;
  description?: string;
  idField?: string;
};

type SchemaManifest = {
  version: 1;
  collections: Record<string, unknown>;
  documents: Record<string, unknown>;
};

type ResourceCustomizeContext = {
  resource: SchemaResource;
  resourceName: string;
  file: string | null;
  sourceFile: string | null;
  defaultManifest: ResourceManifest;
};

type FieldCustomizeContext = {
  field: SchemaField;
  fieldName: string;
  resource: SchemaResource;
  resourceName: string;
  path: string;
  file: string | null;
  sourceFile: string | null;
  defaultManifest: FieldManifest;
};

type SchemaManifestConfig = {
  cwd?: string;
  schemaOutFile?: string | null;
  fs?: DbFileSystem;
  schemaManifest?: {
    customizeResource?: (context: ResourceCustomizeContext) => unknown;
    customizeField?: (context: FieldCustomizeContext) => unknown;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

type GenerateSchemaManifestOptions = {
  project?: unknown;
  outFile?: string | null;
};

type GenerateSchemaManifestResult = {
  manifest: SchemaManifest;
  content: string;
  outFiles: string[];
  diagnostics: ManifestDiagnostic[];
};

const FIELD_MANIFEST_PROPERTIES = [
  'description',
  'default',
  'computed',
  'readOnly',
  'derived',
  'tags',
  'visibility',
  'values',
  'relation',
  'unique',
  'min',
  'max',
  'minLength',
  'maxLength',
  'pattern',
  'additionalProperties',
  'discriminator',
] as const;

const ITEM_MANIFEST_PROPERTIES = [
  'description',
  'default',
  'derived',
  'tags',
  'visibility',
  'values',
  'relation',
  'unique',
  'min',
  'max',
  'minLength',
  'maxLength',
  'pattern',
  'additionalProperties',
  'discriminator',
] as const;

export async function generateSchemaManifest(
  config: SchemaManifestConfig,
  options: GenerateSchemaManifestOptions = {},
): Promise<GenerateSchemaManifestResult> {
  const project = (options.project ?? await loadProjectSchema(config)) as SchemaProject;
  const manifest = renderSchemaManifest(project.resources, config);
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const outFiles = outputFiles(config, options);

  for (const outFile of outFiles) {
    await writeText(outFile, content, dbFileSystem(config));
  }

  return {
    manifest,
    content,
    outFiles,
    diagnostics: project.diagnostics,
  };
}

export function renderSchemaManifest(resources: SchemaResource[], config: SchemaManifestConfig = {}): SchemaManifest {
  const diagnostics: ManifestDiagnostic[] = [];
  const manifest: SchemaManifest = {
    version: 1,
    collections: {},
    documents: {},
  };

  for (const resource of resources) {
    const bucket = resource.kind === 'document' ? manifest.documents : manifest.collections;
    bucket[resource.name] = resourceManifest(resource, config, diagnostics);
  }

  if (diagnostics.length > 0) {
    throw manifestDiagnosticsError(diagnostics);
  }

  return manifest;
}

function outputFiles(config: SchemaManifestConfig, options: GenerateSchemaManifestOptions): string[] {
  const outFile = options.outFile
    ? resolveFrom(config.cwd, options.outFile)
    : config.schemaOutFile;
  return outFile ? [outFile] : [];
}

function resourceManifest(
  resource: SchemaResource,
  config: SchemaManifestConfig,
  diagnostics: ManifestDiagnostic[],
): unknown {
  const defaultManifest: ResourceManifest = {
    kind: resource.kind,
    name: resource.name,
    fields: renderFieldMap(resource.fields ?? {}, resource, config, diagnostics, ''),
  };

  if (resource.description) {
    defaultManifest.description = resource.description;
  }

  if (resource.kind === 'collection') {
    defaultManifest.idField = resource.idField;
  }

  return customizeResourceManifest(resource, config, diagnostics, defaultManifest);
}

function customizeResourceManifest(
  resource: SchemaResource,
  config: SchemaManifestConfig,
  diagnostics: ManifestDiagnostic[],
  defaultManifest: ResourceManifest,
): unknown {
  const customizeResource = config.schemaManifest?.customizeResource;
  const sourceFile = resource.schemaPath ?? resource.dataPath ?? null;

  if (typeof customizeResource !== 'function') {
    return defaultManifest;
  }

  let customized;
  try {
    customized = customizeResource({
      resource,
      resourceName: resource.name,
      file: sourceFile ? path.relative(config.cwd, sourceFile) : null,
      sourceFile,
      defaultManifest: structuredClone(defaultManifest),
    });
  } catch (error) {
    diagnostics.push({
      code: 'SCHEMA_MANIFEST_RESOURCE_CUSTOMIZE_FAILED',
      severity: 'error',
      resource: resource.name,
      message: `Could not customize schema manifest resource "${resource.name}": ${error.message}`,
      hint: 'Update schemaManifest.customizeResource so it returns a JSON-serializable resource manifest.',
      details: {
        resource: resource.name,
      },
    });
    return defaultManifest;
  }

  const serializablePath = firstNonSerializablePath(customized);
  if (serializablePath) {
    diagnostics.push(nonSerializableResourceDiagnostic(resource, serializablePath));
    return defaultManifest;
  }

  return customized;
}

function renderFieldMap(
  fields: Record<string, SchemaField>,
  resource: SchemaResource,
  config: SchemaManifestConfig,
  diagnostics: ManifestDiagnostic[],
  parentPath: string,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [fieldName, field] of Object.entries(fields)) {
    const fieldPath = parentPath ? `${parentPath}.${fieldName}` : fieldName;
    const fieldManifest = renderFieldManifest(fieldName, field, resource, config, diagnostics, fieldPath);
    if (fieldManifest !== null) {
      output[fieldName] = fieldManifest;
    }
  }
  return output;
}

function renderFieldManifest(
  fieldName: string,
  field: SchemaField,
  resource: SchemaResource,
  config: SchemaManifestConfig,
  diagnostics: ManifestDiagnostic[],
  fieldPath: string,
): unknown | null {
  const defaultManifest = defaultFieldManifest(fieldName, field, resource, config, diagnostics, fieldPath);
  const customizeField = config.schemaManifest?.customizeField;
  const sourceFile = resource.schemaPath ?? resource.dataPath ?? null;

  if (typeof customizeField !== 'function') {
    return defaultManifest;
  }

  let customized;
  try {
    customized = customizeField({
      field,
      fieldName,
      resource,
      resourceName: resource.name,
      path: fieldPath,
      file: sourceFile ? path.relative(config.cwd, sourceFile) : null,
      sourceFile,
      defaultManifest: structuredClone(defaultManifest),
    });
  } catch (error) {
    diagnostics.push({
      code: 'SCHEMA_MANIFEST_FIELD_CUSTOMIZE_FAILED',
      severity: 'error',
      resource: resource.name,
      field: fieldPath,
      message: `Could not customize schema manifest field "${resource.name}.${fieldPath}": ${error.message}`,
      hint: 'Update schemaManifest.customizeField so it returns a JSON-serializable field manifest or null.',
      details: {
        resource: resource.name,
        field: fieldPath,
      },
    });
    return defaultManifest;
  }

  if (customized === null) {
    return null;
  }

  const serializablePath = firstNonSerializablePath(customized);
  if (serializablePath) {
    diagnostics.push(nonSerializableDiagnostic(resource, fieldPath, serializablePath));
    return defaultManifest;
  }

  return customized;
}

function defaultFieldManifest(
  fieldName: string,
  field: SchemaField,
  resource: SchemaResource,
  config: SchemaManifestConfig,
  diagnostics: ManifestDiagnostic[],
  fieldPath: string,
): FieldManifest {
  const manifest: FieldManifest = {
    type: field.type ?? 'unknown',
    required: Boolean(field.required),
    nullable: Boolean(field.nullable),
  };

  for (const property of FIELD_MANIFEST_PROPERTIES) {
    if (property in field) {
      manifest[property] = structuredClone(field[property]);
    }
  }

  if (field.type === 'array') {
    manifest.items = itemManifest(field.items ?? { type: 'unknown' }, resource, config, diagnostics, fieldPath);
  }

  if (field.type === 'object' && field.fields && typeof field.fields === 'object') {
    manifest.fields = renderFieldMap(field.fields, resource, config, diagnostics, fieldPath);
  }

  if (field.type === 'object' && field.variants && typeof field.variants === 'object') {
    manifest.variants = variantManifestMap(field.variants, resource, config, diagnostics, fieldPath);
  }

  manifest.ui = inferFieldUi(fieldName, field, resource, fieldPath);
  return manifest;
}

function itemManifest(
  field: SchemaField,
  resource: SchemaResource,
  config: SchemaManifestConfig,
  diagnostics: ManifestDiagnostic[],
  fieldPath: string,
): FieldManifest {
  const manifest: FieldManifest = {
    type: field.type ?? 'unknown',
    required: Boolean(field.required),
    nullable: Boolean(field.nullable),
  };

  for (const property of ITEM_MANIFEST_PROPERTIES) {
    if (property in field) {
      manifest[property] = structuredClone(field[property]);
    }
  }

  if (field.type === 'array') {
    manifest.items = itemManifest(field.items ?? { type: 'unknown' }, resource, config, diagnostics, fieldPath);
  }

  if (field.type === 'object' && field.fields && typeof field.fields === 'object') {
    manifest.fields = renderFieldMap(field.fields, resource, config, diagnostics, fieldPath);
  }

  if (field.type === 'object' && field.variants && typeof field.variants === 'object') {
    manifest.variants = variantManifestMap(field.variants, resource, config, diagnostics, fieldPath);
  }

  return manifest;
}

function variantManifestMap(
  variants: NonNullable<SchemaField['variants']>,
  resource: SchemaResource,
  config: SchemaManifestConfig,
  diagnostics: ManifestDiagnostic[],
  fieldPath: string,
): Record<string, VariantManifest> {
  return Object.fromEntries(Object.entries(variants).map(([variantName, variant]) => {
    const manifest: VariantManifest = {
      fields: renderFieldMap(variant.fields ?? {}, resource, config, diagnostics, `${fieldPath}.${variantName}`),
    };
    if ('additionalProperties' in variant) {
      manifest.additionalProperties = Boolean(variant.additionalProperties);
    }
    return [variantName, manifest];
  }));
}

function inferFieldUi(
  fieldName: string,
  field: SchemaField,
  resource: SchemaResource,
  fieldPath: string,
): FieldUiManifest {
  const ui: FieldUiManifest = {
    label: labelFromFieldName(fieldName),
    component: componentForField(fieldName, field),
  };

  if ((resource.kind === 'collection' && fieldPath === resource.idField) || field.readOnly) {
    ui.readonly = true;
  }

  if (field.relation?.to) {
    ui.optionsFrom = field.relation.to;
  }

  return ui;
}

function componentForField(fieldName: string, field: SchemaField): string {
  if (field.relation) {
    return 'relationSelect';
  }

  switch (field.type) {
    case 'boolean':
      return 'toggle';
    case 'enum':
      return Array.isArray(field.values) && field.values.length > 0 && field.values.length <= 3
        ? 'radio'
        : 'select';
    case 'datetime':
      return 'datetime';
    case 'number':
      return 'number';
    case 'array':
      return componentForArray(field.items);
    case 'object':
      return field.fields && Object.keys(field.fields).length > 0 ? 'fieldset' : 'json';
    case 'string':
      return componentForString(fieldName, field);
    default:
      return 'json';
  }
}

function componentForArray(itemField: SchemaField = { type: 'unknown' }): string {
  if (itemField.type === 'enum') {
    return 'multiSelect';
  }

  if (itemField.type === 'string') {
    return 'tags';
  }

  return 'list';
}

function componentForString(fieldName: string, field: SchemaField): string {
  const normalized = normalizeName(fieldName);

  if (/(^|[^a-z])email([^a-z]|$)/.test(normalized) || normalized.endsWith('email')) {
    return 'email';
  }

  if (/(image|avatar|photo|picture|thumbnail|logo|icon)/.test(normalized)) {
    return 'image';
  }

  if (/(^|[^a-z])(url|uri|website|link)([^a-z]|$)/.test(normalized) || normalized.endsWith('url')) {
    return 'url';
  }

  if (/(description|body|content|notes|note|bio|summary|markdown)/.test(normalized)) {
    return 'textarea';
  }

  const maxLength = field.maxLength;
  if (typeof maxLength === 'number' && Number.isFinite(maxLength) && maxLength >= 240) {
    return 'textarea';
  }

  return 'text';
}

function normalizeName(fieldName: string): string {
  return String(fieldName)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function labelFromFieldName(fieldName: string): string {
  const words = normalizeName(fieldName)
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return String(fieldName);
  }

  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');
}

function firstNonSerializablePath(value: unknown, currentPath = ''): string | null {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') {
    return null;
  }

  if (valueType === 'number') {
    return Number.isFinite(value) ? null : currentPath || '<root>';
  }

  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    return currentPath || '<root>';
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const childPath = firstNonSerializablePath(value[index], `${currentPath}[${index}]`);
      if (childPath) {
        return childPath;
      }
    }
    return null;
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return currentPath || '<root>';
    }

    for (const [key, childValue] of Object.entries(value)) {
      const childPath = firstNonSerializablePath(childValue, currentPath ? `${currentPath}.${key}` : key);
      if (childPath) {
        return childPath;
      }
    }
  }

  return null;
}

function nonSerializableDiagnostic(
  resource: SchemaResource,
  fieldPath: string,
  serializablePath: string,
): ManifestDiagnostic {
  return {
    code: 'SCHEMA_MANIFEST_FIELD_NOT_SERIALIZABLE',
    severity: 'error',
    resource: resource.name,
    field: fieldPath,
    message: `schemaManifest.customizeField returned non-serializable output for "${resource.name}.${fieldPath}" at "${serializablePath}".`,
    hint: 'Return JSON-serializable values such as strings, numbers, booleans, arrays, plain objects, null, or return null to omit the field.',
    details: {
      resource: resource.name,
      field: fieldPath,
      path: serializablePath,
    },
  };
}

function nonSerializableResourceDiagnostic(resource: SchemaResource, serializablePath: string): ManifestDiagnostic {
  return {
    code: 'SCHEMA_MANIFEST_RESOURCE_NOT_SERIALIZABLE',
    severity: 'error',
    resource: resource.name,
    message: `schemaManifest.customizeResource returned non-serializable output for "${resource.name}" at "${serializablePath}".`,
    hint: 'Return JSON-serializable values such as strings, numbers, booleans, arrays, plain objects, null, or omit the custom resource hook.',
    details: {
      resource: resource.name,
      path: serializablePath,
    },
  };
}

function manifestDiagnosticsError(diagnostics: ManifestDiagnostic[]): Error & { diagnostics: ManifestDiagnostic[] } {
  const error = new Error(diagnostics.map((diagnostic) => diagnostic.message).join('\n')) as Error & {
    diagnostics: ManifestDiagnostic[];
  };
  error.diagnostics = diagnostics;
  return error;
}
