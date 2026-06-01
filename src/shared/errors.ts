export class DbError extends Error {
  code: string;
  status: number;
  hint?: string;
  details?: unknown;

  constructor(code: string, message: string, options: DbErrorOptions = {}) {
    super(message);
    this.name = 'DbError';
    this.code = code;
    this.status = options.status ?? 400;
    this.hint = options.hint;
    this.details = options.details;
  }
}

export type DbErrorOptions = {
  status?: number;
  hint?: string;
  details?: unknown;
};

type ErrorLike = {
  code?: string;
  message?: string;
  hint?: string;
  details?: unknown;
};

export function dbError(code: string, message: string, options: DbErrorOptions = {}) {
  return new DbError(code, message, options);
}

export function serializeError(error: ErrorLike, fallbackCode = 'DB_ERROR') {
  return {
    error: {
      code: error.code ?? fallbackCode,
      message: error.message ?? String(error),
      hint: error.hint,
      details: error.details,
    },
  };
}

export function graphqlError(error: ErrorLike, fallbackCode = 'GRAPHQL_ERROR') {
  return {
    message: error.message ?? String(error),
    extensions: {
      code: error.code ?? fallbackCode,
      hint: error.hint,
      details: error.details,
    },
  };
}

export function describeValue(value: unknown) {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

export function listChoices(values: unknown[], options: { max?: number } = {}) {
  const max = options.max ?? 8;
  const list = [...values].filter(Boolean).slice(0, max);
  if (list.length === 0) {
    return '(none)';
  }

  const suffix = values.length > max ? `, and ${values.length - max} more` : '';
  return list.map((value) => `"${value}"`).join(', ') + suffix;
}
