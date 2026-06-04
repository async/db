import { dbError } from './errors.js';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export type OperationVariables = Record<string, unknown>;

export type OperationTemplateRecord = Record<string, unknown>;

export type OperationTemplate = string | OperationTemplateRecord;

export type NormalizedOperation = {
  kind?: 'graphql';
  name?: string;
  ref?: string;
  method?: string;
  path?: string;
  query?: string | OperationVariables;
  body?: unknown;
  variables?: OperationVariables;
  operationName?: string | null;
};

export type RegisteredOperation = NormalizedOperation & {
  name: string;
  ref: string;
};

export type OperationRequestResult = {
  kind?: 'graphql';
  ref?: string;
  query?: string;
  method?: string;
  path?: string;
  body?: unknown;
  variables?: OperationVariables;
  operationName?: string | null;
};

export function normalizeOperationTemplate(input: OperationTemplate): NormalizedOperation {
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

  const template = input as OperationTemplateRecord;

  if (template.ref && !template.path && !template.query) {
    return {
      name: stringValue(template.name),
      ref: String(template.ref),
    };
  }

  if (template.kind === 'graphql' || isGraphqlTemplateObject(template)) {
    return normalizeGraphqlOperation(template);
  }

  const method = normalizeMethod(template.method ?? 'GET');
  const operationPath = normalizePath(template.path ?? '/');
  const query = normalizeQuery(template.query);
  const normalized: NormalizedOperation = {
    method,
    path: operationPath,
  };

  if (template.name) {
    normalized.name = String(template.name);
  }
  if (template.ref) {
    normalized.ref = String(template.ref);
  }
  if (query && Object.keys(query).length > 0) {
    normalized.query = query;
  }
  if ('body' in template) {
    normalized.body = template.body;
  }
  if (template.variables && typeof template.variables === 'object' && !Array.isArray(template.variables)) {
    normalized.variables = stableObject(template.variables as OperationVariables);
  }

  return normalized;
}

export function canonicalOperation(input: OperationTemplate): NormalizedOperation {
  const operation = normalizeOperationTemplate(input);
  if (operation.kind === 'graphql') {
    const canonical: NormalizedOperation = {
      kind: 'graphql',
      query: String(operation.query ?? ''),
    };
    if (operation.operationName) {
      canonical.operationName = operation.operationName;
    }
    if (operation.variables) {
      canonical.variables = stableObject(operation.variables);
    }
    return canonical;
  }

  const canonical: NormalizedOperation = {
    method: operation.method,
    path: operation.path,
  };
  if (operation.query) {
    canonical.query = typeof operation.query === 'string'
      ? operation.query
      : stableObject(operation.query);
  }
  if ('body' in operation) {
    canonical.body = operation.body;
  }
  return canonical;
}

export function operationRequest(input: OperationTemplate, variables: OperationVariables = {}): OperationRequestResult {
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

  const operationPath = substitutePath(String(operation.path ?? '/'), variables);
  const query = substituteValue(operation.query ?? {}, variables) as OperationVariables;
  const body = 'body' in operation ? substituteValue(operation.body, variables) : undefined;

  return {
    method: operation.method,
    path: pathWithQuery(operationPath, query),
    body,
  };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function normalizeStringOperation(input: string): NormalizedOperation {
  const trimmed = input.trim();
  const [maybeMethod, ...rest] = trimmed.split(/\s+/);
  const hasMethod = HTTP_METHODS.has(maybeMethod.toUpperCase());
  const method = hasMethod ? maybeMethod.toUpperCase() : 'GET';
  const target = hasMethod ? rest.join(' ') : trimmed;
  let url: URL;
  try {
    url = new URL(target, 'http://db.local');
  } catch (error) {
    throw invalidOperationStringTemplate('invalid-url', error);
  }
  const query = Object.fromEntries([...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right)));
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    throw invalidOperationStringTemplate('invalid-encoding', error);
  }
  const normalized: NormalizedOperation = {
    method,
    path: normalizePath(pathname),
  };
  if (Object.keys(query).length > 0) {
    normalized.query = query;
  }
  return normalized;
}

function invalidOperationStringTemplate(reason: string, error: unknown): Error {
  return dbError(
    'OPERATION_INVALID_TEMPLATE',
    'Registered operation string must be a valid REST path or URL.',
    {
      status: 400,
      hint: 'Use a path such as "/users/{id}.json?select=id,name" or a method plus path such as "GET /users/{id}.json".',
      details: {
        reason,
        parserMessage: error instanceof Error ? error.message : String(error),
      },
    },
  );
}

function normalizeGraphqlOperation(input: OperationTemplateRecord): NormalizedOperation {
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

  const normalized: NormalizedOperation = {
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
    normalized.variables = stableObject(input.variables as OperationVariables);
  }
  return normalized;
}

function isGraphqlTemplateObject(input: OperationTemplateRecord): boolean {
  return !input.path && typeof input.query === 'string' && !input.method && !('body' in input);
}

function graphqlOperationRequest(operation: NormalizedOperation, variables: OperationVariables = {}): OperationRequestResult {
  const placeholders = new Set<string>();
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
    query: String(operation.query ?? ''),
    variables: operation.variables ? substituteValue(operation.variables, variables) as OperationVariables : (variables ?? {}),
    operationName: operation.operationName ?? null,
  };
}

function normalizeMethod(value: unknown): string {
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

function normalizePath(value: unknown): string {
  const path = String(value ?? '/');
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeQuery(value: unknown): OperationVariables | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return Object.fromEntries([...new URLSearchParams(value).entries()].sort(([left], [right]) => left.localeCompare(right)));
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return stableObject(value as OperationVariables);
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

function stableObject(value: OperationVariables): OperationVariables {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function placeholdersForOperation(operation: NormalizedOperation): Set<string> {
  const names = new Set<string>();
  collectPlaceholders(operation.path, names);
  collectPlaceholders(operation.query, names);
  collectPlaceholders(operation.body, names);
  return names;
}

function collectPlaceholders(value: unknown, names: Set<string>): void {
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

function substitutePath(path: string, variables: OperationVariables): string {
  return path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => encodeURIComponent(String(variables[name])));
}

function substituteValue(value: unknown, variables: OperationVariables): unknown {
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

function pathWithQuery(path: string, query?: OperationVariables): string {
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

function stringValue(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}
