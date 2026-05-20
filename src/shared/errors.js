export class DbError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'DbError';
    this.code = code;
    this.status = options.status ?? 400;
    this.hint = options.hint;
    this.details = options.details;
  }
}

export function dbError(code, message, options = {}) {
  return new DbError(code, message, options);
}

export function serializeError(error, fallbackCode = 'DB_ERROR') {
  return {
    error: {
      code: error.code ?? fallbackCode,
      message: error.message,
      hint: error.hint,
      details: error.details,
    },
  };
}

export function graphqlError(error, fallbackCode = 'GRAPHQL_ERROR') {
  return {
    message: error.message,
    extensions: {
      code: error.code ?? fallbackCode,
      hint: error.hint,
      details: error.details,
    },
  };
}

export function describeValue(value) {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

export function listChoices(values, options = {}) {
  const max = options.max ?? 8;
  const list = [...values].filter(Boolean).slice(0, max);
  if (list.length === 0) {
    return '(none)';
  }

  const suffix = values.length > max ? `, and ${values.length - max} more` : '';
  return list.map((value) => `"${value}"`).join(', ') + suffix;
}
