import { dbError } from './errors.js';
import { createClientCache, createIndexedDbCacheStorage } from './client-cache.js';
import { operationRequest } from './shared/operations.js';

export { createIndexedDbCacheStorage };

export function createDbClient(options = {}) {
  const baseUrl = options.baseUrl ?? '';
  const apiBase = normalizeBasePath(options.apiBase ?? '/__db');
  const forkPaths = forkPathsForOptions(options);
  const restBasePath = options.restBasePath ?? forkPaths.restBasePath ?? '';
  const graphqlPath = options.graphqlPath ?? forkPaths.graphqlPath ?? '/graphql';
  const restBatchPath = options.restBatchPath ?? forkPaths.restBatchPath ?? `${apiBase}/batch`;
  const manifestPath = options.manifestPath ?? forkPaths.manifestPath ?? `${apiBase}/manifest.json`;
  const batching = normalizeBatching(options.batching);
  const cache = createClientCache({
    cache: options.cache,
    cacheNamespace: {
      baseUrl,
      apiBase,
      fork: options.fork ?? null,
      manifestPath,
    },
    restBasePath,
    fetchManifest: () => getJson(resolveUrl(baseUrl, manifestPath)),
    createEventSource(path) {
      if (typeof EventSource !== 'function') {
        return null;
      }
      return new EventSource(resolveUrl(baseUrl, path));
    },
  });

  const graphqlQueue = createQueue((requests) => graphqlBatch(requests), batching, {
    shouldDedupeRequest: isGraphqlDedupeSafe,
  });
  const restQueue = createQueue((requests) => restBatch(requests), batching, {
    shouldDedupeRequest: isRestDedupeSafe,
  });

  async function graphql(query, variables, requestOptions = {}) {
    const request = typeof query === 'string' ? { query, variables } : query;
    if (cache.enabled && isGraphqlDedupeSafe(request)) {
      return cache.executeGraphqlRead(request, () => graphqlDirect(request), requestOptions);
    }

    if (shouldBatch(requestOptions, batching)) {
      const result = await graphqlQueue({ request });
      cache.recordGraphqlWrite(result);
      return result;
    }

    const result = await graphqlDirect(request);
    cache.recordGraphqlWrite(result);
    return result;
  }

  async function graphqlDirect(request) {
    return postJson(resolveUrl(baseUrl, graphqlPath), request);
  }

  async function graphqlBatch(requests) {
    return postJson(resolveUrl(baseUrl, graphqlPath), requests);
  }

  async function rest(method, path, body, requestOptions = {}) {
    const request = normalizeRestRequest(method, path, body);
    return executeRestRequest(request, requestOptions);
  }

  async function executeRestRequest(request, requestOptions = {}) {
    if (cache.enabled && isRestDedupeSafe(request)) {
      return cache.executeRestRead(request, () => restDirect(request), requestOptions);
    }

    if (shouldBatch(requestOptions, batching)) {
      const result = await restQueue({ request });
      cache.recordRestWrite(request, result);
      return result;
    }

    const result = await restDirect(request);
    cache.recordRestWrite(request, result);
    return result;
  }

  async function restDirect(request) {
    const init = {
      method: request.method,
      headers: {
        'content-type': 'application/json',
      },
    };

    if (!['GET', 'DELETE'].includes(request.method) && request.body !== undefined) {
      init.body = JSON.stringify(request.body);
    }

    const response = await fetch(resolveUrl(baseUrl, joinPaths(restBasePath, request.path)), init);
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await readResponseBody(response),
    };
  }

  async function restBatch(requests) {
    return postJson(resolveUrl(baseUrl, restBatchPath), requests.map(normalizeRestRequestObject));
  }

  async function operation(template, variables = {}, requestOptions = {}) {
    const request = typeof template === 'string' && !isRestOperationString(template)
      ? { ref: template }
      : operationRequest(template, variables);

    return executeOperationRequest(request, variables, requestOptions);
  }

  async function query(template, variables = {}, requestOptions = {}) {
    const request = typeof template === 'string' && !isRestOperationString(template)
      ? { ref: template }
      : operationRequest(template, variables);

    return executeOperationRequest(request, variables, requestOptions);
  }

  async function executeOperationRequest(request, variables, requestOptions) {
    if (request.ref) {
      return postJson(resolveUrl(baseUrl, `${apiBase}/operations/${encodeURIComponent(request.ref)}`), {
        variables,
      });
    }

    if (request.kind === 'graphql') {
      return graphql({
        query: request.query,
        variables: request.variables,
        operationName: request.operationName,
      }, undefined, requestOptions);
    }

    return executeRestRequest(request, requestOptions).then((result) => result.body);
  }

  graphql.batch = graphqlBatch;
  graphql.request = graphql;
  rest.batch = restBatch;
  rest.request = rest;
  rest.get = (path, requestOptions) => rest('GET', path, undefined, requestOptions);
  rest.post = (path, body, requestOptions) => rest('POST', path, body, requestOptions);
  rest.patch = (path, body, requestOptions) => rest('PATCH', path, body, requestOptions);
  rest.put = (path, body, requestOptions) => rest('PUT', path, body, requestOptions);
  rest.delete = (path, requestOptions) => rest('DELETE', path, undefined, requestOptions);

  return {
    cache: cache.publicApi,
    graphql,
    operation,
    query,
    rest,
  };
}

