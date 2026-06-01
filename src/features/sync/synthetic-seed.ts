type SyncConfig = {
  seed?: {
    generateFromSchema?: boolean;
    generatedCount?: unknown;
  };
  [key: string]: unknown;
};

type FieldDefinition = {
  type?: string;
  default?: unknown;
  values?: unknown[];
  items?: FieldDefinition;
  fields?: Record<string, FieldDefinition>;
};

type SyncResource = {
  name?: string;
  kind?: string;
  idField?: string;
  dataPath?: string | null;
  schemaPath?: string | null;
  seed?: unknown;
  fields?: Record<string, FieldDefinition>;
  [key: string]: unknown;
};

type RuntimeRecord = Record<string, unknown>;

export function seedForRuntimeState(resource: SyncResource, config: SyncConfig): unknown {
  if (shouldGenerateSeedFromSchema(resource, config)) {
    return generateSyntheticSeed(resource, syntheticSeedCount(config));
  }
  return resource.seed;
}

function shouldGenerateSeedFromSchema(resource: SyncResource, config: SyncConfig): boolean {
  if (config.seed?.generateFromSchema !== true) {
    return false;
  }

  if (resource.dataPath || !resource.schemaPath) {
    return false;
  }

  if (resource.kind === 'collection') {
    return Array.isArray(resource.seed) && resource.seed.length === 0;
  }

  return isPlainObject(resource.seed) && Object.keys(resource.seed).length === 0;
}

function syntheticSeedCount(config: SyncConfig): number {
  const value = Number(config.seed?.generatedCount);
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.max(0, Math.floor(value));
}

function generateSyntheticSeed(resource: SyncResource, count: number): RuntimeRecord | RuntimeRecord[] {
  if (resource.kind === 'collection') {
    return Array.from({ length: count }, (_unused, index) => generateSyntheticRecord(resource, index));
  }
  return generateSyntheticRecord(resource, 0);
}

function generateSyntheticRecord(resource: SyncResource, index: number): RuntimeRecord {
  const record: RuntimeRecord = {};
  for (const [fieldName, field] of Object.entries(resource.fields ?? {})) {
    if (fieldName === resource.idField) {
      record[fieldName] = String(index + 1);
      continue;
    }
    const value = syntheticValue(field, fieldName, index);
    if (value !== undefined) {
      record[fieldName] = value;
    }
  }
  return record;
}

function syntheticValue(field: FieldDefinition | undefined, fieldName: string, index: number): unknown {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    return null;
  }

  if ('default' in field) {
    return structuredClone(field.default);
  }

  if (field.type === 'enum' && Array.isArray(field.values) && field.values.length > 0) {
    return field.values[index % field.values.length];
  }

  switch (field.type) {
    case 'string':
      return `${fieldName}_${index + 1}`;
    case 'datetime':
      return new Date(Date.UTC(2020, 0, index + 1)).toISOString();
    case 'number':
      return index + 1;
    case 'boolean':
      return index % 2 === 0;
    case 'array':
      return field.items ? [syntheticValue(field.items, `${fieldName}Item`, index)].filter((item) => item !== undefined) : [];
    case 'object': {
      const objectValue = {};
      for (const [childName, childField] of Object.entries(field.fields ?? {})) {
        const childValue = syntheticValue(childField, childName, index);
        if (childValue !== undefined) {
          objectValue[childName] = childValue;
        }
      }
      return objectValue;
    }
    default:
      return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
