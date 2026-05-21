import { dbError } from './errors.js';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export function normalizeOperationTemplate(input) {
  if (typeof input === 'string') {
    return normalizeStringOperation(input);
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw dbError(
      'OPERATION_INVALID_TEMPLATE',
      'Registered operation must be a REST or GraphQL template.',
      {
        hint: 'Use "/users/{id}.json?select=id,name", { method: "GET", path: "/users/{id}.json", query: { select: "id,name" } }, or { query: "{ users { id } }" }.',
      },
    );
  }

  if (input.ref && !input.path && !input.query) {
    return {
      name: input.name,
      ref: String(input.ref),
    };
  }

  if (input.kind === 'graphql' || isGraphqlTemplateObject(input)) {
    return normalizeGraphqlOperation(input);
  }

  const method = normalizeMethod(input.method ?? 'GET');
  const path = normalizePath(input.path ?? '/');
  const query = normalizeQuery(input.query);
  const normalized = {
    method,
    path,
  };

  if (input.name) {
    normalized.name = String(input.name);
  }
  if (input.ref) {
    normalized.ref = String(input.ref);
  }
  if (query && Object.keys(query).length > 0) {
    normalized.query = query;
  }
  if ('body' in input) {
    normalized.body = input.body;
  }
  if (input.variables && typeof input.variables === 'object' && !Array.isArray(input.variables)) {
    normalized.variables = stableObject(input.variables);
  }

  return normalized;
}

export function canonicalOperation(input) {
  const operation = normalizeOperationTemplate(input);
  if (operation.kind === 'graphql') {
    const canonical = {
      kind: 'graphql',
      query: operation.query,
    };
    if (operation.operationName) {
      canonical.operationName = operation.operationName;
    }
    if (operation.variables) {
      canonical.variables = stableObject(operation.variables);
    }
    return canonical;
  }

  const canonical = {
    method: operation.method,
    path: operation.path,
  };
  if (operation.query) {
    canonical.query = stableObject(operation.query);
  }
  if ('body' in operation) {
    canonical.body = operation.body;
  }
  return canonical;
}