function forkPathsForOptions(options) {
  if (!options.fork) {
    return {};
  }

  if (options.restBasePath || options.graphqlPath || options.restBatchPath) {
    throw dbError(
      'CLIENT_FORK_PATH_CONFLICT',
      'The client fork option cannot be combined with manual REST, batch, or GraphQL paths.',
      {
        hint: 'Use either { fork: "legacy-demo" } or explicit restBasePath/graphqlPath/restBatchPath options.',
      },
    );
  }

  const fork = normalizeForkName(options.fork);
  const apiBase = normalizeBasePath(options.apiBase ?? '/__db');
  const base = `${apiBase}/forks/${encodeURIComponent(fork)}`;
  return {
    restBasePath: `${base}/rest`,
    restBatchPath: `${base}/batch`,
    graphqlPath: `${base}/graphql`,
    manifestPath: `${base}/manifest.json`,
  };
}

function normalizeForkName(value) {
  const name = String(value ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw dbError(
      'CLIENT_INVALID_FORK_NAME',
      `Invalid db fork name "${name}".`,
      {
        hint: 'Use a folder-style name with letters, numbers, underscores, or hyphens, such as "legacy-demo".',
        details: {
          fork: name,
        },
      },
    );
  }
  return name;
}

function normalizeBatching(value) {
  if (value === true) {
    return {
      enabled: true,
      delayMs: 10,
      dedupe: 'reads',
    };
  }

  if (!value) {
    return {
      enabled: false,
      delayMs: 10,
      dedupe: 'reads',
    };
  }

  return {
    enabled: Boolean(value.enabled),
    delayMs: Number(value.delayMs ?? 10),
    dedupe: normalizeDedupeMode(value.dedupe),
  };
}

function normalizeDedupeMode(value) {
  if (value === false) {
    return false;
  }

  if (value === 'all') {
    return 'all';
  }

  return 'reads';
}

function shouldBatch(requestOptions, batching) {
  if (requestOptions?.batch === false) {
    return false;
  }

  if (requestOptions?.batch === true) {
    return true;
  }

  return batching.enabled;
}

function isRestOperationString(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.startsWith('/')) {
    return true;
  }

  const methodMatch = trimmed.match(/^(GET|POST|PUT|PATCH|DELETE)\s+/i);
  if (!methodMatch) {
    return false;
  }

  return trimmed.slice(methodMatch[0].length).trimStart().startsWith('/');
}

function createQueue(flush, batching, options = {}) {
  let pending = [];
  let timer = null;

  return (item) => new Promise((resolve, reject) => {
    pending.push({
      ...item,
      resolve,
      reject,
    });

    if (!timer) {
      timer = setTimeout(async () => {
        const items = pending;
        pending = [];
        timer = null;

        try {
          const groups = batching.dedupe ? groupQueuedItems(items, (request) => shouldDedupeRequest(request, batching, options)) : items.map((queued) => ({
            request: queued.request,
            queued: [queued],
          }));
          const results = await flush(groups.map((group) => group.request));
          groups.forEach((group, index) => {
            for (const queued of group.queued) {
              queued.resolve(results[index]);
            }
          });
        } catch (error) {
          items.forEach((queued) => queued.reject(error));
        }
      }, batching.delayMs);
    }
  });
}

