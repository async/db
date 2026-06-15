import { dbError } from '../errors.js';

export type IdentityDefinition = {
  fields: string[];
};

export type IdentityResource = {
  name?: string;
  idField?: string;
  identity?: {
    fields?: unknown;
  };
};

export type RuntimeRecord = Record<string, unknown>;

export function normalizeIdentity(value: unknown, idField = 'id'): IdentityDefinition {
  if (isRecord(value) && Array.isArray(value.fields)) {
    const fields = value.fields.map(String).filter(Boolean);
    if (fields.length > 0) {
      return { fields };
    }
  }

  return { fields: [idField] };
}

export function identityForResource(resource: IdentityResource): IdentityDefinition {
  return normalizeIdentity(resource.identity, String(resource.idField ?? 'id'));
}

export function singleIdentityField(identity: IdentityDefinition): string | null {
  return identity.fields.length === 1 ? identity.fields[0] ?? null : null;
}

export function normalizeKey(resource: IdentityResource, key: unknown): RuntimeRecord {
  const identity = identityForResource(resource);
  const idField = singleIdentityField(identity);
  if (idField && !isRecord(key)) {
    return { [idField]: key };
  }

  if (!isRecord(key)) {
    throw dbError(
      'DB_COMPOUND_KEY_REQUIRED',
      `Resource "${resource.name ?? 'unknown'}" requires an object key for compound identity.`,
      {
        status: 400,
        hint: `Pass a key object with fields: ${identity.fields.join(', ')}.`,
        details: { resource: resource.name, identity },
      },
    );
  }

  const normalized = Object.fromEntries(identity.fields.map((field) => [field, key[field]]));
  assertIdentityFields(resource, normalized);
  return normalized;
}

export function keyFromRecord(resource: IdentityResource, record: RuntimeRecord): RuntimeRecord {
  const identity = identityForResource(resource);
  assertIdentityFields(resource, record);
  return Object.fromEntries(identity.fields.map((field) => [field, record[field]]));
}

export function recordMatchesKey(resource: IdentityResource, record: RuntimeRecord, key: unknown): boolean {
  const identity = identityForResource(resource);
  const normalizedKey = isNormalizedKeyForIdentity(identity, key)
    ? key
    : normalizeKey(resource, key);
  return identity.fields.every((field) => valuesMatch(record[field], normalizedKey[field]));
}

export function identityKeyString(resource: IdentityResource, record: RuntimeRecord): string {
  const identity = identityForResource(resource);
  const key = keyFromRecord(resource, record);
  const idField = singleIdentityField(identity);
  return idField ? String(key[idField]) : JSON.stringify(key);
}

export function assertIdentityFields(resource: IdentityResource, record: RuntimeRecord): void {
  const identity = identityForResource(resource);
  const missing = identity.fields.filter((field) => record[field] === undefined || record[field] === null || record[field] === '');
  if (missing.length === 0) {
    return;
  }

  throw dbError(
    'DB_IDENTITY_FIELD_MISSING',
    `Resource "${resource.name ?? 'unknown'}" is missing identity field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
    {
      status: 400,
      hint: `Provide all identity fields: ${identity.fields.join(', ')}.`,
      details: { resource: resource.name, identity, missingFields: missing },
    },
  );
}

export function valuesMatch(left: unknown, right: unknown): boolean {
  return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
}

function isNormalizedKeyForIdentity(identity: IdentityDefinition, key: unknown): key is RuntimeRecord {
  return isRecord(key) && identity.fields.every((field) => field in key);
}

function isRecord(value: unknown): value is RuntimeRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