export function operationRequest(input, variables = {}) {
  const operation = normalizeOperationTemplate(input);
  if (operation.ref && !operation.path && operation.kind !== 'graphql') {
    return {
      ref: operation.ref,
    };
  }

  if (operation.kind === 'graphql') {
    return graphqlOperationRequest(operation, variables);
  }

  const placeholders = placeholdersForOperation(operation);
  const provided = Object.keys(variables ?? {});
  const missing = [...placeholders].filter((name) => !(name in (variables ?? {})));
  const extra = provided.filter((name) => !placeholders.has(name));

  if (missing.length > 0) {
    throw dbError(
      'OPERATION_VARIABLE_MISSING',
      `Operation is missing variable "${missing[0]}".`,
      {
        status: 400,
        hint: `Pass variables for: ${[...placeholders].join(', ')}.`,
        details: { missing, expectedVariables: [...placeholders] },
      },
    );
  }

  if (extra.length > 0) {
    throw dbError(
      'OPERATION_VARIABLE_UNKNOWN',
      `Operation received unknown variable "${extra[0]}".`,
      {
        status: 400,
        hint: `Only pass variables used by this operation: ${[...placeholders].join(', ')}.`,
        details: { extra, expectedVariables: [...placeholders] },
      },
    );
  }

  const path = substitutePath(operation.path, variables);
  const query = substituteValue(operation.query ?? {}, variables);
  const body = 'body' in operation ? substituteValue(operation.body, variables) : undefined;

  return {
    method: operation.method,
    path: pathWithQuery(path, query),
    body,
  };
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function normalizeStringOperation(input) {
  const trimmed = input.trim();
  const [maybeMethod, ...rest] = trimmed.split(/\s+/);
  const hasMethod = HTTP_METHODS.has(maybeMethod.toUpperCase());
  const method = hasMethod ? maybeMethod.toUpperCase() : 'GET';
  const target = hasMethod ? rest.join(' ') : trimmed;
  const url = new URL(target, 'http://db.local');
  const query = Object.fromEntries([...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const normalized = {
    method,
    path: normalizePath(decodeURIComponent(url.pathname)),
  };
  if (Object.keys(query).length > 0) {
    normalized.query = query;
  }
  return normalized;
}

function normalizeGraphqlOperation(input) {
  if (typeof input.query !== 'string' || input.query.trim() === '') {
    throw dbError(
      'OPERATION_INVALID_GRAPHQL_QUERY',
      'GraphQL operation query must be a non-empty string.',
      {
        status: 400,
        hint: 'Use { query: "query GetUser { users { id } }" }.',
      },
    );
  }

  const normalized = {
    kind: 'graphql',
    query: input.query,
  };
  if (input.name) {
    normalized.name = String(input.name);
  }
  if (input.ref) {
    normalized.ref = String(input.ref);
  }
  if (input.operationName !== undefined && input.operationName !== null) {
    normalized.operationName = String(input.operationName);
  }
  if (input.variables !== undefined) {
    if (!input.variables || typeof input.variables !== 'object' || Array.isArray(input.variables)) {
      throw dbError(
        'OPERATION_INVALID_GRAPHQL_VARIABLES',
        'GraphQL operation variables must be an object.',
        {
          status: 400,
          hint: 'Use variables such as { id: "{id}" }.',
        },
      );
    }
    normalized.variables = stableObject(input.variables);
  }
  return normalized;
}

function isGraphqlTemplateObject(input) {
  return !input.path && typeof input.query === 'string' && !input.method && !('body' in input);
}

function graphqlOperationRequest(operation, variables = {}) {
  const placeholders = new Set();
  if (operation.variables) {
    collectPlaceholders(operation.variables, placeholders);
  }
  const provided = Object.keys(variables ?? {});
  const missing = [...placeholders].filter((name) => !(name in (variables ?? {})));
  const extra = operation.variables
    ? provided.filter((name) => placeholders.size > 0 && !placeholders.has(name))
    : [];

  if (missing.length > 0) {
    throw dbError(
      'OPERATION_VARIABLE_MISSING',
      `Operation is missing variable "${missing[0]}".`,
      {
        status: 400,
        hint: `Pass variables for: ${[...placeholders].join(', ')}.`,
        details: { missing, expectedVariables: [...placeholders] },
      },
    );
  }

  if (extra.length > 0) {
    throw dbError(
      'OPERATION_VARIABLE_UNKNOWN',
      `Operation received unknown variable "${extra[0]}".`,
      {
        status: 400,
        hint: `Only pass variables used by this operation: ${[...placeholders].join(', ')}.`,
        details: { extra, expectedVariables: [...placeholders] },
      },
    );
  }

  return {
    kind: 'graphql',
    query: operation.query,
    variables: operation.variables ? substituteValue(operation.variables, variables) : (variables ?? {}),
    operationName: operation.operationName ?? null,
  };
}

function normalizeMethod(value) {
  const method = String(value ?? 'GET').toUpperCase();
  if (!HTTP_METHODS.has(method)) {
    throw dbError(
      'OPERATION_UNSUPPORTED_METHOD',
      `Operation method "${method}" is not supported.`,
      {
        status: 400,
        hint: 'Use GET, POST, PUT, PATCH, or DELETE.',
        details: { method },
      },
    );
  }
  return method;
}

function normalizePath(value) {
  const path = String(value ?? '/');
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeQuery(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return Object.fromEntries([...new URLSearchParams(value).entries()].sort(([left], [right]) => left.localeCompare(right)));
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return stableObject(value);
  }

  throw dbError(
    'OPERATION_INVALID_QUERY',
    'Operation query must be an object or query string.',
    {
      status: 400,
      hint: 'Use { select: "id,name" } or "select=id,name".',
    },
  );
}

function stableObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function placeholdersForOperation(operation) {
  const names = new Set();
  collectPlaceholders(operation.path, names);
  collectPlaceholders(operation.query, names);
  collectPlaceholders(operation.body, names);
  return names;
}

function collectPlaceholders(value, names) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
      names.add(match[1] ?? match[2]);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPlaceholders(item, names);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectPlaceholders(item, names);
    }
  }
}

function substitutePath(path, variables) {
  return path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => encodeURIComponent(String(variables[name])));
}

function substituteValue(value, variables) {
  if (typeof value === 'string') {
    const exactVariable = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/) ?? value.match(/^\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
    if (exactVariable) {
      return variables[exactVariable[1]];
    }
    return value
      .replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => String(variables[name]))
      .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => String(variables[name]));
  }

  if (Array.isArray(value)) {
    return value.map((item) => substituteValue(item, variables));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteValue(item, variables)]));
  }

  return value;
}

function pathWithQuery(path, query) {
  const entries = Object.entries(query ?? {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
      continue;
    }
    params.set(key, String(value));
  }

  return `${path}?${params.toString().replaceAll('%2C', ',')}`;
}