function shouldDedupeRequest(request, batching, options) {
  if (batching.dedupe === 'all') {
    return true;
  }

  if (batching.dedupe === 'reads') {
    return options.shouldDedupeRequest?.(request) === true;
  }

  return false;
}

function groupQueuedItems(items, canDedupe) {
  const groups = [];
  let readSegment = new Map();

  for (const item of items) {
    if (!canDedupe(item.request)) {
      groups.push({
        request: item.request,
        queued: [item],
      });
      readSegment = new Map();
      continue;
    }

    const key = stableStringify(item.request);
    const group = readSegment.get(key);
    if (group) {
      group.queued.push(item);
    } else {
      const nextGroup = {
        request: item.request,
        queued: [item],
      };
      readSegment.set(key, nextGroup);
      groups.push(nextGroup);
    }
  }

  return groups;
}

function isGraphqlDedupeSafe(request) {
  const query = String(request.query ?? '').trimStart();
  return !/^(mutation|subscription)\b/.test(query);
}

function isRestDedupeSafe(request) {
  return String(request.method ?? 'GET').toUpperCase() === 'GET';
}

async function postJson(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw dbError(
      'CLIENT_FETCH_FAILED',
      `db client could not reach ${url}.`,
      {
        hint: 'Make sure async-db serve is running and baseUrl points at the correct host and port.',
        details: {
          url,
          cause: error.message,
        },
      },
    );
  }

  const responseBody = await readResponseBody(response);
  if (response.ok === false) {
    throw dbError(
      'CLIENT_HTTP_ERROR',
      `db client request to ${url} failed with HTTP ${response.status}.`,
      {
        status: response.status,
        hint: 'Inspect details.responseBody for the server error payload.',
        details: {
          url,
          status: response.status,
          responseBody,
        },
      },
    );
  }

  return responseBody;
}

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    });
  } catch (error) {
    throw dbError(
      'CLIENT_FETCH_FAILED',
      `db client could not reach ${url}.`,
      {
        hint: 'Make sure async-db serve is running and baseUrl points at the correct host and port.',
        details: {
          url,
          cause: error.message,
        },
      },
    );
  }

  const responseBody = await readResponseBody(response);
  if (response.ok === false) {
    throw dbError(
      'CLIENT_HTTP_ERROR',
      `db client request to ${url} failed with HTTP ${response.status}.`,
      {
        status: response.status,
        hint: 'Inspect details.responseBody for the server error payload.',
        details: {
          url,
          status: response.status,
          responseBody,
        },
      },
    );
  }

  return responseBody;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeRestRequest(method, path, body) {
  if (typeof method === 'object' && method !== null) {
    return normalizeRestRequestObject(method);
  }

  return normalizeRestRequestObject({
    method,
    path,
    body,
  });
}

function normalizeRestRequestObject(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw dbError(
      'CLIENT_REST_INVALID_REQUEST',
      'REST request must be an object or method/path arguments.',
      {
        hint: 'Use client.rest("GET", "/users") or client.rest({ method: "GET", path: "/users" }).',
      },
    );
  }

  return {
    method: String(request.method ?? 'GET').toUpperCase(),
    path: request.path ?? '/',
    body: request.body,
  };
}

function resolveUrl(baseUrl, path) {
  if (!baseUrl) {
    return path;
  }

  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
}

function joinPaths(basePath, requestPath) {
  if (!basePath) {
    return requestPath;
  }

  const normalizedBase = `/${String(basePath).replace(/^\/+/, '').replace(/\/+$/, '')}`;
  const normalizedPath = `/${String(requestPath ?? '/').replace(/^\/+/, '')}`;
  return `${normalizedBase}${normalizedPath === '/' ? '' : normalizedPath}`;
}

function normalizeBasePath(value) {
  const path = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return path === '/' ? '' : path;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}
