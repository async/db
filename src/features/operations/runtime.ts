import { readFile } from 'node:fs/promises';
import { dbError } from '../../errors.js';
import { executeGraphql } from '../../graphql/index.js';
import { handleRestRequest } from '../../rest/handler.js';
import {
  normalizeOperationTemplate,
  operationRequest,
  type OperationRequestResult,
  type OperationTemplate,
  type OperationVariables,
  type RegisteredOperation,
} from '../../shared/operations.js';
import { buildOperationRegistry } from './index.js';
import { operationMapFromEntries } from './maps.js';

type OperationAcceptRefs = 'ref' | 'name' | 'both';

type OperationRegistry = Record<string, OperationTemplate>;

type OperationRefContext = {
  ref: string;
  decodedRef: string;
  acceptRefs: OperationAcceptRefs;
  registry: Record<string, RegisteredOperation>;
  operation: RegisteredOperation | null;
};

type OperationOptions = {
  enabled?: boolean;
  acceptRefs?: OperationAcceptRefs | 'hash';
  registry?: OperationRegistry;
  outFile?: string | null;
  sourceDir?: string;
  resolveRef?: (
    ref: string,
    context: Omit<OperationRefContext, 'operation'>,
  ) => OperationTemplate | null | undefined | Promise<OperationTemplate | null | undefined>;
  validateRef?: (
    context: OperationRefContext,
  ) => boolean | null | undefined | OperationTemplate | Promise<boolean | null | undefined | OperationTemplate>;
};

type DbLike = {
  config: {
    cwd?: string;
    graphql?: {
      enabled?: boolean;
    };
    operations?: OperationOptions;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type CreateHandlerOptions = OperationOptions | {
  operations?: boolean | 'auto' | OperationOptions;
};

type ExecutionOptions = {
  routes?: Record<string, unknown>;
  trace?: unknown;
};

type OperationExecutionResult = {
  kind: 'rest' | 'graphql';
  status: number;
  headers: Record<string, unknown>;
  body: unknown;
  rawBody?: string;
};

type ResultResponse = {
  status: number;
  headers: Record<string, unknown>;
  body: string;
  writeHead(status: number, headers?: Record<string, unknown>): void;
  end(chunk?: unknown): void;
  bodyValue(): unknown;
};

export function createDbOperationHandler(db: DbLike, options: CreateHandlerOptions = {}) {
  const operationOptions = normalizeOperationOptions(db, options);
  return {
    enabled: operationOptions.enabled === true,
    options: operationOptions,
    async resolve(ref: string): Promise<RegisteredOperation | null> {
      return resolveOperationRef(db, operationOptions, ref);
    },
    async execute(
      ref: string,
      variables: OperationVariables = {},
      executionOptions: ExecutionOptions = {},
    ): Promise<OperationExecutionResult> {
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
    async executeRequest(ref: string, body: { variables?: OperationVariables } | null = {}, executionOptions: ExecutionOptions = {}) {
      return this.execute(ref, body?.variables ?? {}, executionOptions);
    },
  };
}

function normalizeOperationOptions(db: DbLike, options: CreateHandlerOptions = {}): OperationOptions & {
  enabled: boolean;
  acceptRefs: OperationAcceptRefs;
} {
  const globalOptions = db.config.operations ?? {};
  const localOptions = isOperationOptionsWrapper(options)
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

function normalizeAcceptRefs(value: unknown): OperationAcceptRefs {
  if (value === 'ref' || value === 'name' || value === 'both') {
    return value;
  }
  if (value === 'hash') {
    return 'ref';
  }
  return 'both';
}

async function resolveOperationRef(
  db: DbLike,
  options: OperationOptions & { acceptRefs: OperationAcceptRefs },
  ref: string,
): Promise<RegisteredOperation | null> {
  const decodedRef = decodeOperationRef(ref);
  const registry = await operationRegistry(db.config, options);
  const context = {
    ref,
    decodedRef,
    acceptRefs: options.acceptRefs,
    registry,
    operation: null,
  };

  let operation: RegisteredOperation | null = null;
  if (typeof options.resolveRef === 'function') {
    const resolvedOperation = await options.resolveRef(decodedRef, context);
    if (resolvedOperation) {
      operation = normalizeRegistryOperation(decodedRef, resolvedOperation);
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

function defaultOperationForRef(
  registry: Record<string, RegisteredOperation>,
  decodedRef: string,
  acceptRefs: OperationAcceptRefs,
): RegisteredOperation | null {
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

async function operationRegistry(
  config: DbLike['config'],
  options: OperationOptions,
): Promise<Record<string, RegisteredOperation>> {
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

function normalizeOperationRegistry(registry: OperationRegistry): Record<string, RegisteredOperation> {
  return operationMapFromEntries(
    Object.entries(registry ?? {}).map(([key, operation]) => [key, normalizeRegistryOperation(key, operation)]),
  );
}

function normalizeRegistryOperation(key: string, operation: OperationTemplate): RegisteredOperation {
  const normalized = normalizeOperationTemplate(operation);
  const source = operation && typeof operation === 'object' && !Array.isArray(operation) ? operation : {};

  if (source.name || normalized.name || key) {
    normalized.name = String(source.name ?? normalized.name ?? key);
  }
  if (source.ref || normalized.ref || key) {
    normalized.ref = String(source.ref ?? normalized.ref ?? key);
  }

  return normalized as RegisteredOperation;
}

function operationNotFound(ref: string): Error {
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

function operationRegistryLoadFailed(outFile: string, error: NodeJS.ErrnoException | SyntaxError): Error {
  const reason = 'code' in error && error.code === 'ENOENT'
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

function decodeOperationRef(ref: unknown): string {
  return decodeURIComponent(String(ref ?? ''));
}

function internalRestRequest(restRequest: OperationRequestResult) {
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

function makeResultResponse(): ResultResponse {
  return {
    status: 200,
    headers: {},
    body: '',
    writeHead(status: number, headers: Record<string, unknown> = {}) {
      this.status = status;
      this.headers = normalizeHeaders(headers);
    },
    end(chunk: unknown = '') {
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

function normalizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
}

function isOperationOptionsWrapper(options: CreateHandlerOptions): options is { operations?: boolean | 'auto' | OperationOptions } {
  return Boolean(options) && typeof options === 'object' && Object.hasOwn(options, 'operations');
}
