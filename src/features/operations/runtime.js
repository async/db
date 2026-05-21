import { readFile } from 'node:fs/promises';
import { dbError } from '../../errors.js';
import { executeGraphql } from '../../graphql/index.js';
import { handleRestRequest } from '../../rest/handler.js';
import { normalizeOperationTemplate, operationRequest } from '../../shared/operations.js';
import { buildOperationRegistry } from './index.js';
import { operationMapFromEntries } from './maps.js';

export function createDbOperationHandler(db, options = {}) {
  const operationOptions = normalizeOperationOptions(db, options);
  return {
    enabled: operationOptions.enabled === true,
    options: operationOptions,
    async resolve(ref) {
      return resolveOperationRef(db, operationOptions, ref);
    },
    async execute(ref, variables = {}, executionOptions = {}) {
      if (operationOptions.enabled !== true) {
        throw dbError(
          'OPERATIONS_DISABLED',
          'Registered operations are not enabled.',
          {
            status: 404,
            hint: 'Set operations.enabled to true and provide operations.registry or outputs.operationRegistry.',
          },
        );
      }

      const operation = await resolveOperationRef(db, operationOptions, ref);
      if (!operation) {
        throw operationNotFound(ref);
      }

      const operationResult = operationRequest(operation, variables);
      if (operationResult.kind === 'graphql') {
        if (db.config.graphql?.enabled === false) {
          return {
            kind: 'graphql',
            status: 404,
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
            body: {
              error: {
                code: 'GRAPHQL_DISABLED',
                message: 'GraphQL endpoint is disabled.',
                hint: 'Set graphql.enabled to true in db.config.mjs to enable registered GraphQL operations.',
                details: {
                  graphqlEnabled: false,
                  ref: decodeOperationRef(ref),
                },
              },
            },
          };
        }

        return {
          kind: 'graphql',
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          body: await executeGraphql(db, {
            query: operationResult.query,
            variables: operationResult.variables,
            operationName: operationResult.operationName,
          }),
        };
      }

      const response = makeResultResponse();
      await handleRestRequest(
        db,
        internalRestRequest(operationResult),
        response,
        new URL(operationResult.path, 'http://db.local'),
        executionOptions.routes
          ? { ...executionOptions.routes, trace: executionOptions.trace }
          : { trace: executionOptions.trace },
      );

      return {
        kind: 'rest',
        status: response.status,
        headers: response.headers,
        body: response.bodyValue(),
        rawBody: response.body,
      };
    },
    async executeRequest(ref, body = {}, executionOptions = {}) {
      return this.execute(ref, body?.variables ?? {}, executionOptions);
    },
  };
}

function normalizeOperationOptions(db, options = {}) {
  const globalOptions = db.config.operations ?? {};
  const localOptions = options && typeof options === 'object' && Object.hasOwn(options, 'operations')
    ? options.operations
    : options;

  if (localOptions === false) {
    return {
      ...globalOptions,
      enabled: false,
      acceptRefs: normalizeAcceptRefs(globalOptions.acceptRefs),
    };
  }

  if (localOptions === true || localOptions === 'auto' || localOptions === undefined || localOptions === null) {
    return {
      ...globalOptions,
      enabled: globalOptions.enabled === true,
      acceptRefs: normalizeAcceptRefs(globalOptions.acceptRefs),
    };
  }

  if (typeof localOptions !== 'object') {
    return {
      ...globalOptions,
      enabled: globalOptions.enabled === true,
      acceptRefs: normalizeAcceptRefs(globalOptions.acceptRefs),
    };
  }

  const hasLocalRegistry = Boolean(localOptions.registry && Object.keys(localOptions.registry).length > 0)
    || typeof localOptions.resolveRef === 'function'
    || Boolean(localOptions.outFile);

  return {
    ...globalOptions,
    ...localOptions,
    enabled: localOptions.enabled ?? (hasLocalRegistry ? true : globalOptions.enabled === true),
    acceptRefs: normalizeAcceptRefs(localOptions.acceptRefs ?? globalOptions.acceptRefs),
  };
}

function normalizeAcceptRefs(value) {
  if (value === 'ref' || value === 'name' || value === 'both') {
    return value;
  }
  if (value === 'hash') {
    return 'ref';
  }
  return 'both';
}

