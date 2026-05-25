import { resourceConfigValue, routePathForResource, typeNameForResource } from '../../names.js';
import { inferFieldsFromData, normalizeField } from './fields.js';
import { relationsForResource } from './relations.js';
import { normalizeFilesSource } from './source-definitions.js';
import { mergeStandardSchemaFields, standardJsonSchemaFields } from './standard-schema.js';

export function buildResource({ name, dataPath, dataFormat, dataHash, schemaPath, schemaSource, rawData, rawSchema, config, includeSeed = true }) {
  const collectionConfig = resourceConfigValue(config.collections, name) ?? {};
  if (rawSchema) {
    const kind = rawSchema.kind ?? inferKindFromData(rawData) ?? 'collection';
    const idField = rawSchema.idField ?? collectionConfig.idField ?? 'id';
    const schemaHasSeed = Object.prototype.hasOwnProperty.call(rawSchema, 'seed');
    const schemaSeed = includeSeed && schemaHasSeed ? rawSchema.seed : emptySeedForKind(kind);
    const seed = includeSeed && rawData !== undefined ? rawData : schemaSeed;
    const standardSchema = rawSchema.validator ?? rawSchema.standardSchema;
    const standardSchemaSource = rawSchema.validator ? 'validator' : rawSchema.standardSchema ? 'standardSchema' : undefined;
    const standardFields = standardSchema
      ? standardJsonSchemaFields(standardSchema, name)
      : { fields: {}, authoritative: true, diagnostics: [] };
    const rawFields = standardSchema
      ? mergeStandardSchemaFields(standardFields.fields, rawSchema.fields ?? {})
      : rawSchema.fields ?? {};
    const standardDiagnostics = standardSchema && Object.keys(rawFields).length === 0
      ? standardFields.diagnostics
      : [];
    const resolvers = resolversForFieldMap(rawFields);
    let fields = Object.fromEntries(
      Object.entries(rawFields).map(([fieldName, field]) => [fieldName, normalizeField(field, fieldName)]),
    );
    if (kind === 'collection') {
      fields = ensureCollectionIdField(fields, idField);
    }
    const normalizedSeed = normalizeSeed(dataFormat === 'csv' ? coerceCsvSeedToSchema(seed, fields, kind) : seed, kind);
    const idResult = ensureCollectionSeedIds(normalizedSeed, kind, idField);
    const normalizedSchemaSeed = includeSeed && schemaHasSeed
      ? ensureCollectionSeedIds(normalizeSeed(schemaSeed, kind), kind, idField).seed
      : undefined;

    return withComputedMetadata({
      name,
      kind,
      idField,
      description: rawSchema.description,
      fields,
      seed: idResult.seed,
      dataPath,
      dataFormat,
      dataHash,
      schemaPath,
      schemaSource: schemaSource ?? null,
      schemaHasSeed,
      schemaSeed: normalizedSchemaSeed,
      typeSource: 'schema',
      generatedIds: idResult.generated,
      resolvers,
      validators: standardSchema ? { standard: standardSchema } : {},
      validatorSource: standardSchemaSource,
      fieldsAuthoritative: standardSchema ? standardFields.authoritative : true,
      typeFallback: standardSchema && Object.keys(rawFields).length === 0 ? 'record' : undefined,
      diagnostics: standardDiagnostics,
      source: normalizeFilesSource(rawSchema.source, { read: rawSchema.parser }),
    });
  }

  const kind = inferKindFromData(rawData);
  const idField = collectionConfig.idField ?? inferIdField(rawData, kind);
  const normalizedSeed = normalizeSeed(rawData, kind);
  const idResult = ensureCollectionSeedIds(normalizedSeed, kind, idField);
  const fields = kind === 'collection'
    ? ensureCollectionIdField(inferFieldsFromData(idResult.seed, kind), idField)
    : inferFieldsFromData(idResult.seed, kind);

  return withComputedMetadata({
    name,
    kind,
    idField,
    fields,
    seed: idResult.seed,
    dataPath,
    dataFormat,
    dataHash,
    schemaPath,
    schemaSource: null,
    typeSource: 'data',
    generatedIds: idResult.generated,
    resolvers: { fields: {} },
    validators: {},
    fieldsAuthoritative: true,
  });
}

