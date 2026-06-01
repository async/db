import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openDb as typedOpenDb } from '../../src/index.js';
import { createDbOperationHandler as typedCreateDbOperationHandler } from '../../src/operations.js';
import { makeProject, writeFixture } from '../helpers.js';

const openDb = async (options: unknown): Promise<any> => typedOpenDb(options as never) as Promise<any>;
const createDbOperationHandler = (...args: any[]): any => typedCreateDbOperationHandler(args[0] as never, args[1] as never);

test('operation handler accepts only refs when configured ref-only', async () => {
  const db = await openOperationDb({ acceptRefs: 'ref' });
  const handler = createDbOperationHandler(db);

  const result = await handler.execute('users.get', { id: 'u_1' });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    id: 'u_1',
    name: 'Ada',
  });
  await assert.rejects(
    () => handler.execute('GetUser', { id: 'u_1' }),
    (error: any) => error.code === 'OPERATION_NOT_FOUND',
  );
});

test('operation handler accepts only names when configured name-only', async () => {
  const db = await openOperationDb({ acceptRefs: 'name' });
  const handler = createDbOperationHandler(db);

  const result = await handler.execute('GetUser', { id: 'u_1' });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    id: 'u_1',
    name: 'Ada',
  });
  await assert.rejects(
    () => handler.execute('users.get', { id: 'u_1' }),
    (error: any) => error.code === 'OPERATION_NOT_FOUND',
  );
});

test('operation handler accepts names and refs by default', async () => {
  const db = await openOperationDb();
  const handler = createDbOperationHandler(db);

  assert.equal((await handler.execute('users.get', { id: 'u_1' })).status, 200);
  assert.equal((await handler.execute('GetUser', { id: 'u_1' })).status, 200);
});

test('operation handler accepts inline string registry templates by name', async () => {
  const db = await openOperationDb({
    acceptRefs: 'name',
    registry: {
      GetUser: '/users/{id}.json?select=id,name',
    },
  });
  const handler = createDbOperationHandler(db);

  const result = await handler.execute('GetUser', { id: 'u_1' });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    id: 'u_1',
    name: 'Ada',
  });
});

test('operation handler accepts string templates returned from custom resolvers', async () => {
  const db = await openOperationDb({
    registry: {},
  });
  const handler = createDbOperationHandler(db, {
    resolveRef(ref) {
      return ref === 'GetUser'
        ? '/users/{id}.json?select=id,name'
        : null;
    },
  });

  const result = await handler.execute('GetUser', { id: 'u_1' });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    id: 'u_1',
    name: 'Ada',
  });
});

test('operation handler reports generated registry load failures', async () => {
  const missing = await openOperationDb({
    registry: {},
    outFile: './src/generated/missing.operations.json',
  });
  await assert.rejects(
    () => createDbOperationHandler(missing).execute('GetUser', { id: 'u_1' }),
    (error: any) => error.code === 'OPERATION_REGISTRY_LOAD_FAILED'
      && error.status === 500
      && error.details?.reason === 'missing'
      && !('contents' in error.details),
  );

  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src/generated'), { recursive: true });
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeFile(path.join(cwd, 'src/generated/db.operations.json'), '{ not json');
  const invalid = await openDb({
    cwd,
    operations: {
      enabled: true,
      outFile: './src/generated/db.operations.json',
    },
  });

  await assert.rejects(
    () => createDbOperationHandler(invalid).execute('GetUser', { id: 'u_1' }),
    (error: any) => error.code === 'OPERATION_REGISTRY_LOAD_FAILED'
      && error.status === 500
      && error.details?.reason === 'invalid-json'
      && !('contents' in error.details),
  );
});

test('operation handler validateRef can reject or map refs', async () => {
  const db = await openOperationDb();
  const rejecting = createDbOperationHandler(db, {
    validateRef({ decodedRef }) {
      return decodedRef !== 'GetUser';
    },
  });
  await assert.rejects(
    () => rejecting.execute('GetUser', { id: 'u_1' }),
    (error: any) => error.code === 'OPERATION_NOT_FOUND',
  );

  const mapping = createDbOperationHandler(db, {
    acceptRefs: 'ref',
    validateRef({ decodedRef, registry }) {
      if (decodedRef === 'public:get-user') {
        return registry['users.get'];
      }
      return true;
    },
  });
  const result = await mapping.execute('public:get-user', { id: 'u_1' });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    id: 'u_1',
    name: 'Ada',
  });
});

test('operation handler gives validators a null-prototype registry map', async () => {
  const db = await openOperationDb();
  const handler = createDbOperationHandler(db, {
    validateRef({ decodedRef, registry }) {
      assert.equal(Object.getPrototypeOf(registry), null);
      return registry[decodedRef];
    },
  });

  const result = await handler.execute('users.get', { id: 'u_1' });
  assert.equal(result.status, 200);

  await assert.rejects(
    () => handler.execute('__proto__', { id: 'u_1' }),
    (error: any) => error.code === 'OPERATION_NOT_FOUND',
  );
});

test('operation handler preserves prototype-key refs from generated registry files', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src/generated'), { recursive: true });
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeFile(path.join(cwd, 'src/generated/db.operations.json'), `{
    "version": 1,
    "kind": "db.operations",
    "operations": {
      "__proto__": {
        "name": "GetProtoUser",
        "ref": "__proto__",
        "method": "GET",
        "path": "/users/{id}.json",
        "query": {
          "select": "id,name"
        }
      },
      "constructor": {
        "name": "GetConstructorUser",
        "ref": "constructor",
        "method": "GET",
        "path": "/users/{id}.json",
        "query": {
          "select": "id,name"
        }
      }
    }
  }`, 'utf8');

  const db = await openDb({
    cwd,
    operations: {
      enabled: true,
      outFile: './src/generated/db.operations.json',
      acceptRefs: 'ref',
    },
  });
  const handler = createDbOperationHandler(db);

  assert.deepEqual((await handler.execute('__proto__', { id: 'u_1' })).body, {
    id: 'u_1',
    name: 'Ada',
  });
  assert.deepEqual((await handler.execute('constructor', { id: 'u_1' })).body, {
    id: 'u_1',
    name: 'Ada',
  });
});

async function openOperationDb(operationOptions = {}) {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada',
      email: 'ada@example.com',
    },
  ]));

  return openDb({
    cwd,
    operations: {
      enabled: true,
      registry: {
        'users.get': {
          name: 'GetUser',
          ref: 'users.get',
          method: 'GET',
          path: '/users/{id}.json',
          query: {
            select: 'id,name',
          },
        },
      },
      ...operationOptions,
    },
  });
}
