import { loadConfig } from '../../config.js';
import { dbError, listChoices } from '../../errors.js';
import { resolveResource } from '../../names.js';
import { loadProjectSchema } from './project.js';
import { callFieldResolver, valueFromResolveManyResult } from './resolvers.js';
import { validateRecordAgainstResource } from './validation.js';

export async function loadDbSchema(options = {}) {
  const rawOptions = typeof options === 'string'
    ? { from: options }
    : { ...options };
  const load = rawOptions.load ?? 'schema';
  const config = await loadConfig({
    ...rawOptions,
    load,
  });
  const project = await loadProjectSchema(config, {
    load: config.schemaLoadMode ?? load,
  });

  return createDbSchema(project, config);
}

export function createDbSchema(project, config) {
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

    resource(name) {
      return requireSchemaResource(resources, name);
    },

    resourceNames() {
      return [...resources.keys()];
    },

    validator(name, options = {}) {
      return createSchemaValidator(requireSchemaResource(resources, name), config, options);
    },

    resolver(selector, options = {}) {
      const { resourceName, fieldName } = parseResolverSelector(selector);
      const resource = requireSchemaResource(resources, resourceName);
      if (fieldName) {
        return createSchemaFieldResolver(resource, fieldName, config, options);
      }

      return createSchemaResourceResolverMap(resource, config, options);
    },

    validate(name, value, options = {}) {
      return this.validator(name, options).validate(value);
    },

    assert(name, value, options = {}) {
      return this.validator(name, options).assert(value);
    },

    toJSON() {
      return project.schema;
    },
  };
}

export function createSchemaResourceResolverMap(resource, config, options = {}) {
  const resolvers = {};
  for (const fieldName of Object.keys(resource.resolvers?.fields ?? {})) {
    resolvers[fieldName] = createSchemaFieldResolver(resource, fieldName, config, options);
  }
  return resolvers;
}

export function createSchemaFieldResolver(resource, fieldName, config, options = {}) {
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

  const resolve = async (args = {}) => {
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
          ...args,
          records: manyArgs.records,
        }),
      );
      return valueFromResolveManyResult(values, resource, record, 0);
    }

    return undefined;
  };

  if (typeof resolver.resolve === 'function') {
    resolve.resolve = resolve;
  }

  if (typeof resolver.resolveMany === 'function') {
    resolve.resolveMany = async (args = {}) => {
      const normalizedArgs = normalizeResolveManyArgs(args);
      return callFieldResolver(resolver.resolveMany, normalizedArgs, resolverCallOptions(resource, fieldName, config, options, {
        ...args,
        records: normalizedArgs.records,
      }));
    };
  }

  return resolve;
}

export function createSchemaValidator(resource, config, options = {}) {
  const mode = normalizeValidationMode(options.mode);
  const unknownFields = normalizeValidatorUnknownFields(options.unknownFields);

  function validate(value, validateOptions = {}) {
    const activeMode = normalizeValidationMode(validateOptions.mode ?? mode);
    const activeUnknownFields = normalizeValidatorUnknownFields(validateOptions.unknownFields ?? unknownFields);
    const source = validateOptions.source ?? options.source ?? `${resource.name} ${activeMode} input`;
    const input = cloneInput(value);
    const withDefaults = applyValidationDefaults(input, resource, {
      mode: activeMode,
      applyDefaults: validateOptions.applyDefaults ?? options.applyDefaults,
    });
    const sanitized = activeUnknownFields === 'strip'
      ? stripUnknownFields(withDefaults, resource.fields ?? {})
      : withDefaults;
    const validationConfig = {
      ...config,
      schema: {
        ...config.schema,
        unknownFields: activeUnknownFields === 'strip' ? 'allow' : activeUnknownFields,
      },
    };
    const validationResource = validationResourceForMode(resource, sanitized, activeMode);
    const diagnostics = validateRecordAgainstResource(sanitized, validationResource, validationConfig, {
      source,
      requireFields: activeMode !== 'patch',
    });
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

    return {
      ok: errors.length === 0,
      value: sanitized,
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
    assert(value, assertOptions = {}) {
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
  };
}

function parseResolverSelector(selector) {
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

function resolverCallOptions(resource, fieldName, config, options, args) {
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

function normalizeResolverArgs(args) {
  if (args === undefined || args === null) {
    return {};
  }

  if (Array.isArray(args)) {
    return { records: args };
  }

  if (typeof args === 'object') {
    return args;
  }

  return { value: args };
}

function normalizeResolveManyArgs(args) {
  const normalizedArgs = normalizeResolverArgs(args);
  if (Array.isArray(normalizedArgs.records)) {
    return normalizedArgs;
  }

  return {
    ...normalizedArgs,
    records: [],
  };
}

function requireSchemaResource(resources, name) {
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

function normalizeValidationMode(value = 'create') {
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

function normalizeValidatorUnknownFields(value = 'error') {
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

function validationResourceForMode(resource, value, mode) {
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

function applyValidationDefaults(value, resource, options) {
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

function stripUnknownFields(value, fields) {
  if (!isPlainRecord(value)) {
    return value;
  }

  const next = {};
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

function stripUnknownObjectValue(value, field) {
  if (field.additionalProperties === true || !isPlainRecord(value)) {
    return value;
  }

  return stripUnknownFields(value, fieldsForObjectValue(value, field));
}

function fieldsForObjectValue(value, field) {
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

function cloneInput(value) {
  if (!isPlainRecord(value)) {
    return value;
  }

  return structuredClone(value);
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
