import { createHash } from 'node:crypto';
import { dbError } from '../../errors.js';

/**
 * Optimistic-concurrency entity tags for runtime records and documents.
 *
 * Single-record REST reads expose the current tag in an ETag header; writes
 * may send If-Match to fail with 412 instead of silently overwriting another
 * writer's change. Tags are content hashes, so they stay stable across
 * processes and restarts.
 */
export function recordEtag(value: unknown): string {
  return `"${createHash('sha256').update(stableJson(value)).digest('base64url')}"`;
}

export type IfMatchDetails = {
  resource?: string;
  id?: unknown;
  [key: string]: unknown;
};

/**
 * Enforce an If-Match precondition against the current stored value.
 * `*` matches any existing value. Multiple comma-separated tags and weak
 * `W/` prefixes are accepted; a mismatch throws a 412 DB_PRECONDITION_FAILED.
 */
export function assertIfMatch(currentValue: unknown, ifMatch: string | null | undefined, details: IfMatchDetails = {}): void {
  if (ifMatch === undefined || ifMatch === null || ifMatch === '') {
    return;
  }

  const expected = parseIfMatchHeader(ifMatch);
  if (expected.includes('*')) {
    return;
  }

  const currentEtag = recordEtag(currentValue);
  if (expected.includes(currentEtag)) {
    return;
  }

  throw dbError(
    'DB_PRECONDITION_FAILED',
    'If-Match precondition failed: the stored value changed since it was read.',
    {
      status: 412,
      hint: 'Re-read the current value (the ETag response header carries its tag), reapply your change, and retry with the fresh If-Match value.',
      details: {
        ...details,
        ifMatch: expected,
        currentEtag,
      },
    },
  );
}

function parseIfMatchHeader(value: string): string[] {
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^W\//i, ''));
}

/**
 * JSON serialization with sorted object keys so logically equal values always
 * hash to the same tag regardless of property insertion order.
 */
function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? 'null';
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }
  return value;
}
