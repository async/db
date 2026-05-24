export function createResolverContext(internal = {}, provided = {}) {
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

export async function callFieldResolver(resolver, args, options = {}) {
  const value = options.value ?? args?.record ?? args?.records ?? args?.value;
  const resolverThis = createResolverContext({
    db: options.db,
    config: options.config ?? options.db?.config,
    resource: options.resource,
    field: options.resource?.fields?.[options.fieldName],
    fieldName: options.fieldName,
    cache: options.cache,
    services: options.services ?? options.config?.services ?? options.db?.config?.services ?? {},
    value,
    record: args?.record ?? value,
    records: args?.records,
    args,
  }, options.context);

  return resolver.call(resolverThis, args);
}

export function valueFromResolveManyResult(values, resource, record, index = 0) {
  if (Array.isArray(values)) {
    return values[index];
  }

  if (values instanceof Map) {
    const key = keyForRecord(record, resource, index);
    return values.get(key) ?? values.get(String(key)) ?? values.get(index);
  }

  if (values && typeof values === 'object') {
    const key = keyForRecord(record, resource, index);
    return values[key] ?? values[String(key)] ?? values[index];
  }

  return undefined;
}

function createInternalView(internalMap) {
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

function normalizeContextMap(value) {
  if (value instanceof Map) {
    return new Map(value);
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return new Map();
  }

  return new Map(Object.entries(value));
}

function keyForRecord(record, resource, index) {
  if (resource?.kind === 'collection') {
    const idField = resource.idField ?? 'id';
    const id = record?.[idField];
    if (id !== undefined && id !== null && id !== '') {
      return id;
    }
  }

  return index;
}
