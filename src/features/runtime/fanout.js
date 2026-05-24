import { callFieldResolver, valueFromResolveManyResult } from '../schema/resolvers.js';

export async function resolveSelectedComputedFields(db, resource, records, fieldNames, options = {}) {
  const selected = [...new Set(fieldNames)]
    .filter((fieldName) => resource.fields?.[fieldName]?.computed)
    .filter((fieldName) => resource.resolvers?.fields?.[fieldName]);

  if (selected.length === 0 || records.length === 0) {
    return records;
  }

  const nextRecords = records.map((record) => record && typeof record === 'object' && !Array.isArray(record)
    ? { ...record }
    : record);
  const cache = options.cache ?? new Map();

  for (const fieldName of selected) {
    const resolver = resource.resolvers.fields[fieldName];
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

function applyManyResolvedValues(records, resource, fieldName, values) {
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
