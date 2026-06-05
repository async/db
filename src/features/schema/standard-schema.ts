export type StandardSchemaV1 = {
  '~standard': {
    version: 1;
    vendor?: string;
    validate: (...args: unknown[]) => unknown;
    jsonSchema?: {
      output?: (options?: Record<string, unknown>) => unknown;
    };
    [key: string]: unknown;
  };
};

type StandardSchemaFieldDefinition = {
  type: string;
  required?: boolean;
  nullable?: boolean;
  description?: string;
  default?: unknown;
  values?: unknown[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: StandardSchemaFieldDefinition;
  fields?: Record<string, StandardSchemaFieldDefinition>;
  additionalProperties?: boolean;
  metadataOnly?: boolean;
  [key: string]: unknown;
};

export type SchemaDiagnostic = {
  code: string;
  severity: 'error' | 'warn' | 'info';
  resource?: string;
  field?: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
};

type JsonSchemaObject = Record<string, unknown> & {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: unknown[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: unknown;
  maximum?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  pattern?: unknown;
  items?: unknown;
  additionalProperties?: unknown;
};

type StandardSchemaIssue = {
  message?: string;
  path?: readonly unknown[];
  [key: string]: unknown;
};

type SchemaResource = {
  name: string;
};

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  const standard = (value as Record<string, unknown> | null | undefined)?.['~standard'] as Record<string, unknown> | undefined;
  return Boolean(
    standard
    && standard.version === 1
    && typeof standard.validate === 'function',
  );
}

export function standardSchemaVendor(schema: StandardSchemaV1 | null | undefined): string {
  return String(schema?.['~standard']?.vendor ?? 'unknown');
}

export function standardJsonSchemaFields(schema: StandardSchemaV1 | null | undefined, resourceName: string): {
  fields: Record<string, StandardSchemaFieldDefinition>;
  authoritative: boolean;
  diagnostics: SchemaDiagnostic[];
} {
  const converter = schema?.['~standard']?.jsonSchema?.output;
  if (typeof converter !== 'function') {
    return {
      fields: {},
      authoritative: false,
      diagnostics: [standardFieldsUnknownDiagnostic(resourceName, 'no-converter')],
    };
  }

  let jsonSchema: unknown;
  try {
    jsonSchema = converter({ target: 'draft-07' });
  } catch (error) {
    return {
      fields: {},
      authoritative: false,
      diagnostics: [standardJsonSchemaDiagnostic(resourceName, error)],
    };
  }

  const fields = fieldsFromJsonSchemaObject(jsonSchema);
  if (!fields) {
    return {
      fields: {},
      authoritative: false,
      diagnostics: [standardFieldsUnknownDiagnostic(resourceName, 'unsupported-json-schema')],
    };
  }

  return {
    fields,
    authoritative: true,
    diagnostics: [],
  };
}

export function mergeStandardSchemaFields(
  inferredFields: Record<string, StandardSchemaFieldDefinition> | null | undefined,
  overlayFields: Record<string, StandardSchemaFieldDefinition> | null | undefined,
): Record<string, StandardSchemaFieldDefinition> {
  const inferred = inferredFields ?? {};
  const overlay = overlayFields ?? {};
  const names = new Set([...Object.keys(inferred), ...Object.keys(overlay)]);
  return Object.fromEntries([...names].map((fieldName) => [
    fieldName,
    mergeStandardSchemaField(inferred[fieldName], overlay[fieldName]),
  ]));
}

export function standardSchemaIssueDiagnostics(
  schema: StandardSchemaV1,
  issues: readonly StandardSchemaIssue[] | null | undefined,
  resource: SchemaResource,
): SchemaDiagnostic[] {
  const vendor = standardSchemaVendor(schema);
  return [...(issues ?? [])].map((issue) => {
    const path = normalizeStandardIssuePath(issue?.path);
    const field = fieldPathFromStandardIssuePath(path);
    return {
      code: 'STANDARD_SCHEMA_VALIDATION_FAILED',
      severity: 'error',
      resource: resource.name,
      field,
      message: field
        ? `${resource.name} field "${field}" failed Standard Schema validation: ${String(issue?.message ?? 'Invalid value')}`
        : `${resource.name} record failed Standard Schema validation: ${String(issue?.message ?? 'Invalid value')}`,
      hint: 'Update the input to satisfy the configured Standard Schema validator.',
      details: {
        vendor,
        path,
        message: String(issue?.message ?? 'Invalid value'),
      },
    };
  });
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value) && typeof value === 'object' && typeof (value as PromiseLike<unknown>).then === 'function';
}

function mergeStandardSchemaField(
  inferredField: StandardSchemaFieldDefinition | undefined,
  overlayField: StandardSchemaFieldDefinition | undefined,
): StandardSchemaFieldDefinition {
  if (!overlayField) {
    return inferredField ?? { type: 'unknown' };
  }
  if (!inferredField) {
    return overlayField;
  }

  const overlayType = overlayField.type;
  const keepInferredType = overlayField.metadataOnly === true && (overlayType === undefined || overlayType === 'unknown');
  const merged = {
    ...inferredField,
    ...overlayField,
  };
  if (keepInferredType) {
    merged.type = inferredField.type;
  }
  return merged;
}

