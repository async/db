import { dbError } from './errors.js';
import { createClientCache, createIndexedDbCacheStorage } from './client-cache.js';
import { operationRequest, type OperationRequestResult, type OperationTemplate, type OperationVariables } from './shared/operations.js';

export { createIndexedDbCacheStorage };

type DedupeMode = false | 'reads' | 'all';

type ClientBatchingOptions = boolean | {
  enabled?: boolean;
  delayMs?: number;
  dedupe?: boolean | 'reads' | 'all';
};

type NormalizedBatching = {
  enabled: boolean;
  delayMs: number;
  dedupe: DedupeMode;
};

type ClientRequestOptions = {
  batch?: boolean;
  cache?: unknown;
};

type ClientOptions = {
  baseUrl?: string;
  apiBase?: string;
  restBasePath?: string;
  graphqlPath?: string;
  restBatchPath?: string;
  manifestPath?: string;
  batching?: ClientBatchingOptions;
  cache?: unknown;
};

type GraphqlRequest = {
  query: string;
  variables?: OperationVariables;
  operationName?: string | null;
  [key: string]: unknown;
};

type RestRequestInput = {
  method?: string;
  path?: string;
  body?: unknown;
  [key: string]: unknown;
};

type RestRequest = {
  method: string;
  path: string;
  body?: unknown;
};

type RestResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

type ClientCache = {
  enabled: boolean;
  publicApi: unknown;
  executeGraphqlRead: (request: GraphqlRequest, network: () => Promise<unknown>, options?: ClientRequestOptions) => Promise<unknown>;
  executeRestRead: (request: RestRequest, network: () => Promise<RestResponse>, options?: ClientRequestOptions) => Promise<RestResponse>;
  recordGraphqlWrite: (result: unknown) => void;
  recordRestWrite: (request: RestRequest, result: RestResponse) => void;
};

type QueueItem<TRequest, TResult> = {
  request: TRequest;
  resolve: (value: TResult) => void;
  reject: (reason?: unknown) => void;
};

type QueueGroup<TRequest, TResult> = {
  request: TRequest;
  queued: Array<QueueItem<TRequest, TResult>>;
};

type QueueOptions<TRequest> = {
  shouldDedupeRequest?: (request: TRequest) => boolean;
};

type JsonFetchResponse = Pick<Response, 'ok' | 'status' | 'text'>;

