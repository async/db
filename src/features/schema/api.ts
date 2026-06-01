import { loadConfig } from '../../config.js';
import { dbError, listChoices } from '../../errors.js';
import { resolveResource } from '../../names.js';
import type { SchemaField } from './fields.js';
import type { SchemaLoadMode } from './locator.js';
import { loadProjectSchema } from './project.js';
import { callFieldResolver, valueFromResolveManyResult } from './resolvers.js';
import { isPromiseLike, standardSchemaIssueDiagnostics, type SchemaDiagnostic, type StandardSchemaV1 } from './standard-schema.js';
import { validateRecordAgainstResource } from './validation.js';

type ValidationMode = 'create' | 'replace' | 'patch';
type ValidatorUnknownFields = 'allow' | 'warn' | 'error' | 'strip';

type DbConfig = Record<string, unknown> & {
  schemaLoadMode?: SchemaLoadMode;
  schema?: {
    unknownFields?: ValidatorUnknownFields | string;
    [key: string]: unknown;
  };
  services?: Record<string, unknown>;
};

type LoadDbSchemaOptions = string | (DbConfig & {
  from?: string;
  load?: SchemaLoadMode;
});

type SchemaFieldResolverDefinition = {
  resolve?: Parameters<typeof callFieldResolver>[0];
  resolveMany?: Parameters<typeof callFieldResolver>[0];
  [key: string]: unknown;
};

