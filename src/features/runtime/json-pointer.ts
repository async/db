import { dbError } from '../../errors.js';

type JsonContainer = Record<string, unknown> | unknown[];
export type JsonPathSegment = string | number;
export type JsonPath = string | JsonPathSegment[];

export function getPointer(document: unknown, path: JsonPath): unknown {
  const parts = parsePath(path);
  let value = document;
  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = (value as Record<string | number, unknown>)[part];
  }
  return value;
}

export function setPointer(document: JsonContainer, path: JsonPath, value: unknown): void {
  const parts = parsePath(path);
  if (parts.length === 0) {
    throw dbError(
      'DB_DOCUMENT_SET_ROOT',
      'Cannot set the root document with set().',
      {
        status: 400,
        hint: 'Use document.put(value) to replace the whole document, or pass a path like "/theme", "theme", or ["ui", "theme"] to set a nested value.',
      },
    );
  }

  let current = document as Record<string | number, unknown>;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const nextPart = parts[index + 1];
    const existing = current[part];
    if (!isJsonContainer(existing)) {
      current[part] = newContainerForNextPathSegment(nextPart);
    }
    current = current[part] as Record<string | number, unknown>;
  }
  const last = parts.at(-1);
  if (last !== undefined) {
    current[last] = value;
  }
}

export function parsePath(path: JsonPath = ''): JsonPathSegment[] {
  if (Array.isArray(path)) {
    return path.map(normalizeArrayPathSegment);
  }

  return parsePointer(path);
}

export function parsePointer(pointer: string): JsonPathSegment[] {
  if (!pointer || pointer === '/') {
    return [];
  }

  if (!pointer.startsWith('/')) {
    return [assertSafePathSegment(pointer)];
  }

  return pointer
    .slice(1)
    .split('/')
    .filter(Boolean)
    .map((part) => assertSafePathSegment(part.replaceAll('~1', '/').replaceAll('~0', '~')));
}

function normalizeArrayPathSegment(segment: JsonPathSegment): JsonPathSegment {
  if (typeof segment === 'number') {
    if (!Number.isInteger(segment) || segment < 0) {
      throw dbError(
        'DB_INVALID_DOCUMENT_PATH',
        `Invalid document path segment "${segment}".`,
        {
          status: 400,
          hint: 'Array path number segments must be non-negative integers.',
          details: { segment },
        },
      );
    }
    return segment;
  }

  return assertSafePathSegment(segment);
}

function assertSafePathSegment(segment: string): string {
  if (segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
    throw dbError(
      'DB_UNSAFE_DOCUMENT_PATH',
      `Unsafe document path segment "${segment}".`,
      {
        status: 400,
        hint: 'Use a normal JSON field name. Prototype-related field names cannot be read or written through document paths.',
        details: { segment },
      },
    );
  }

  return segment;
}

function isJsonContainer(value: unknown): value is JsonContainer {
  return Boolean(value) && typeof value === 'object';
}

function newContainerForNextPathSegment(segment: JsonPathSegment): JsonContainer {
  return isArrayIndexSegment(segment) ? [] : {};
}

function isArrayIndexSegment(segment: JsonPathSegment): boolean {
  return typeof segment === 'number' || /^(0|[1-9]\d*)$/.test(segment);
}