export function createDbClient(options: ClientOptions = {}) {
  rejectRemovedForkOption(options);
  const baseUrl = options.baseUrl ?? '';
  const apiBase = normalizeBasePath(options.apiBase ?? '/__db');
  const restBasePath = options.restBasePath ?? '';
  const graphqlPath = options.graphqlPath ?? '/graphql';
  const restBatchPath = options.restBatchPath ?? `${apiBase}/batch`;
  const manifestPath = options.manifestPath ?? `${apiBase}/manifest.json`;
  const batching = normalizeBatching(options.batching);
  const cache = createClientCache({
    cache: options.cache,
    cacheNamespace: {
      baseUrl,
      apiBase,
      manifestPath,
    },
    restBasePath,
    fetchManifest: () => getJson(resolveUrl(baseUrl, manifestPath)),
    createEventSource(path: string) {
      if (typeof EventSource !== 'function') {
        return null;
      }
      return new EventSource(resolveUrl(baseUrl, path));
    },
  }) as ClientCache;

  const graphqlQueue = createQueue<GraphqlRequest, unknown>((requests) => graphqlBatch(requests), batching, {
    shouldDedupeRequest: isGraphqlDedupeSafe,
  });
  const restQueue = createQueue<RestRequest, RestResponse>((requests) => restBatch(requests), batching, {
    shouldDedupeRequest: isRestDedupeSafe,
  });

  async function graphql(
    query: string | GraphqlRequest,
    variables?: OperationVariables,
    requestOptions: ClientRequestOptions = {},
  ): Promise<unknown> {
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

  async function graphqlDirect(request: GraphqlRequest): Promise<unknown> {
    return postJson(resolveUrl(baseUrl, graphqlPath), request);
  }

  async function graphqlBatch(requests: GraphqlRequest[]): Promise<unknown[]> {
    return postJson(resolveUrl(baseUrl, graphqlPath), requests) as Promise<unknown[]>;
  }

  async function rest(
    method: string | RestRequestInput,
    path?: string,
    body?: unknown,
    requestOptions: ClientRequestOptions = {},
  ): Promise<RestResponse> {
    const request = normalizeRestRequest(method, path, body);
    return executeRestRequest(request, requestOptions);
  }

  async function executeRestRequest(request: RestRequest, requestOptions: ClientRequestOptions = {}): Promise<RestResponse> {
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

  async function restDirect(request: RestRequest): Promise<RestResponse> {
    const init: RequestInit = {
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

  async function restBatch(requests: RestRequest[]): Promise<RestResponse[]> {
    return postJson(resolveUrl(baseUrl, restBatchPath), requests.map(normalizeRestRequestObject)) as Promise<RestResponse[]>;
  }

  async function operation(
    template: OperationTemplate,
    variables: OperationVariables = {},
    requestOptions: ClientRequestOptions = {},
  ): Promise<unknown> {
    const request = typeof template === 'string' && !isRestOperationString(template)
      ? { ref: template }
      : operationRequest(template, variables);

    return executeOperationRequest(request, variables, requestOptions);
  }

  async function query(
    template: OperationTemplate,
    variables: OperationVariables = {},
    requestOptions: ClientRequestOptions = {},
  ): Promise<unknown> {
    const request = typeof template === 'string' && !isRestOperationString(template)
      ? { ref: template }
      : operationRequest(template, variables);

    return executeOperationRequest(request, variables, requestOptions);
  }

  async function executeOperationRequest(
    request: OperationRequestResult,
    variables: OperationVariables,
    requestOptions: ClientRequestOptions,
  ): Promise<unknown> {
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

    return executeRestRequest(request as RestRequest, requestOptions).then((result) => result.body);
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

function rejectRemovedForkOption(options: ClientOptions): void {
  const fork = (options as Record<string, unknown>).fork;
  if (fork !== undefined) {
    throw dbError(
      'CLIENT_FORK_OPTION_REMOVED',
      'The HTTP client fork option was removed with legacy data-folder fork routes.',
      {
        hint: 'Use the package API runtime scope with db.forks.open(name) and tenant.branches.open(name), or pass explicit REST/GraphQL paths for an app-owned tenant route.',
        details: {
          fork,
        },
      },
    );
  }
}

function normalizeBatching(value: ClientBatchingOptions | undefined): NormalizedBatching {
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

function normalizeDedupeMode(value: boolean | 'reads' | 'all' | undefined): DedupeMode {
  if (value === false) {
    return false;
  }

  if (value === 'all') {
    return 'all';
  }

  return 'reads';
}

function shouldBatch(requestOptions: ClientRequestOptions | undefined, batching: NormalizedBatching): boolean {
  if (requestOptions?.batch === false) {
    return false;
  }

  if (requestOptions?.batch === true) {
    return true;
  }

  return batching.enabled;
}

function isRestOperationString(value: unknown): boolean {
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

function createQueue<TRequest, TResult>(
  flush: (requests: TRequest[]) => Promise<TResult[]>,
  batching: NormalizedBatching,
  options: QueueOptions<TRequest> = {},
): (item: { request: TRequest }) => Promise<TResult> {
  let pending: Array<QueueItem<TRequest, TResult>> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

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

function shouldDedupeRequest<TRequest>(request: TRequest, batching: NormalizedBatching, options: QueueOptions<TRequest>): boolean {
  if (batching.dedupe === 'all') {
    return true;
  }

  if (batching.dedupe === 'reads') {
    return options.shouldDedupeRequest?.(request) === true;
  }

  return false;
}

function groupQueuedItems<TRequest, TResult>(
  items: Array<QueueItem<TRequest, TResult>>,
  canDedupe: (request: TRequest) => boolean,
): Array<QueueGroup<TRequest, TResult>> {
  const groups: Array<QueueGroup<TRequest, TResult>> = [];
  let readSegment = new Map<string, QueueGroup<TRequest, TResult>>();

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

function isGraphqlDedupeSafe(request: GraphqlRequest): boolean {
  const query = String(request.query ?? '').trimStart();
  return !/^(mutation|subscription)\b/.test(query);
}

function isRestDedupeSafe(request: RestRequest): boolean {
  return String(request.method ?? 'GET').toUpperCase() === 'GET';
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  let response: JsonFetchResponse;
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
          cause: error instanceof Error ? error.message : String(error),
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

async function getJson(url: string): Promise<unknown> {
  let response: JsonFetchResponse;
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
          cause: error instanceof Error ? error.message : String(error),
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

async function readResponseBody(response: JsonFetchResponse): Promise<unknown> {
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

function normalizeRestRequest(method: string | RestRequestInput, path?: string, body?: unknown): RestRequest {
  if (typeof method === 'object' && method !== null) {
    return normalizeRestRequestObject(method);
  }

  return normalizeRestRequestObject({
    method: String(method),
    path,
    body,
  });
}

function normalizeRestRequestObject(request: RestRequestInput): RestRequest {
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

function resolveUrl(baseUrl: string, path: string): string {
  if (!baseUrl) {
    return path;
  }

  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
}

function joinPaths(basePath: string, requestPath: string): string {
  if (!basePath) {
    return requestPath;
  }

  const normalizedBase = `/${String(basePath).replace(/^\/+/, '').replace(/\/+$/, '')}`;
  const normalizedPath = `/${String(requestPath ?? '/').replace(/^\/+/, '')}`;
  return `${normalizedBase}${normalizedPath === '/' ? '' : normalizedPath}`;
}

function normalizeBasePath(value: unknown): string {
  const path = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return path === '/' ? '' : path;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