type SchemaResource = {
  name: string;
  kind?: 'collection' | 'document' | string;
  idField?: string;
  fields?: Record<string, SchemaField>;
  fieldsAuthoritative?: boolean;
  resolvers?: {
    fields?: Record<string, SchemaFieldResolverDefinition>;
    [key: string]: unknown;
  };
  validators?: {
    standard?: StandardSchemaV1;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type SchemaProject = {
  resources: SchemaResource[];
  diagnostics: SchemaDiagnostic[];
  schema: unknown;
  loadMode?: SchemaLoadMode;
  locator?: unknown;
  rootSchema?: unknown;
};

type LoadedDbSchema = {
  kind: 'DbSchema';
  config: DbConfig;
  loadMode?: SchemaLoadMode;
  locator?: unknown;
  rootSchema?: unknown;
  resources: Map<string, SchemaResource>;
  diagnostics: SchemaDiagnostic[];
  schema: unknown;
  resource(name: string): SchemaResource;
  resourceNames(): string[];
  validator(name: string, options?: SchemaValidatorOptions): SchemaValidator;
  resolver(selector: string, options?: SchemaResolverOptions): SchemaFieldResolver | Record<string, SchemaFieldResolver>;
  validate(name: string, value: unknown, options?: SchemaValidatorOptions): ValidationResult;
  assert(name: string, value: unknown, options?: SchemaValidatorOptions): unknown;
  validateAsync(name: string, value: unknown, options?: SchemaValidatorOptions): Promise<ValidationResult>;
  assertAsync(name: string, value: unknown, options?: SchemaValidatorOptions): Promise<unknown>;
  toJSON(): unknown;
};

type SchemaResolverOptions = {
  db?: unknown;
  cache?: Map<unknown, unknown>;
  context?: unknown;
  services?: Record<string, unknown>;
  value?: unknown;
  [key: string]: unknown;
};

type ResolverArgs = Record<string, unknown> & {
  record?: unknown;
  records?: unknown[];
  value?: unknown;
};

type SchemaFieldResolver = ((args?: unknown) => Promise<unknown>) & {
  resolve?: (args?: unknown) => Promise<unknown>;
  resolveMany?: (args?: unknown) => Promise<unknown>;
};

type SchemaValidatorOptions = {
  mode?: ValidationMode | string;
  unknownFields?: ValidatorUnknownFields | 'ignore' | string;
  source?: string;
  applyDefaults?: boolean;
};

type ValidationContext = {
  activeMode: ValidationMode;
  activeUnknownFields: ValidatorUnknownFields;
  source: string;
};

type ValidationResult<TValue = Record<string, unknown>> = {
  ok: boolean;
  value: TValue;
  diagnostics: SchemaDiagnostic[];
  errors: SchemaDiagnostic[];
  resource: string;
  mode: ValidationMode;
};

type SchemaValidator<TValue = Record<string, unknown>> = {
  resource: string;
  mode: ValidationMode;
  unknownFields: ValidatorUnknownFields;
  validate(value: unknown, validateOptions?: SchemaValidatorOptions): ValidationResult<TValue>;
  validateAsync(value: unknown, validateOptions?: SchemaValidatorOptions): Promise<ValidationResult<TValue>>;
  assert(value: unknown, assertOptions?: SchemaValidatorOptions): TValue;
  assertAsync(value: unknown, assertOptions?: SchemaValidatorOptions): Promise<TValue>;
};

type StandardValidationResult = {
  value: unknown;
  diagnostics: SchemaDiagnostic[];
};

type StandardSchemaIssue = {
  message?: string;
  path?: readonly unknown[];
  [key: string]: unknown;
};

type StandardSchemaOutput = {
  value?: unknown;
  issues?: StandardSchemaIssue[];
  [key: string]: unknown;
};

type ResolverSelector = {
  resourceName: string;
  fieldName: string | null;
};

export async function loadDbSchema(options: LoadDbSchemaOptions = {}): Promise<LoadedDbSchema> {
  const rawOptions = typeof options === 'string'
    ? { from: options }
    : { ...options };
  const load = (rawOptions.load ?? 'schema') as SchemaLoadMode;
  const config = await loadConfig({
    ...rawOptions,
    load,
  }) as DbConfig;
  const project = await loadProjectSchema(config, {
    load: config.schemaLoadMode ?? load,
  }) as SchemaProject;

  return createDbSchema(project, config);
}

export function createDbSchema(project: SchemaProject, config: DbConfig): LoadedDbSchema {
  const resources = new Map(project.resources.map((resource) => [resource.name, resource]));

  return {
    kind: 'DbSchema',
    config,
    loadMode: project.loadMode,
    locator: project.locator,
    rootSchema: project.rootSchema,
    resources,
    diagnostics: project.diagnostics,
    schema: project.schema,

    resource(name: string) {
      return requireSchemaResource(resources, name);
    },

    resourceNames() {
      return [...resources.keys()];
    },

    validator(name: string, options: SchemaValidatorOptions = {}) {
      return createSchemaValidator(requireSchemaResource(resources, name), config, options);
    },

    resolver(selector: string, options: SchemaResolverOptions = {}) {
      const { resourceName, fieldName } = parseResolverSelector(selector);
      const resource = requireSchemaResource(resources, resourceName);
      if (fieldName) {
        return createSchemaFieldResolver(resource, fieldName, config, options);
      }

      return createSchemaResourceResolverMap(resource, config, options);
    },

    validate(name: string, value: unknown, options: SchemaValidatorOptions = {}) {
      return this.validator(name, options).validate(value);
    },

    assert(name: string, value: unknown, options: SchemaValidatorOptions = {}) {
      return this.validator(name, options).assert(value);
    },

    validateAsync(name: string, value: unknown, options: SchemaValidatorOptions = {}) {
      return this.validator(name, options).validateAsync(value);
    },

    assertAsync(name: string, value: unknown, options: SchemaValidatorOptions = {}) {
      return this.validator(name, options).assertAsync(value);
    },

    toJSON() {
      return project.schema;
    },
  };
}

export function createSchemaResourceResolverMap(
  resource: SchemaResource,
  config: DbConfig,
  options: SchemaResolverOptions = {},
): Record<string, SchemaFieldResolver> {
  const resolvers: Record<string, SchemaFieldResolver> = {};
  for (const fieldName of Object.keys(resource.resolvers?.fields ?? {})) {
    resolvers[fieldName] = createSchemaFieldResolver(resource, fieldName, config, options);
  }
  return resolvers;
}

export function createSchemaFieldResolver(
  resource: SchemaResource,
  fieldName: string,
  config: DbConfig,
  options: SchemaResolverOptions = {},
): SchemaFieldResolver {
  const resolver = resource.resolvers?.fields?.[fieldName];
  if (!resolver) {
    throw dbError(
      'DB_SCHEMA_RESOLVER_NOT_FOUND',
      `Resource "${resource.name}" does not define a resolver for field "${fieldName}".`,
      {
        status: 404,
        hint: `Use one of: ${listChoices(Object.keys(resource.resolvers?.fields ?? {}))}.`,
        details: {
          resource: resource.name,
          field: fieldName,
          availableFields: Object.keys(resource.resolvers?.fields ?? {}),
        },
      },
    );
  }

  const resolve = (async (args: unknown = {}) => {
    if (typeof resolver.resolve === 'function') {
      return callFieldResolver(resolver.resolve, normalizeResolverArgs(args), resolverCallOptions(resource, fieldName, config, options, args));
    }

    if (typeof resolver.resolveMany === 'function') {
      const normalizedArgs = normalizeResolverArgs(args);
      const record = normalizedArgs.record ?? normalizedArgs.value ?? {};
      const manyArgs = {
        ...normalizedArgs,
        records: [record],
      };
      const values = await callFieldResolver(
        resolver.resolveMany,
        manyArgs,
        resolverCallOptions(resource, fieldName, config, options, {
          ...spreadableRecord(args),
          records: manyArgs.records,
        }),
      );
      return valueFromResolveManyResult(values, resource, record as Record<string, unknown>, 0);
    }

    return undefined;
  }) as SchemaFieldResolver;

  if (typeof resolver.resolve === 'function') {
    resolve.resolve = resolve;
  }

  if (typeof resolver.resolveMany === 'function') {
    resolve.resolveMany = async (args = {}) => {
      const normalizedArgs = normalizeResolveManyArgs(args);
      return callFieldResolver(resolver.resolveMany, normalizedArgs, resolverCallOptions(resource, fieldName, config, options, {
        ...spreadableRecord(args),
        records: normalizedArgs.records,
      }));
    };
  }

  return resolve;
}

export function createSchemaValidator(
  resource: SchemaResource,
  config: DbConfig,
  options: SchemaValidatorOptions = {},
): SchemaValidator {
  const mode = normalizeValidationMode(options.mode);
  const unknownFields = normalizeValidatorUnknownFields(options.unknownFields);

  function validate(value: unknown, validateOptions: SchemaValidatorOptions = {}): ValidationResult {
    const result = validateInternal(value, validateOptions);
    if (isPromiseLike(result)) {
      throw asyncValidatorRequiredError(resource);
    }
    return result;
  }

  async function validateAsync(value: unknown, validateOptions: SchemaValidatorOptions = {}): Promise<ValidationResult> {
    return validateInternal(value, validateOptions, { allowAsync: true });
  }

  function validateInternal(
    value: unknown,
    validateOptions: SchemaValidatorOptions = {},
    internalOptions: { allowAsync?: boolean } = {},
  ): ValidationResult | PromiseLike<ValidationResult> {
    const activeMode = normalizeValidationMode(validateOptions.mode ?? mode);
    const activeUnknownFields = normalizeValidatorUnknownFields(validateOptions.unknownFields ?? unknownFields);
    const source = validateOptions.source ?? options.source ?? `${resource.name} ${activeMode} input`;
    const input = cloneInput(value);
    const withDefaults = applyValidationDefaults(input, resource, {
      mode: activeMode,
      applyDefaults: validateOptions.applyDefaults ?? options.applyDefaults,
    });
    const standardResult = validateWithStandardSchema(resource, withDefaults);
    if (isPromiseLike(standardResult)) {
      if (!internalOptions.allowAsync) {
        throw asyncValidatorRequiredError(resource);
      }
      return standardResult.then((resolvedStandardResult) => finishValidation(resolvedStandardResult, {
        activeMode,
        activeUnknownFields,
        source,
      }));
    }

    return finishValidation(standardResult, {
      activeMode,
      activeUnknownFields,
      source,
    });
  }

  function finishValidation(standardResult: StandardValidationResult, context: ValidationContext): ValidationResult {
    const { activeMode, activeUnknownFields, source } = context;
    const standardValue = standardResult.value;
    const sanitized = activeUnknownFields === 'strip'
      ? stripUnknownResourceFields(standardValue, resource)
      : standardValue;
    const validationConfig = {
      ...config,
      schema: {
        ...config.schema,
        unknownFields: activeUnknownFields === 'strip' || resource.fieldsAuthoritative === false
          ? 'allow'
          : activeUnknownFields,
      },
    };
    const validationResource = validationResourceForMode(resource, sanitized, activeMode);
    const diagnostics = [
      ...standardResult.diagnostics,
      ...validateRecordAgainstResource(sanitized, validationResource, validationConfig, {
        source,
        requireFields: activeMode !== 'patch',
      }),
    ];
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

    return {
      ok: errors.length === 0,
      value: sanitized as Record<string, unknown>,
      diagnostics,
      errors,
      resource: resource.name,
      mode: activeMode,
    };
  }

  return {
    resource: resource.name,
    mode,
    unknownFields,
    validate,
    validateAsync,
    assert(value: unknown, assertOptions: SchemaValidatorOptions = {}) {
      const result = validate(value, assertOptions);
      if (result.ok) {
        return result.value;
      }

      throw dbError(
        'DB_SCHEMA_VALIDATION_FAILED',
        `${resource.name} input does not match its schema: ${result.errors[0].message}`,
        {
          status: 400,
          hint: 'Update the input to match the schema field types, required fields, enum values, constraints, and read-only field rules.',
          details: {
            resource: resource.name,
            mode: result.mode,
            diagnostics: result.diagnostics,
          },
        },
      );
    },
    async assertAsync(value: unknown, assertOptions: SchemaValidatorOptions = {}) {
      const result = await validateAsync(value, assertOptions);
      if (result.ok) {
        return result.value;
      }

      throw dbError(
        'DB_SCHEMA_VALIDATION_FAILED',
        `${resource.name} input does not match its schema: ${result.errors[0].message}`,
        {
          status: 400,
          hint: 'Update the input to match the schema field types, required fields, enum values, constraints, and read-only field rules.',
          details: {
            resource: resource.name,
            mode: result.mode,
            diagnostics: result.diagnostics,
          },
        },
      );
    },
  };
}

function validateWithStandardSchema(resource: SchemaResource, value: unknown): StandardValidationResult | PromiseLike<StandardValidationResult> {
  const standardSchema = resource.validators?.standard;
  const validate = standardSchema?.['~standard']?.validate;
  if (typeof validate !== 'function') {
    return {
      value,
      diagnostics: [],
    };
  }

  const result = validate(value);
  if (isPromiseLike(result)) {
    return result.then((resolved) => standardSchemaValidationResult(standardSchema, resource, value, resolved as StandardSchemaOutput));
  }

  return standardSchemaValidationResult(standardSchema, resource, value, result as StandardSchemaOutput);
}

function standardSchemaValidationResult(
  standardSchema: StandardSchemaV1,
  resource: SchemaResource,
  inputValue: unknown,
  result: StandardSchemaOutput | null | undefined,
): StandardValidationResult {
  const issues = Array.isArray(result?.issues) ? result.issues : [];
  return {
    value: Object.prototype.hasOwnProperty.call(result ?? {}, 'value') ? result.value : inputValue,
    diagnostics: standardSchemaIssueDiagnostics(standardSchema, issues, resource),
  };
}

function asyncValidatorRequiredError(resource: SchemaResource): Error {
  return dbError(
    'DB_SCHEMA_ASYNC_VALIDATOR_REQUIRED',
    `${resource.name} uses an async Standard Schema validator, but this helper is synchronous.`,
    {
      status: 400,
      hint: 'Use validateAsync(...) or assertAsync(...) for resources backed by async Standard Schema validators.',
      details: {
        resource: resource.name,
      },
    },
  );
}

function parseResolverSelector(selector: unknown): ResolverSelector {
  const value = String(selector ?? '');
  const [resourceName, ...fieldParts] = value.split('.');
  const fieldName = fieldParts.join('.');
  if (!resourceName) {
    throw dbError(
      'DB_SCHEMA_RESOLVER_SELECTOR_INVALID',
      `Invalid schema resolver selector ${JSON.stringify(selector)}.`,
      {
        status: 400,
        hint: 'Use "resourceName" for a resolver map or "resourceName.fieldName" for one field resolver.',
        details: {
          selector,
        },
      },
    );
  }

  return {
    resourceName,
    fieldName: fieldName || null,
  };
}

function resolverCallOptions(
  resource: SchemaResource,
  fieldName: string,
  config: DbConfig,
  options: SchemaResolverOptions,
  args: unknown,
): Parameters<typeof callFieldResolver>[2] {
  const normalizedArgs = normalizeResolverArgs(args);
  return {
    db: options.db,
    config,
    resource,
    fieldName,
    cache: options.cache ?? new Map(),
    context: options.context,
    services: options.services ?? config.services,
    value: options.value ?? normalizedArgs.record ?? normalizedArgs.records ?? normalizedArgs.value,
  };
}

function normalizeResolverArgs(args: unknown): ResolverArgs {
  if (args === undefined || args === null) {
    return {};
  }

  if (Array.isArray(args)) {
    return { records: args };
  }

  if (typeof args === 'object') {
    return args as ResolverArgs;
  }

  return { value: args };
}

function normalizeResolveManyArgs(args: unknown): ResolverArgs & { records: unknown[] } {
  const normalizedArgs = normalizeResolverArgs(args);
  if (Array.isArray(normalizedArgs.records)) {
    return normalizedArgs as ResolverArgs & { records: unknown[] };
  }

  return {
    ...normalizedArgs,
    records: [],
  };
}

function spreadableRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }

  return Object(value) as Record<string, unknown>;
}

