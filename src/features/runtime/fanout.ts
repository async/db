import { callFieldResolver, valueFromResolveManyResult } from '../schema/resolvers.js';

type RuntimeRecord = Record<string, unknown>;

type RuntimeDb = {
  config?: unknown;
  [key: string]: unknown;
};

type ComputedFieldResolver = {
  resolve?: (...args: unknown[]) => unknown;
  resolveMany?: (...args: unknown[]) => unknown;
};

type RuntimeResource = {
  fields?: Record<string, { computed?: boolean }>;
  resolvers?: {
    fields?: Record<string, ComputedFieldResolver>;
  };
  [key: string]: unknown;
};

type ComputedFanoutOptions = {
  cache?: Map<unknown, unknown>;
  context?: unknown;
};

export async function resolveSelectedComputedFields(
  db: RuntimeDb,
  resource: RuntimeResource,
  records: RuntimeRecord[],
  fieldNames: string[],
  options: ComputedFanoutOptions = {},
): Promise<RuntimeRecord[]> {
  const selected = [...new Set(fieldNames)]
    .filter((fieldName) => resource.fields?.[fieldName]?.computed)
    .filter((fieldName) => resource.resolvers?.fields?.[fieldName]);

  if (selected.length === 0 || records.length === 0) {
    return records;
  }

  const nextRecords: RuntimeRecord[] = records.map((record) => record && typeof record === 'object' && !Array.isArray(record)
    ? { ...record }
    : record as RuntimeRecord);
  const cache = options.cache ?? new Map();

  for (const fieldName of selected) {
    const resolver = resource.resolvers?.fields?.[fieldName];
    if (!resolver) {
      continue;
    }
    if (typeof resolver.resolveMany === 'function') {
      const args = {
        records: nextRecords,
        db,
        resource,
        cache,
      };
      const values = await callFieldResolver(resolver.resolveMany, args, {
        db,
        config: db.config,
        resource,
        fieldName,
        cache,
        context: options.context,
        value: nextRecords,
      });
      applyManyResolvedValues(nextRecords, resource, fieldName, values);
      continue;
    }

    if (typeof resolver.resolve === 'function') {
      for (const record of nextRecords) {
        const args = {
          record,
          db,
          resource,
          cache,
        };
        record[fieldName] = await callFieldResolver(resolver.resolve, args, {
          db,
          config: db.config,
          resource,
          fieldName,
          cache,
          context: options.context,
          value: record,
        });
      }
    }
  }

  return nextRecords;
}

function applyManyResolvedValues(
  records: RuntimeRecord[],
  resource: RuntimeResource,
  fieldName: string,
  values: unknown,
): void {
  if (Array.isArray(values)) {
    for (const [index, record] of records.entries()) {
      record[fieldName] = valueFromResolveManyResult(values, resource, record, index);
    }
    return;
  }

  if (values instanceof Map) {
    for (const [index, record] of records.entries()) {
      record[fieldName] = valueFromResolveManyResult(values, resource, record, index);
    }
    return;
  }

  if (values && typeof values === 'object') {
    for (const [index, record] of records.entries()) {
      record[fieldName] = valueFromResolveManyResult(values, resource, record, index);
    }
  }
}
