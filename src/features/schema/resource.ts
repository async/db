import { resourceConfigValue, routePathForResource, typeNameForResource } from '../../names.js';
import { inferFieldsFromData, normalizeField, type SchemaField } from './fields.js';
import { relationsForResource } from './relations.js';
import { normalizeFilesSource, type FilesSourceDefinition } from './source-definitions.js';
import { mergeStandardSchemaFields, standardJsonSchemaFields, type SchemaDiagnostic, type StandardSchemaV1 } from './standard-schema.js';

type ResourceKind = 'collection' | 'document';

type ResourceConfig = {
  idField?: string;
  [key: string]: unknown;
};

type SchemaBuildConfig = {
  collections?: Record<string, ResourceConfig>;
  [key: string]: unknown;
};

type RawSchema = {
  kind?: ResourceKind;
  idField?: string;
  description?: string;
  writePolicy?: string;
  seed?: unknown;
  fields?: Record<string, unknown>;
  validator?: unknown;
  standardSchema?: unknown;
  source?: Parameters<typeof normalizeFilesSource>[0];
  parser?: string;
  store?: unknown;
  [key: string]: unknown;
};

type BuildResourceInput = {
  name: string;
  dataPath?: string | null;
  dataFormat?: string | null;
  dataHash?: string | null;
  schemaPath?: string | null;
  schemaSource?: string | null;
  rawData?: unknown;
  rawSchema?: RawSchema | null;
  config: SchemaBuildConfig;
  includeSeed?: boolean;
};

type FieldResolver = (...args: unknown[]) => unknown;

type RawResolverField = {
  resolve?: FieldResolver;
  resolveMany?: FieldResolver;
};

type ResourceResolvers = {
  fields: Record<string, RawResolverField>;
};

type IdResult = {
  seed: unknown;
  generated: boolean;
};

type BuiltResource = {
  name: string;
  kind: ResourceKind;
  idField: string;
  description?: string;
  writePolicy?: string;
  fields: Record<string, SchemaField>;
  seed: unknown;
  dataPath?: string | null;
  dataFormat?: string | null;
  dataHash?: string | null;
  schemaPath?: string | null;
  schemaSource: string | null;
  schemaHasSeed?: boolean;
  schemaSeed?: unknown;
  typeSource: 'schema' | 'data';
  generatedIds: boolean;
  resolvers: ResourceResolvers;
  validators: Record<string, unknown>;
  validatorSource?: string;
  fieldsAuthoritative: boolean;
  typeFallback?: string;
  diagnostics?: SchemaDiagnostic[];
  source?: FilesSourceDefinition | null;
  typeName?: string;
  routePath?: string;
  relations?: ReturnType<typeof relationsForResource>;
};

export function buildResource({
  name,
  dataPath,
  dataFormat,
  dataHash,
  schemaPath,
  schemaSource,
  rawData,
  rawSchema,
  config,
  includeSeed = true,
}: BuildResourceInput): BuiltResource {
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
      ? standardJsonSchemaFields(standardSchema as StandardSchemaV1, name)
      : { fields: {}, authoritative: true, diagnostics: [] };
    const rawFields = standardSchema
      ? mergeStandardSchemaFields(standardFields.fields, rawSchema.fields as Record<string, never> ?? {})
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
      writePolicy: normalizeWritePolicy(rawSchema.writePolicy),
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
    writePolicy: undefined,
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

function resolversForFieldMap(fields: Record<string, unknown> | null | undefined): ResourceResolvers {
  const resolvers: Record<string, RawResolverField> = {};
  for (const [fieldName, field] of Object.entries(fields ?? {})) {
    if (!isPlainRecord(field)) {
      continue;
    }

    const resolver: RawResolverField = {};
    if (typeof field.resolve === 'function') {
      resolver.resolve = field.resolve as FieldResolver;
    }
    if (typeof field.resolveMany === 'function') {
      resolver.resolveMany = field.resolveMany as FieldResolver;
    }
    if (Object.keys(resolver).length > 0) {
      resolvers[fieldName] = resolver;
    }
  }

  return { fields: resolvers };
}

function coerceCsvSeedToSchema(seed: unknown, fields: Record<string, SchemaField>, kind: ResourceKind): unknown {
  if (kind === 'collection') {
    return Array.isArray(seed)
      ? seed.map((record) => coerceCsvRecordToSchema(record, fields))
      : seed;
  }

  return coerceCsvRecordToSchema(seed, fields);
}

function coerceCsvRecordToSchema(record: unknown, fields: Record<string, SchemaField>): unknown {
  if (!isPlainRecord(record)) {
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

function parseCsvArrayValue(value: string, itemField: SchemaField): unknown[] | string {
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

function coerceCsvArrayItem(value: unknown, itemField: SchemaField): unknown {
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

function withComputedMetadata(resource: Omit<BuiltResource, 'typeName' | 'routePath' | 'relations'>): BuiltResource {
  const next: BuiltResource = {
    ...resource,
    typeName: typeNameForResource(resource.name, resource.kind),
    routePath: routePathForResource(resource.name),
  };
  next.relations = relationsForResource(next as Parameters<typeof relationsForResource>[0]);
  return next;
}

function normalizeWritePolicy(value: unknown): string | undefined {
  return value === 'append-only' ? value : undefined;
}

function inferKindFromData(data: unknown): ResourceKind {
  return Array.isArray(data) ? 'collection' : 'document';
}

function inferIdField(data: unknown, kind: ResourceKind): string {
  if (kind !== 'collection' || !Array.isArray(data) || data.length === 0) {
    return 'id';
  }

  if (data.every((record) => isPlainRecord(record) && 'id' in record)) {
    return 'id';
  }

  const firstRecord = data.find((record) => isPlainRecord(record));
  return Object.keys(firstRecord ?? {}).find((fieldName) => /id$/i.test(fieldName)) ?? 'id';
}

function ensureCollectionIdField(fields: Record<string, SchemaField>, idField: string): Record<string, SchemaField> {
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

function ensureCollectionSeedIds(seed: unknown, kind: ResourceKind, idField: string): IdResult {
  if (kind !== 'collection' || !Array.isArray(seed)) {
    return {
      seed,
      generated: false,
    };
  }

  const usedIds = new Set(seed
    .map((record) => isPlainRecord(record) ? record[idField] : undefined)
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

function nextCounterId(usedIds: Set<string>): number {
  const numericIds = [...usedIds]
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (numericIds.length > 0) {
    return Math.max(...numericIds) + 1;
  }

  return 1;
}

function normalizeSeed(seed: unknown, kind: ResourceKind): unknown[] | Record<string, unknown> {
  if (kind === 'collection') {
    return Array.isArray(seed) ? seed : [];
  }

  if (isPlainRecord(seed)) {
    return seed;
  }

  return {};
}

function emptySeedForKind(kind: ResourceKind): unknown[] | Record<string, unknown> {
  return kind === 'collection' ? [] : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