function resolversForFieldMap(fields) {
  const resolvers = {};
  for (const [fieldName, field] of Object.entries(fields ?? {})) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      continue;
    }

    const resolver = {};
    if (typeof field.resolve === 'function') {
      resolver.resolve = field.resolve;
    }
    if (typeof field.resolveMany === 'function') {
      resolver.resolveMany = field.resolveMany;
    }
    if (Object.keys(resolver).length > 0) {
      resolvers[fieldName] = resolver;
    }
  }

  return { fields: resolvers };
}

function coerceCsvSeedToSchema(seed, fields, kind) {
  if (kind === 'collection') {
    return Array.isArray(seed)
      ? seed.map((record) => coerceCsvRecordToSchema(record, fields))
      : seed;
  }

  return coerceCsvRecordToSchema(seed, fields);
}

function coerceCsvRecordToSchema(record, fields) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }

  const next = { ...record };
  for (const [fieldName, field] of Object.entries(fields ?? {})) {
    if (field.type === 'array' && typeof next[fieldName] === 'string') {
      next[fieldName] = parseCsvArrayValue(next[fieldName], field.items ?? { type: 'unknown' });
    }
  }
  return next;
}

function parseCsvArrayValue(value, itemField) {
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => coerceCsvArrayItem(item, itemField));
      }
    } catch {
      return value;
    }
  }

  return trimmed
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => coerceCsvArrayItem(item, itemField));
}

function coerceCsvArrayItem(value, itemField) {
  if (typeof value !== 'string') {
    return value;
  }

  if (itemField.type === 'number' && /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (itemField.type === 'boolean') {
    const lower = value.toLowerCase();
    if (lower === 'true') {
      return true;
    }
    if (lower === 'false') {
      return false;
    }
  }

  return value;
}

function withComputedMetadata(resource) {
  const next = {
    ...resource,
    typeName: typeNameForResource(resource.name, resource.kind),
    routePath: routePathForResource(resource.name),
  };
  next.relations = relationsForResource(next);
  return next;
}

function inferKindFromData(data) {
  return Array.isArray(data) ? 'collection' : 'document';
}

function inferIdField(data, kind) {
  if (kind !== 'collection' || !Array.isArray(data) || data.length === 0) {
    return 'id';
  }

  if (data.every((record) => record && typeof record === 'object' && 'id' in record)) {
    return 'id';
  }

  const firstRecord = data.find((record) => record && typeof record === 'object' && !Array.isArray(record));
  return Object.keys(firstRecord ?? {}).find((fieldName) => /id$/i.test(fieldName)) ?? 'id';
}

function ensureCollectionIdField(fields, idField) {
  if (idField in fields) {
    return fields;
  }

  return {
    [idField]: {
      type: 'string',
      required: true,
      description: 'Generated local id.',
    },
    ...fields,
  };
}

function ensureCollectionSeedIds(seed, kind, idField) {
  if (kind !== 'collection' || !Array.isArray(seed)) {
    return {
      seed,
      generated: false,
    };
  }

  const usedIds = new Set(seed
    .map((record) => record?.[idField])
    .filter((id) => id !== undefined && id !== null && id !== '')
    .map((id) => String(id)));
  let nextId = nextCounterId(usedIds);
  let generated = false;

  const records = seed.map((record) => {
    if (!isPlainRecord(record) || (record[idField] !== undefined && record[idField] !== null && record[idField] !== '')) {
      return record;
    }

    generated = true;
    while (usedIds.has(String(nextId))) {
      nextId += 1;
    }
    const id = String(nextId);
    usedIds.add(id);
    nextId += 1;
    return {
      [idField]: id,
      ...record,
    };
  });

  return {
    seed: records,
    generated,
  };
}

function nextCounterId(usedIds) {
  const numericIds = [...usedIds]
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (numericIds.length > 0) {
    return Math.max(...numericIds) + 1;
  }

  return 1;
}

function normalizeSeed(seed, kind) {
  if (kind === 'collection') {
    return Array.isArray(seed) ? seed : [];
  }

  if (seed && typeof seed === 'object' && !Array.isArray(seed)) {
    return seed;
  }

  return {};
}

function emptySeedForKind(kind) {
  return kind === 'collection' ? [] : {};
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