function requireSchemaResource(resources: Map<string, SchemaResource>, name: string): SchemaResource {
  const { resource, candidates } = resolveResource(resources, name);
  if (resource) {
    return resource;
  }

  throw dbError(
    'DB_UNKNOWN_RESOURCE',
    `Unknown schema resource "${name}".`,
    {
      status: 404,
      hint: `Use one of: ${listChoices([...resources.keys()])}.`,
      details: {
        resource: name,
        requestedResource: name,
        normalizedCandidates: candidates,
        availableResources: [...resources.keys()],
      },
    },
  );
}

function normalizeValidationMode(value: unknown = 'create'): ValidationMode {
  if (value === 'create' || value === 'replace' || value === 'patch') {
    return value;
  }

  throw dbError(
    'DB_SCHEMA_VALIDATOR_MODE_INVALID',
    `Invalid schema validator mode ${JSON.stringify(value)}.`,
    {
      status: 400,
      hint: 'Use "create", "replace", or "patch".',
      details: {
        value,
        allowed: ['create', 'replace', 'patch'],
      },
    },
  );
}

function normalizeValidatorUnknownFields(value: unknown = 'error'): ValidatorUnknownFields {
  if (value === 'ignore') {
    return 'allow';
  }

  if (value === 'allow' || value === 'warn' || value === 'error' || value === 'strip') {
    return value;
  }

  throw dbError(
    'DB_SCHEMA_VALIDATOR_UNKNOWN_FIELDS_INVALID',
    `Invalid schema validator unknownFields setting ${JSON.stringify(value)}.`,
    {
      status: 400,
      hint: 'Use "error", "strip", "allow", "warn", or "ignore".',
      details: {
        value,
        allowed: ['error', 'strip', 'allow', 'warn', 'ignore'],
      },
    },
  );
}

