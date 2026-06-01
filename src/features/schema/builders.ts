import { isStandardSchema } from './standard-schema.js';

export type SchemaFieldDefinition = {
  type: string;
  fields?: Record<string, SchemaFieldDefinition>;
  items?: SchemaFieldDefinition;
  metadataOnly?: boolean;
  computed?: boolean;
  readOnly?: boolean;
  required?: boolean;
  nullable?: boolean;
  resolve?: ComputedResolveFunction;
  resolveMany?: ComputedResolveManyFunction;
  [key: string]: unknown;
};

export type SchemaResourceDefinition = {
  kind?: 'collection' | 'document';
  fields?: Record<string, SchemaFieldDefinition>;
  validator?: unknown;
  [key: string]: unknown;
};

type FieldOptions = Omit<SchemaFieldDefinition, 'type'> & {
  type?: string;
};

type ComputedResolveFunction = (...args: unknown[]) => unknown;
type ComputedResolveManyFunction = (...args: unknown[]) => unknown;

type ComputedResolver = {
  resolve?: ComputedResolveFunction;
  resolveMany?: ComputedResolveManyFunction;
};

type FilesOptions = {
  read?: string;
};

export function collection(definition: SchemaResourceDefinition | unknown, options: SchemaResourceDefinition | undefined = undefined) {
  return resourceDefinition('collection', definition, options);
}

export function document(definition: SchemaResourceDefinition | unknown, options: SchemaResourceDefinition | undefined = undefined) {
  return resourceDefinition('document', definition, options);
}

export function files(patterns: string | readonly string[], options: FilesOptions = {}) {
  return {
    kind: 'files',
    patterns: Array.isArray(patterns) ? [...patterns] : [patterns],
    read: options.read ?? 'frontmatter',
  };
}

function makeField(type: string, extras: FieldOptions = {}): SchemaFieldDefinition {
  return {
    type,
    ...extras,
  };
}

export const field = {
  string(options: FieldOptions = {}) {
    return makeField('string', options);
  },

  datetime(options: FieldOptions = {}) {
    return makeField('datetime', options);
  },

  number(options: FieldOptions = {}) {
    return makeField('number', options);
  },

  boolean(options: FieldOptions = {}) {
    return makeField('boolean', options);
  },

  enum(values: readonly (string | number | boolean)[], options: FieldOptions = {}) {
    return makeField('enum', {
      values,
      ...options,
    });
  },

  object(
    fieldsOrOptions: Record<string, SchemaFieldDefinition> | FieldOptions = {},
    maybeOptions: FieldOptions = {},
  ) {
    if (isRecord(fieldsOrOptions) && fieldsOrOptions.fields) {
      return makeField('object', fieldsOrOptions);
    }

    if (isFieldMap(fieldsOrOptions)) {
      return makeField('object', {
        fields: fieldsOrOptions,
        ...maybeOptions,
      });
    }

    return makeField('object', fieldsOrOptions);
  },

  array(items: SchemaFieldDefinition = { type: 'unknown' }, options: FieldOptions = {}) {
    return makeField('array', {
      items,
      ...options,
    });
  },

  json(options: FieldOptions = {}) {
    return makeField('unknown', options);
  },

  meta(options: FieldOptions = {}) {
    const { type = 'unknown', ...metadata } = options;
    return makeField(type, {
      ...metadata,
      metadataOnly: true,
    });
  },

  nullable(definition: SchemaFieldDefinition, options: FieldOptions = {}) {
    return {
      ...definition,
      ...options,
      nullable: true,
    };
  },

  computed(definition: SchemaFieldDefinition, resolver: ComputedResolveFunction | ComputedResolver = {}) {
    const normalizedResolver = typeof resolver === 'function'
      ? { resolve: resolver }
      : resolver;
    return {
      ...definition,
      computed: true,
      readOnly: true,
      required: false,
      resolve: normalizedResolver?.resolve,
      resolveMany: normalizedResolver?.resolveMany,
    };
  },
};

function resourceDefinition(
  kind: 'collection' | 'document',
  definition: SchemaResourceDefinition | unknown,
  options: SchemaResourceDefinition | undefined,
) {
  if (isStandardSchema(definition)) {
    return {
      ...(options ?? {}),
      kind,
      validator: definition,
    };
  }

  return {
    ...(isRecord(definition) ? definition : {}),
    kind,
  };
}

function isFieldMap(value: unknown): value is Record<string, SchemaFieldDefinition> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).some((entry) => entry && typeof entry === 'object' && 'type' in entry);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
