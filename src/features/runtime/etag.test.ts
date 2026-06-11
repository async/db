import assert from 'node:assert/strict';
import test from 'node:test';
import { assertIfMatch, recordEtag } from './etag.js';

test('recordEtag is stable across property insertion order', () => {
  assert.equal(
    recordEtag({ id: 'u_1', name: 'Ada', active: true }),
    recordEtag({ active: true, name: 'Ada', id: 'u_1' }),
  );
  assert.notEqual(
    recordEtag({ id: 'u_1', name: 'Ada' }),
    recordEtag({ id: 'u_1', name: 'Grace' }),
  );
  assert.match(recordEtag({ id: 'u_1' }), /^".+"$/);
});

test('assertIfMatch accepts star, weak tags, and comma-separated lists', () => {
  const record = { id: 'u_1', name: 'Ada' };
  const etag = recordEtag(record);

  assertIfMatch(record, null);
  assertIfMatch(record, undefined);
  assertIfMatch(record, '*');
  assertIfMatch(record, etag);
  assertIfMatch(record, `W/${etag}`);
  assertIfMatch(record, `"other", ${etag}`);
});

test('assertIfMatch fails with a 412 error envelope on mismatch', () => {
  const record = { id: 'u_1', name: 'Ada' };

  assert.throws(
    () => assertIfMatch(record, '"stale"', { resource: 'users', id: 'u_1' }),
    (error: Error & { code?: string; status?: number; hint?: string; details?: Record<string, unknown> }) => {
      assert.equal(error.code, 'DB_PRECONDITION_FAILED');
      assert.equal(error.status, 412);
      assert.match(error.hint ?? '', /If-Match/);
      assert.equal(error.details?.resource, 'users');
      assert.equal(error.details?.id, 'u_1');
      assert.equal(error.details?.currentEtag, recordEtag(record));
      return true;
    },
  );
});
