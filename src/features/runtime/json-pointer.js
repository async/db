import { dbError } from '../../errors.js';

export function getPointer(document, pointer) {
  const parts = parsePointer(pointer);
  let value = document;
  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = value[part];
  }
  return value;
}

export function setPointer(document, pointer, value) {
  const parts = parsePointer(pointer);
  if (parts.length === 0) {
    throw dbError(
      'DB_DOCUMENT_SET_ROOT',
      'Cannot set the root document with set().',
      {
        status: 400,
        hint: 'Use document.put(value) to replace the whole document, or pass a JSON pointer like "/theme" to set a nested value.',
      },
    );
  }

  let current = document;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

export function parsePointer(pointer) {
  if (!pointer || pointer === '/') {
    return [];
  }

  if (!pointer.startsWith('/')) {
    throw dbError(
      'DB_INVALID_JSON_POINTER',
      `Invalid JSON pointer "${pointer}".`,
      {
        status: 400,
        hint: 'JSON pointers must start with "/". For example: "/theme" or "/features/billing".',
        details: { pointer },
      },
    );
  }

  return pointer
    .slice(1)
    .split('/')
    .filter(Boolean)
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}
