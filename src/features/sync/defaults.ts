type SyncConfig = {
  defaults?: {
    applyOnSafeMigration?: boolean;
  };
  [key: string]: unknown;
};

type FieldDefinition = {
  default?: unknown;
  [key: string]: unknown;
};

type SyncResource = {
  name?: string;
  kind?: string;
  idField?: string;
  fields?: Record<string, FieldDefinition>;
  [key: string]: unknown;
};

type RuntimeRecord = Record<string, unknown>;

export function applyDefaultsToSeed(seed: unknown, resource: SyncResource, config: SyncConfig): unknown {
  if (config.defaults?.applyOnSafeMigration === false) {
    return seed;
  }

  if (resource.kind === 'collection') {
    return Array.isArray(seed) ? seed.map((record) => applyDefaultsToRecord(record, resource)) : [];
  }

  return applyDefaultsToRecord(seed, resource);
}

export function applyDefaultsToRecord<T>(record: T, resource: SyncResource): T | RuntimeRecord {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }

  const next: RuntimeRecord = { ...record as RuntimeRecord };
  for (const [fieldName, field] of Object.entries(resource.fields ?? {})) {
    if (next[fieldName] === undefined && 'default' in field) {
      next[fieldName] = structuredClone(field.default);
    }
  }

  return next;
}