function fieldsFromJsonSchemaObject(schema: unknown): Record<string, StandardSchemaFieldDefinition> | null {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return null;
  }
  const jsonSchema = schema as JsonSchemaObject;
  if (jsonSchema.type !== 'object' || !jsonSchema.properties || typeof jsonSchema.properties !== 'object' || Array.isArray(jsonSchema.properties)) {
    return null;
  }

  const required = new Set(Array.isArray(jsonSchema.required) ? jsonSchema.required.map(String) : []);
  return Object.fromEntries(Object.entries(jsonSchema.properties).map(([fieldName, propertySchema]) => [
    fieldName,
    fieldFromJsonSchema(propertySchema, required.has(fieldName)),
  ]));
}

function fieldFromJsonSchema(schema: unknown, required = false): StandardSchemaFieldDefinition {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return {
      type: 'unknown',
      required,
    };
  }

  const jsonSchema = schema as JsonSchemaObject;
  const types = Array.isArray(jsonSchema.type) ? jsonSchema.type : [jsonSchema.type].filter(Boolean);
  const nullable = types.includes('null');
  const type = types.find((candidate) => candidate !== 'null') ?? (jsonSchema.enum ? 'enum' : 'unknown');
  const field: StandardSchemaFieldDefinition = {
    type: asyncDbFieldType(type),
    required,
  };

  if (nullable) {
    field.nullable = true;
  }
  if (typeof jsonSchema.description === 'string') {
    field.description = jsonSchema.description;
  }
  if ('default' in jsonSchema) {
    field.default = jsonSchema.default;
  }
  if (Array.isArray(jsonSchema.enum)) {
    field.type = 'enum';
    field.values = [...jsonSchema.enum];
  }
  if (typeof jsonSchema.minimum === 'number' && Number.isFinite(jsonSchema.minimum)) {
    field.min = jsonSchema.minimum;
  }
  if (typeof jsonSchema.maximum === 'number' && Number.isFinite(jsonSchema.maximum)) {
    field.max = jsonSchema.maximum;
  }
  if (typeof jsonSchema.minLength === 'number' && Number.isFinite(jsonSchema.minLength)) {
    field.minLength = jsonSchema.minLength;
  }
  if (typeof jsonSchema.maxLength === 'number' && Number.isFinite(jsonSchema.maxLength)) {
    field.maxLength = jsonSchema.maxLength;
  }
  if (typeof jsonSchema.pattern === 'string') {
    field.pattern = jsonSchema.pattern;
  }
  if (field.type === 'array') {
    field.items = fieldFromJsonSchema(jsonSchema.items ?? {}, false);
  }
  if (field.type === 'object') {
    const fields = fieldsFromJsonSchemaObject(jsonSchema);
    if (fields) {
      field.fields = fields;
    }
    if (jsonSchema.additionalProperties === true) {
      field.additionalProperties = true;
    }
  }

  return field;
}

function asyncDbFieldType(type: unknown): string {
  switch (type) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
    case 'array':
      return type;
    case 'integer':
      return 'number';
    default:
      return 'unknown';
  }
}

function normalizeStandardIssuePath(path: unknown): unknown[] {
  if (!Array.isArray(path)) {
    return [];
  }
  return path.map((segment) => {
    if (segment && typeof segment === 'object' && 'key' in segment) {
      return (segment as { key: unknown }).key;
    }
    return segment;
  });
}

function fieldPathFromStandardIssuePath(path: readonly unknown[]): string | undefined {
  if (!path.length) {
    return undefined;
  }

  let output = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      output += `[${segment}]`;
      continue;
    }
    const value = String(segment);
    output += output ? `.${value}` : value;
  }
  return output;
}

function standardFieldsUnknownDiagnostic(resourceName: string, reason: string): SchemaDiagnostic {
  return {
    code: 'STANDARD_SCHEMA_FIELDS_UNKNOWN',
    severity: 'warn',
    resource: resourceName,
    message: `${resourceName} uses a Standard Schema validator, but async-db could not infer field metadata from it.`,
    hint: 'Add field.meta(...) overlays for generated types/manifests, or use a validator that exposes a Standard JSON Schema converter.',
    details: {
      reason,
    },
  };
}

function standardJsonSchemaDiagnostic(resourceName: string, error: unknown): SchemaDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'STANDARD_SCHEMA_JSON_SCHEMA_FAILED',
    severity: 'warn',
    resource: resourceName,
    message: `${resourceName} Standard JSON Schema conversion failed: ${message}`,
    hint: 'Add field.meta(...) overlays for generated types/manifests, or update the validator JSON Schema converter.',
    details: {
      reason: 'converter-threw',
      parserMessage: message,
    },
  };
}
