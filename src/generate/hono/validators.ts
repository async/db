export function renderValidators(): string {
  return `${generatedHeader()}
import { resources } from './schema.js';

export function applyDefaults(resourceName: string, value: Record<string, unknown>) {
  const resource = requireResource(resourceName);
  const next = { ...value };
  for (const [fieldName, field] of Object.entries<any>(resource.fields || {})) {
    if (next[fieldName] === undefined && 'default' in field) {
      next[fieldName] = structuredClone(field.default);
    }
  }
  return next;
}

export function stripUnknownFields(resourceName: string, value: Record<string, unknown>) {
  const resource = requireResource(resourceName);
  const next: Record<string, unknown> = {};
  for (const fieldName of Object.keys(resource.fields || {})) {
    if (value[fieldName] !== undefined) {
      next[fieldName] = value[fieldName];
    }
  }
  return next;
}

export function validateRecord(resourceName: string, value: Record<string, unknown>) {
  const resource = requireResource(resourceName);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(resourceName, 'Record must be a JSON object.');
  }

  for (const [fieldName, field] of Object.entries<any>(resource.fields || {})) {
    const fieldValue = value[fieldName];
    if (field.required && (fieldValue === undefined || (fieldValue === null && !field.nullable))) {
      throw validationError(resourceName, 'Missing required field "' + fieldName + '".');
    }
    if (fieldValue !== undefined) {
      validateValue(resourceName, fieldName, field, fieldValue);
    }
  }
}

function validateValue(resourceName: string, fieldPath: string, field: any, value: unknown) {
  if (value === null && field.type !== 'unknown' && !field.nullable) {
    throw validationError(resourceName, 'Field "' + fieldPath + '" cannot be null.');
  }

  if (value === null) {
    return;
  }

  if (field.type === 'unknown') {
    return;
  }
  if ((field.type === 'string' || field.type === 'datetime') && typeof value !== 'string') {
    throw validationError(resourceName, 'Field "' + fieldPath + '" must be a string.');
  }
  if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw validationError(resourceName, 'Field "' + fieldPath + '" must be a finite number.');
  }
  if (field.type === 'boolean' && typeof value !== 'boolean') {
    throw validationError(resourceName, 'Field "' + fieldPath + '" must be a boolean.');
  }
  if (field.type === 'enum' && !field.values?.includes(value)) {
    throw validationError(resourceName, 'Field "' + fieldPath + '" must be one of: ' + (field.values || []).join(', ') + '.');
  }
  if (field.type === 'array') {
    if (!Array.isArray(value)) {
      throw validationError(resourceName, 'Field "' + fieldPath + '" must be an array.');
    }
    value.forEach((item, index) => validateValue(resourceName, fieldPath + '[' + index + ']', field.items || { type: 'unknown' }, item));
  }
  if (field.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw validationError(resourceName, 'Field "' + fieldPath + '" must be an object.');
    }
    for (const [childName, childField] of Object.entries<any>(field.fields || {})) {
      const childValue = (value as Record<string, unknown>)[childName];
      if (childField.required && (childValue === undefined || (childValue === null && !childField.nullable))) {
        throw validationError(resourceName, 'Missing required field "' + fieldPath + '.' + childName + '".');
      }
      if (childValue !== undefined) {
        validateValue(resourceName, fieldPath + '.' + childName, childField, childValue);
      }
    }
  }
}

function requireResource(resourceName: string) {
  const resource = resolveResource(resourceName);
  if (!resource) {
    throw validationError(resourceName, 'Unknown resource "' + resourceName + '". Tried: ' + resourceNameCandidates(resourceName).join(', ') + '.');
  }
  return resource;
}

function resolveResource(resourceName: string) {
  for (const candidate of resourceNameCandidates(resourceName)) {
    const resource = (resources as Record<string, any>)[candidate];
    if (resource) {
      return resource;
    }
  }
  return null;
}

function resourceNameCandidates(value: string) {
  const exact = String(value);
  return [...new Set([exact, camelCase(exact), kebabCase(exact)])];
}

function camelCase(value: string) {
  return words(value).map((word, index) => (
    index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
  )).join('');
}

function kebabCase(value: string) {
  return words(value).join('-');
}

function words(value: string) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function validationError(resourceName: string, message: string) {
  const error = new Error(resourceName + ': ' + message) as Error & { status?: number; code?: string };
  error.status = 400;
  error.code = 'VALIDATION_FAILED';
  return error;
}
`;
}

function generatedHeader(comment = '//'): string {
  return `${comment} This file is generated by db. Edit it freely after generation.\n`;
}