function validationResourceForMode(resource: SchemaResource, value: unknown, mode: ValidationMode): SchemaResource {
  if (mode !== 'create' || resource.kind !== 'collection' || !isPlainRecord(value)) {
    return resource;
  }

  const idField = resource.idField ?? 'id';
  if (value[idField] !== undefined || !resource.fields?.[idField]?.required) {
    return resource;
  }

  return {
    ...resource,
    fields: {
      ...resource.fields,
      [idField]: {
        ...resource.fields[idField],
        required: false,
      },
    },
  };
}

function applyValidationDefaults(
  value: unknown,
  resource: SchemaResource,
  options: { mode: ValidationMode; applyDefaults?: boolean },
): unknown {
  if (options.mode !== 'create' || options.applyDefaults === false || !isPlainRecord(value)) {
    return value;
  }

  const next = { ...value };
  for (const [fieldName, field] of Object.entries(resource.fields ?? {})) {
    if (next[fieldName] !== undefined || !Object.prototype.hasOwnProperty.call(field, 'default')) {
      continue;
    }

    if (field.readOnly || field.computed) {
      continue;
    }

    next[fieldName] = structuredClone(field.default);
  }

  return next;
}

function stripUnknownResourceFields(value: unknown, resource: SchemaResource): unknown {
  if (resource.fieldsAuthoritative === false) {
    return value;
  }

  return stripUnknownFields(value, resource.fields ?? {});
}

