import path from 'node:path';
import { dbError } from '../../errors.js';

type DiagnosticSeverity = 'error' | 'warn';

type SchemaDiagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  resource: string;
  field?: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
};

type ValidationConfig = {
  schema?: {
    unknownFields?: 'allow' | 'warn' | 'error' | string;
  };
  [key: string]: unknown;
};

type SchemaField = {
  type?: string;
  required?: boolean;
  nullable?: boolean;
  readOnly?: boolean;
  values?: unknown[];
  items?: SchemaField;
  fields?: Record<string, SchemaField>;
  variants?: Record<string, SchemaVariant>;
  discriminator?: string;
  additionalProperties?: boolean;
  min?: unknown;
  max?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  pattern?: unknown;
  unique?: boolean;
  [key: string]: unknown;
};

type SchemaVariant = {
  fields?: Record<string, SchemaField>;
  additionalProperties?: boolean;
};

type SchemaResource = {
  name: string;
  kind?: string;
  fields?: Record<string, SchemaField>;
  seed?: unknown;
  dataPath?: string | null;
  schemaPath?: string | null;
  [key: string]: unknown;
};

type ValidationOptions = {
  source?: string;
  requireFields?: boolean;
};

type ValidationContext = {
  config: ValidationConfig;
  fieldPath: string;
  resource: SchemaResource;
  requireFields?: boolean;
  source?: string;
};

type ConstraintViolationOptions = {
  constraint: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
};

type UniqueDiagnosticOptions = {
  source?: unknown;
};

export function assertRecordMatchesResource(
  record: unknown,
  resource: SchemaResource,
  config: ValidationConfig,
  options: ValidationOptions = {},
): void {
  const diagnostics = validateRecordAgainstResource(record, resource, config, options)
    .filter((diagnostic) => diagnostic.severity === 'error');

  if (diagnostics.length === 0) {
    return;
  }

  throw dbError(
    'DB_SCHEMA_VALIDATION_FAILED',
    `${resource.name} record does not match its schema: ${diagnostics[0].message}`,
    {
      status: 400,
      hint: 'Update the record to match the schema field types, required fields, enum values, and constraints.',
      details: {
        resource: resource.name,
        diagnostics,
      },
    },
  );
}

export function validateRecordAgainstResource(
  record: unknown,
  resource: SchemaResource,
  config: ValidationConfig,
  options: ValidationOptions = {},
): SchemaDiagnostic[] {
  const diagnostics: SchemaDiagnostic[] = [];
  const source = options.source ?? `${resource.name} record`;
  const requireFields = options.requireFields !== false;

  if (!isPlainRecord(record)) {
    diagnostics.push({
      code: 'SCHEMA_RECORD_INVALID',
      severity: 'error',
      resource: resource.name,
      message: `${source} must be an object`,
    });
    return diagnostics;
  }

  const fields = resource.fields ?? {};
  const unknownFields = Object.keys(record).filter((fieldName) => !(fieldName in fields));
  for (const fieldName of unknownFields) {
    const setting = config.schema?.unknownFields ?? 'warn';
    if (setting === 'allow') {
      continue;
    }

    diagnostics.push({
      code: 'SCHEMA_UNKNOWN_FIELD',
      severity: setting === 'error' ? 'error' : 'warn',
      resource: resource.name,
      field: fieldName,
      message: `${path.basename(resource.dataPath ?? `${resource.name}.json`)} has field "${fieldName}" but ${path.basename(resource.schemaPath ?? `${resource.name}.schema`)} does not define "${fieldName}"`,
    });
  }

  for (const [fieldName, field] of Object.entries(fields)) {
    if (field.readOnly && record[fieldName] !== undefined) {
      diagnostics.push(readOnlyFieldDiagnostic(resource, fieldName, source));
      continue;
    }

    if (requireFields && field.required && (record[fieldName] === undefined || (record[fieldName] === null && !field.nullable))) {
      diagnostics.push({
        code: 'SCHEMA_REQUIRED_FIELD_MISSING',
        severity: 'error',
        resource: resource.name,
        field: fieldName,
        message: `${resource.name} record is missing required field "${fieldName}"`,
      });
      continue;
    }

    if (record[fieldName] !== undefined) {
      diagnostics.push(...validateValueAgainstField(record[fieldName], field, {
        config,
        fieldPath: fieldName,
        resource,
        requireFields,
        source,
      }));
    }
  }

  return diagnostics;
}

