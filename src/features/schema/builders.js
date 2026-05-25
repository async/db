import { isStandardSchema } from './standard-schema.js';

export function collection(definition, options = undefined) {
  return resourceDefinition('collection', definition, options);
}

export function document(definition, options = undefined) {
  return resourceDefinition('document', definition, options);
}

export function files(patterns, options = {}) {
  return {
    kind: 'files',
    patterns: Array.isArray(patterns) ? [...patterns] : [patterns],
    read: options.read ?? 'frontmatter',
  };
}

function makeField(type, extras = {}) {
  return {
    type,
    ...extras,
  };
}

export const field = {
  string(options = {}) {
    return makeField('string', options);
  },

  datetime(options = {}) {
    return makeField('datetime', options);
  },

  number(options = {}) {
    return makeField('number', options);
  },

  boolean(options = {}) {
    return makeField('boolean', options);
  },

  enum(values, options = {}) {
    return makeField('enum', {
      values,
      ...options,
    });
  },

  object(fieldsOrOptions = {}, maybeOptions = {}) {
    if (fieldsOrOptions && fieldsOrOptions.fields) {
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

  array(items = { type: 'unknown' }, options = {}) {
    return makeField('array', {
      items,
      ...options,
    });
  },

  json(options = {}) {
    return makeField('unknown', options);
  },

  meta(options = {}) {
    const { type = 'unknown', ...metadata } = options;
    return makeField(type, {
      ...metadata,
      metadataOnly: true,
    });
  },

  nullable(definition, options = {}) {
    return {
      ...definition,
      ...options,
      nullable: true,
    };
  },

  computed(definition, resolver = {}) {
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

function resourceDefinition(kind, definition, options) {
  if (isStandardSchema(definition)) {
    return {
      ...(options ?? {}),
      kind,
      validator: definition,
    };
  }

  return {
    ...definition,
    kind,
  };
}

function isFieldMap(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).some((entry) => entry && typeof entry === 'object' && 'type' in entry);
}
