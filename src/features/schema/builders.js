export function collection(definition) {
  return {
    ...definition,
    kind: 'collection',
  };
}

export function document(definition) {
  return {
    ...definition,
    kind: 'document',
  };
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

function isFieldMap(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).some((entry) => entry && typeof entry === 'object' && 'type' in entry);
}