function readOnlyFieldDiagnostic(resource: SchemaResource, fieldName: string, source: string): SchemaDiagnostic {
  return {
    code: 'FIELD_READ_ONLY',
    severity: 'error',
    resource: resource.name,
    field: fieldName,
    message: `${source} cannot include read-only field "${fieldName}"`,
    hint: 'Remove computed or read-only fields from write bodies; db resolves them during reads.',
    details: {
      resource: resource.name,
      field: fieldName,
    },
  };
}

export function validateValueAgainstField(value: unknown, field: SchemaField, context: ValidationContext): SchemaDiagnostic[] {
  const diagnostics: SchemaDiagnostic[] = [];
  const expected = describeExpectedField(field);

  if (value === undefined) {
    return diagnostics;
  }

  if (value === null) {
    return field.nullable || field.type === 'unknown'
      ? diagnostics
      : [
        typeMismatch(context, expected, value),
      ];
  }

  switch (field.type) {
    case 'unknown':
      return diagnostics;
    case 'string':
      return typeof value === 'string' ? validateFieldConstraints(value, field, context) : [typeMismatch(context, expected, value)];
    case 'datetime':
      return typeof value === 'string' ? validateFieldConstraints(value, field, context) : [typeMismatch(context, expected, value)];
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? validateFieldConstraints(value, field, context) : [typeMismatch(context, expected, value)];
    case 'boolean':
      return typeof value === 'boolean' ? diagnostics : [typeMismatch(context, expected, value)];
    case 'enum':
      return (field.values ?? []).includes(value)
        ? diagnostics
        : [
          {
            code: 'SCHEMA_ENUM_VALUE_INVALID',
            severity: 'error',
            resource: context.resource.name,
            field: context.fieldPath,
            message: `${context.resource.name} field "${context.fieldPath}" expected ${expected} but received ${JSON.stringify(value)}`,
            details: {
              expected,
              received: value,
              values: field.values ?? [],
            },
          },
        ];
    case 'array':
      if (!Array.isArray(value)) {
        return [typeMismatch(context, expected, value)];
      }
      diagnostics.push(...validateFieldConstraints(value, field, context));
      for (const [index, item] of value.entries()) {
        diagnostics.push(...validateValueAgainstField(item, field.items ?? { type: 'unknown' }, {
          ...context,
          fieldPath: `${context.fieldPath}[${index}]`,
        }));
      }
      return diagnostics;
    case 'object':
      if (!isPlainRecord(value)) {
        return [typeMismatch(context, expected, value)];
      }
      return validateObjectFields(value, field, context);
    default:
      return diagnostics;
  }
}

function validateFieldConstraints(value: unknown, field: SchemaField, context: ValidationContext): SchemaDiagnostic[] {
  const diagnostics: SchemaDiagnostic[] = [];

  if (typeof value === 'number') {
    if (typeof field.min === 'number' && Number.isFinite(field.min) && value < field.min) {
      diagnostics.push(constraintViolation(context, field, value, {
        constraint: 'min',
        message: `must be at least ${field.min}`,
        expected: field.min,
      }));
    }

    if (typeof field.max === 'number' && Number.isFinite(field.max) && value > field.max) {
      diagnostics.push(constraintViolation(context, field, value, {
        constraint: 'max',
        message: `must be at most ${field.max}`,
        expected: field.max,
      }));
    }
  }

  if (typeof value === 'string' || Array.isArray(value)) {
    if (typeof field.minLength === 'number' && Number.isFinite(field.minLength) && value.length < field.minLength) {
      diagnostics.push(constraintViolation(context, field, value, {
        constraint: 'minLength',
        message: `length must be at least ${field.minLength}`,
        expected: field.minLength,
        actual: value.length,
      }));
    }

    if (typeof field.maxLength === 'number' && Number.isFinite(field.maxLength) && value.length > field.maxLength) {
      diagnostics.push(constraintViolation(context, field, value, {
        constraint: 'maxLength',
        message: `length must be at most ${field.maxLength}`,
        expected: field.maxLength,
        actual: value.length,
      }));
    }
  }

  if (typeof value === 'string' && field.pattern !== undefined) {
    const pattern = String(field.pattern);
    let regexp;
    try {
      regexp = new RegExp(pattern);
    } catch (error) {
      const parserMessage = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        code: 'SCHEMA_FIELD_CONSTRAINT_INVALID',
        severity: 'error',
        resource: context.resource.name,
        field: context.fieldPath,
        message: `${context.resource.name} field "${context.fieldPath}" has invalid pattern ${JSON.stringify(pattern)}: ${parserMessage}`,
        hint: 'Use a valid JavaScript regular expression source string for pattern.',
        details: {
          constraint: 'pattern',
          pattern,
          parserMessage,
        },
      });
      return diagnostics;
    }

    if (!regexp.test(value)) {
      diagnostics.push(constraintViolation(context, field, value, {
        constraint: 'pattern',
        message: `violates pattern ${JSON.stringify(pattern)}`,
        expected: pattern,
      }));
    }
  }

  return diagnostics;
}

