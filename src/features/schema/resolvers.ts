type ContextInput = Map<string, unknown> | Record<string, unknown> | null | undefined;

type ResolverContext = {
  get(key: string): unknown;
  has(key: string): boolean;
  [key: string]: unknown;
};

type FieldResolverOptions = {
  db?: unknown;
  config?: unknown;
  resource?: {
    fields?: Record<string, unknown>;
    [key: string]: unknown;
  };
  fieldName?: string;
  cache?: Map<unknown, unknown>;
  services?: Record<string, unknown>;
  context?: unknown;
  value?: unknown;
};

type FieldResolverArgs = {
  record?: unknown;
  records?: unknown[];
  value?: unknown;
  [key: string]: unknown;
};

type RuntimeResource = {
  name?: string;
  kind?: string;
  idField?: string;
  [key: string]: unknown;
};

type RuntimeRecord = Record<string, unknown>;

export function createResolverContext(internal: ContextInput = {}, provided: ContextInput = {}): ResolverContext {
  const internalMap = normalizeContextMap(internal);
  const services = internalMap.get('services');
  if (services && typeof services === 'object' && !Array.isArray(services)) {
    for (const [key, value] of Object.entries(services)) {
      if (!internalMap.has(key)) {
        internalMap.set(key, value);
      }
    }
  }

  const providedMap = normalizeContextMap(provided);
  const context = {
    get(key) {
      return providedMap.has(key) ? providedMap.get(key) : internalMap.get(key);
    },

    has(key) {
      return providedMap.has(key) || internalMap.has(key);
    },
  };

  Object.defineProperty(context, '_internal', {
    enumerable: false,
    value: createInternalView(internalMap),
  });

  for (const key of new Set([...internalMap.keys(), ...providedMap.keys()])) {
    if (key in context) {
      continue;
    }

    Object.defineProperty(context, key, {
      enumerable: true,
      get() {
        return context.get(key);
      },
    });
  }

  return context;
}

export async function callFieldResolver(
  resolver: (this: ResolverContext, args: FieldResolverArgs) => unknown,
  args: FieldResolverArgs,
  options: FieldResolverOptions = {},
): Promise<unknown> {
  const value = options.value ?? args?.record ?? args?.records ?? args?.value;
  const db = options.db as { config?: Record<string, unknown> } | undefined;
  const config = options.config as { services?: Record<string, unknown> } | undefined;
  const resolverThis = createResolverContext({
    db: options.db,
    config: options.config ?? db?.config,
    resource: options.resource,
    field: options.resource?.fields?.[options.fieldName],
    fieldName: options.fieldName,
    cache: options.cache,
    services: options.services ?? config?.services ?? db?.config?.services ?? {},
    value,
    record: args?.record ?? value,
    records: args?.records,
    args,
  }, options.context as ContextInput);

  return resolver.call(resolverThis, args);
}

export function valueFromResolveManyResult(
  values: unknown,
  resource: RuntimeResource,
  record: RuntimeRecord,
  index = 0,
): unknown {
  if (Array.isArray(values)) {
    return values[index];
  }

  if (values instanceof Map) {
    const key = keyForRecord(record, resource, index);
    return values.get(key) ?? values.get(String(key)) ?? values.get(index);
  }

  if (values && typeof values === 'object') {
    const key = keyForRecord(record, resource, index);
    const recordValues = values as Record<PropertyKey, unknown>;
    return recordValues[key as PropertyKey] ?? recordValues[String(key)] ?? recordValues[index];
  }

  return undefined;
}

function createInternalView(internalMap: Map<string, unknown>): Readonly<ResolverContext> {
  const view = {
    get(key) {
      return internalMap.get(key);
    },

    has(key) {
      return internalMap.has(key);
    },
  };

  for (const key of internalMap.keys()) {
    if (key in view) {
      continue;
    }

    Object.defineProperty(view, key, {
      enumerable: true,
      get() {
        return internalMap.get(key);
      },
    });
  }

  return Object.freeze(view);
}

function normalizeContextMap(value: ContextInput): Map<string, unknown> {
  if (value instanceof Map) {
    return new Map(value);
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return new Map();
  }

  return new Map(Object.entries(value));
}

function keyForRecord(record: RuntimeRecord, resource: RuntimeResource, index: number): unknown {
  if (resource?.kind === 'collection') {
    const idField = resource.idField ?? 'id';
    const id = record?.[idField];
    if (id !== undefined && id !== null && id !== '') {
      return id;
    }
  }

  return index;
}