function stripUnknownFields(value: unknown, fields: Record<string, SchemaField>): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [fieldName, fieldValue] of Object.entries(value)) {
    const field = fields[fieldName];
    if (!field) {
      continue;
    }

    if (field.type === 'object') {
      next[fieldName] = stripUnknownObjectValue(fieldValue, field);
    } else if (field.type === 'array' && field.items?.type === 'object' && Array.isArray(fieldValue)) {
      next[fieldName] = fieldValue.map((item) => stripUnknownObjectValue(item, field.items));
    } else {
      next[fieldName] = fieldValue;
    }
  }

  return next;
}

function stripUnknownObjectValue(value: unknown, field: SchemaField): unknown {
  if (field.additionalProperties === true || !isPlainRecord(value)) {
    return value;
  }

  return stripUnknownFields(value, fieldsForObjectValue(value, field));
}

function fieldsForObjectValue(value: Record<string, unknown>, field: SchemaField): Record<string, SchemaField> {
  if (!field.discriminator || !field.variants) {
    return field.fields ?? {};
  }

  const discriminatorValue = value?.[field.discriminator];
  const variant = field.variants[String(discriminatorValue)];
  if (!variant) {
    return field.fields ?? {};
  }

  return {
    [field.discriminator]: {
      type: 'enum',
      values: [String(discriminatorValue)],
      required: true,
    },
    ...(variant.fields ?? {}),
  };
}

function cloneInput(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }

  return structuredClone(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