function constraintViolation(
  context: ValidationContext,
  field: SchemaField,
  value: unknown,
  options: ConstraintViolationOptions,
): SchemaDiagnostic {
  return {
    code: 'SCHEMA_FIELD_CONSTRAINT_VIOLATION',
    severity: 'error',
    resource: context.resource.name,
    field: context.fieldPath,
    message: `${context.resource.name} field "${context.fieldPath}" ${options.message}`,
    hint: constraintHint(options.constraint),
    details: {
      constraint: options.constraint,
      expected: options.expected,
      actual: options.actual,
      received: value,
      fieldType: field.type,
    },
  };
}

function constraintHint(constraint: string): string {
  switch (constraint) {
    case 'pattern':
      return 'Update the value to match the configured pattern, or relax the pattern in the schema.';
    case 'min':
    case 'max':
      return 'Update the number to stay within the configured schema range.';
    case 'minLength':
    case 'maxLength':
      return 'Update the value length to stay within the configured schema bounds.';
    default:
      return 'Update the value or relax the schema constraint.';
  }
}

function validateObjectFields(value: Record<string, unknown>, field: SchemaField, context: ValidationContext): SchemaDiagnostic[] {
  if (field.discriminator && field.variants) {
    return validateVariantObjectFields(value, field, context);
  }

  const diagnostics: SchemaDiagnostic[] = [];
  const fields = field.fields ?? {};

  if (field.additionalProperties !== true) {
    for (const childName of Object.keys(value)) {
      if (childName in fields) {
        continue;
      }

      const setting = context.config.schema?.unknownFields ?? 'warn';
      if (setting === 'allow') {
        continue;
      }

      const fieldPath = `${context.fieldPath}.${childName}`;
      diagnostics.push({
        code: 'SCHEMA_UNKNOWN_FIELD',
        severity: setting === 'error' ? 'error' : 'warn',
        resource: context.resource.name,
        field: fieldPath,
        message: `${context.resource.name} field "${fieldPath}" is not defined in the schema`,
      });
    }
  }

  for (const [childName, childField] of Object.entries(fields)) {
    const fieldPath = `${context.fieldPath}.${childName}`;
    const childValue = value[childName];

    if (childField.readOnly && childValue !== undefined) {
      diagnostics.push(readOnlyFieldDiagnostic(context.resource, fieldPath, context.source ?? `${context.resource.name} record`));
      continue;
    }

    if (context.requireFields !== false && childField.required && (childValue === undefined || (childValue === null && !childField.nullable))) {
      diagnostics.push({
        code: 'SCHEMA_REQUIRED_FIELD_MISSING',
        severity: 'error',
        resource: context.resource.name,
        field: fieldPath,
        message: `${context.resource.name} record is missing required field "${fieldPath}"`,
      });
      continue;
    }

    diagnostics.push(...validateValueAgainstField(childValue, childField, {
      ...context,
      fieldPath,
    }));
  }

  return diagnostics;
}