async function resolveOperationRef(db, options, ref) {
  const decodedRef = decodeOperationRef(ref);
  const registry = await operationRegistry(db.config, options);
  const context = {
    ref,
    decodedRef,
    acceptRefs: options.acceptRefs,
    registry,
    operation: null,
  };

  let operation = null;
  if (typeof options.resolveRef === 'function') {
    operation = await options.resolveRef(decodedRef, context);
    if (operation) {
      operation = normalizeRegistryOperation(decodedRef, operation);
    }
  }
  operation ??= defaultOperationForRef(registry, decodedRef, options.acceptRefs);
  context.operation = operation ?? null;

  if (typeof options.validateRef === 'function') {
    const result = await options.validateRef(context);
    if (result && (typeof result === 'object' || typeof result === 'string')) {
      return normalizeRegistryOperation(decodedRef, result);
    }
    if (result === true) {
      return context.operation;
    }
    return null;
  }

  return operation;
}

function defaultOperationForRef(registry, decodedRef, acceptRefs) {
  for (const [key, operation] of Object.entries(registry)) {
    if (!operation || typeof operation !== 'object') {
      continue;
    }

    const name = operation.name ?? key;
    const ref = operation.ref ?? key;
    const acceptsRef = acceptRefs === 'ref' || acceptRefs === 'both';
    const acceptsName = acceptRefs === 'name' || acceptRefs === 'both';

    if (acceptsRef && ref && decodedRef === ref) {
      return operation;
    }
    if (acceptsName && name && decodedRef === name) {
      return operation;
    }
  }

  return null;
}

async function operationRegistry(config, options) {
  if (options.registry && Object.keys(options.registry).length > 0) {
    return normalizeOperationRegistry(options.registry);
  }

  if (options.outFile) {
    try {
      const manifest = JSON.parse(await readFile(options.outFile, 'utf8'));
      return normalizeOperationRegistry(manifest.operations ?? {});
    } catch (error) {
      throw operationRegistryLoadFailed(options.outFile, error);
    }
  }

  if (typeof options.resolveRef === 'function') {
    return operationMapFromEntries();
  }

  if (options.sourceDir) {
    return buildOperationRegistry({
      ...config,
      operations: {
        ...(config.operations ?? {}),
        sourceDir: options.sourceDir,
      },
    });
  }

  return operationMapFromEntries();
}

function normalizeOperationRegistry(registry) {
  return operationMapFromEntries(
    Object.entries(registry ?? {}).map(([key, operation]) => [key, normalizeRegistryOperation(key, operation)]),
  );
}

function normalizeRegistryOperation(key, operation) {
  const normalized = normalizeOperationTemplate(operation);
  const source = operation && typeof operation === 'object' && !Array.isArray(operation) ? operation : {};

  if (source.name || normalized.name || key) {
    normalized.name = String(source.name ?? normalized.name ?? key);
  }
  if (source.ref || normalized.ref || key) {
    normalized.ref = String(source.ref ?? normalized.ref ?? key);
  }

  return normalized;
}

function operationNotFound(ref) {
  const decodedRef = decodeOperationRef(ref);
  return dbError(
    'OPERATION_NOT_FOUND',
    `Unknown registered operation "${decodedRef}".`,
    {
      status: 404,
      hint: 'Register the operation name or ref in operations.registry, provide a custom operations.resolveRef, or generate an operations manifest.',
      details: { ref: decodedRef },
    },
  );
}

function operationRegistryLoadFailed(outFile, error) {
  const reason = error?.code === 'ENOENT'
    ? 'missing'
    : error instanceof SyntaxError
      ? 'invalid-json'
      : 'read-failed';

  return dbError(
    'OPERATION_REGISTRY_LOAD_FAILED',
    'Registered operation registry could not be loaded.',
    {
      status: 500,
      hint: reason === 'missing'
        ? 'Run async-db operations build or check outputs.operationRegistry points at the generated registry.'
        : 'Check outputs.operationRegistry and regenerate the operation registry.',
      details: {
        outFile: String(outFile),
        reason,
      },
    },
  );
}

function decodeOperationRef(ref) {
  return decodeURIComponent(String(ref ?? ''));
}

function internalRestRequest(restRequest) {
  return {
    method: restRequest.method,
    headers: {
      'content-type': 'application/json',
    },
    async *[Symbol.asyncIterator]() {
      if (restRequest.body !== undefined) {
        yield Buffer.from(JSON.stringify(restRequest.body));
      }
    },
  };
}

function makeResultResponse() {
  return {
    status: 200,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = normalizeHeaders(headers);
    },
    end(chunk = '') {
      this.body += chunk;
    },
    bodyValue() {
      if (!this.body) {
        return null;
      }

      if (String(this.headers['content-type'] ?? '').includes('application/json')) {
        try {
          return JSON.parse(this.body);
        } catch {
          return this.body;
        }
      }

      return this.body;
    },
  };
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
}
