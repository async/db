export function isStandardSchema(value) {
  const standard = value?.['~standard'];
  return Boolean(
    standard
    && standard.version === 1
    && typeof standard.validate === 'function',
  );
}

export function standardSchemaVendor(schema) {
  return String(schema?.['~standard']?.vendor ?? 'unknown');
}

export function standardJsonSchemaFields(schema, resourceName) {
  const converter = schema?.['~standard']?.jsonSchema?.output;
  if (typeof converter !== 'function') {
    return {
      fields: {},
      authoritative: false,
      diagnostics: [standardFieldsUnknownDiagnostic(resourceName, 'no-converter')],
    };
  }

  let jsonSchema;
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

export function mergeStandardSchemaFields(inferredFields, overlayFields) {
  const inferred = inferredFields ?? {};
  const overlay = overlayFields ?? {};
  const names = new Set([...Object.keys(inferred), ...Object.keys(overlay)]);
  return Object.fromEntries([...names].map((fieldName) => [
    fieldName,
    mergeStandardSchemaField(inferred[fieldName], overlay[fieldName]),
  ]));
}

export function standardSchemaIssueDiagnostics(schema, issues, resource) {
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

export function isPromiseLike(value) {
  return value && typeof value === 'object' && typeof value.then === 'function';
}

function mergeStandardSchemaField(inferredField, overlayField) {
  if (!overlayField) {
    return inferredField;
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

function fieldsFromJsonSchemaObject(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return null;
  }
  if (schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    return null;
  }

  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.fromEntries(Object.entries(schema.properties).map(([fieldName, propertySchema]) => [
    fieldName,
    fieldFromJsonSchema(propertySchema, required.has(fieldName)),
  ]));
}

function fieldFromJsonSchema(schema, required = false) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return {
      type: 'unknown',
      required,
    };
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type].filter(Boolean);
  const nullable = types.includes('null');
  const type = types.find((candidate) => candidate !== 'null') ?? (schema.enum ? 'enum' : 'unknown');
  const field = {
    type: asyncDbFieldType(type),
    required,
  };

  if (nullable) {
    field.nullable = true;
  }
  if (typeof schema.description === 'string') {
    field.description = schema.description;
  }
  if ('default' in schema) {
    field.default = schema.default;
  }
  if (Array.isArray(schema.enum)) {
    field.type = 'enum';
    field.values = [...schema.enum];
  }
  if (Number.isFinite(schema.minimum)) {
    field.min = schema.minimum;
  }
  if (Number.isFinite(schema.maximum)) {
    field.max = schema.maximum;
  }
  if (Number.isFinite(schema.minLength)) {
    field.minLength = schema.minLength;
  }
  if (Number.isFinite(schema.maxLength)) {
    field.maxLength = schema.maxLength;
  }
  if (typeof schema.pattern === 'string') {
    field.pattern = schema.pattern;
  }
  if (field.type === 'array') {
    field.items = fieldFromJsonSchema(schema.items ?? {}, false);
  }
  if (field.type === 'object') {
    const fields = fieldsFromJsonSchemaObject(schema);
    if (fields) {
      field.fields = fields;
    }
    if (schema.additionalProperties === true) {
      field.additionalProperties = true;
    }
  }

  return field;
}

function asyncDbFieldType(type) {
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

function normalizeStandardIssuePath(path) {
  if (!Array.isArray(path)) {
    return [];
  }
  return path.map((segment) => {
    if (segment && typeof segment === 'object' && 'key' in segment) {
      return segment.key;
    }
    return segment;
  });
}

function fieldPathFromStandardIssuePath(path) {
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

function standardFieldsUnknownDiagnostic(resourceName, reason) {
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

function standardJsonSchemaDiagnostic(resourceName, error) {
  return {
    code: 'STANDARD_SCHEMA_JSON_SCHEMA_FAILED',
    severity: 'warn',
    resource: resourceName,
    message: `${resourceName} Standard JSON Schema conversion failed: ${error.message}`,
    hint: 'Add field.meta(...) overlays for generated types/manifests, or update the validator JSON Schema converter.',
    details: {
      reason: 'converter-threw',
      parserMessage: error.message,
    },
  };
}