function validateVariantObjectFields(
  value: Record<string, unknown>,
  field: SchemaField,
  context: ValidationContext,
): SchemaDiagnostic[] {
  const discriminator = field.discriminator as string;
  const discriminatorValue = value[discriminator];
  const variants = field.variants ?? {};

  if (discriminatorValue === undefined || discriminatorValue === null || discriminatorValue === '') {
    return [{
      code: 'SCHEMA_REQUIRED_FIELD_MISSING',
      severity: 'error',
      resource: context.resource.name,
      field: `${context.fieldPath}.${discriminator}`,
      message: `${context.resource.name} record is missing required field "${context.fieldPath}.${discriminator}"`,
    }];
  }

  const variant = variants[String(discriminatorValue)];
  if (!variant) {
    return [{
      code: 'SCHEMA_VARIANT_UNKNOWN',
      severity: 'error',
      resource: context.resource.name,
      field: `${context.fieldPath}.${discriminator}`,
      message: `${context.resource.name} field "${context.fieldPath}.${discriminator}" expected one of ${Object.keys(variants).map((value) => JSON.stringify(value)).join(', ')} but received ${JSON.stringify(discriminatorValue)}`,
      details: {
        discriminator,
        value: discriminatorValue,
        variants: Object.keys(variants),
      },
    }];
  }

  const variantFields = {
    [discriminator]: {
      type: 'enum',
      values: [String(discriminatorValue)],
      required: true,
    },
    ...(variant.fields ?? {}),
  };

  return validateObjectFields(value, {
    type: 'object',
    fields: variantFields,
    additionalProperties: variant.additionalProperties ?? field.additionalProperties,
  }, context);
}

function typeMismatch(context: ValidationContext, expected: string, value: unknown): SchemaDiagnostic {
  return {
    code: 'SCHEMA_FIELD_TYPE_MISMATCH',
    severity: 'error',
    resource: context.resource.name,
    field: context.fieldPath,
    message: `${context.resource.name} field "${context.fieldPath}" expected ${expected} but received ${describeJsonValue(value)}`,
    details: {
      expected,
      receivedType: describeJsonValue(value),
    },
  };
}

function describeExpectedField(field: SchemaField): string {
  switch (field.type) {
    case 'enum':
      return `one of ${field.values?.map((value) => JSON.stringify(value)).join(', ') || '[]'}`;
    case 'array':
      return `array of ${describeExpectedField(field.items ?? { type: 'unknown' })}`;
    case 'object':
      return 'object';
    case 'unknown':
      return 'any JSON value';
    default:
      return field.type ?? 'unknown';
  }
}

function describeJsonValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateResourceSeed(resource: SchemaResource, config: ValidationConfig): SchemaDiagnostic[] {
  if (resource.kind === 'collection') {
    const seed = resource.seed as unknown[];
    return [
      ...seed.flatMap((record, index) => validateRecordAgainstResource(record, resource, config, {
        source: `${resource.name} seed record ${index}`,
      })),
      ...validateUniqueCollectionFields(resource),
    ];
  }

  return validateRecordAgainstResource(resource.seed, resource, config, {
    source: `${resource.name} seed document`,
  });
}

export function validateUniqueCollectionFields(
  resource: SchemaResource,
  records: unknown = resource.seed,
  options: UniqueDiagnosticOptions = {},
): SchemaDiagnostic[] {
  if (resource.kind !== 'collection' || !Array.isArray(records)) {
    return [];
  }

  const diagnostics: SchemaDiagnostic[] = [];
  const fields = Object.entries(resource.fields ?? {}).filter(([, field]) => field.unique === true);

  for (const [fieldName] of fields) {
    const seen = new Map<string, number>();
    for (const [index, record] of records.entries()) {
      const value = isPlainRecord(record) ? record[fieldName] : undefined;
      if (value === undefined || value === null || value === '') {
        continue;
      }

      const key = JSON.stringify(value);
      const firstIndex = seen.get(key);
      if (firstIndex !== undefined) {
        diagnostics.push(uniqueDuplicateDiagnostic(resource, fieldName, value, firstIndex, index, options));
      } else {
        seen.set(key, index);
      }
    }
  }

  return diagnostics;
}

export function uniqueDuplicateDiagnostic(
  resource: SchemaResource,
  fieldName: string,
  value: unknown,
  firstIndex: number,
  duplicateIndex: number,
  options: UniqueDiagnosticOptions = {},
): SchemaDiagnostic {
  return {
    code: 'SCHEMA_UNIQUE_VALUE_DUPLICATE',
    severity: 'error',
    resource: resource.name,
    field: fieldName,
    message: `${resource.name} field "${fieldName}" must be unique, but value ${JSON.stringify(value)} appears more than once`,
    hint: `Use a unique "${fieldName}" value or remove unique: true from the schema field.`,
    details: {
      constraint: 'unique',
      value,
      firstIndex,
      duplicateIndex,
      source: options.source,
    },
  };
}
