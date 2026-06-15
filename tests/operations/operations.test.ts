import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildOperationManifest as typedBuildOperationManifest, hashOperation, loadConfig as typedLoadConfig } from '../../src/index.js';
import { normalizeOperationTemplate as typedNormalizeOperationTemplate, operationRequest as typedOperationRequest } from '../../src/operations.js';
import { makeProject } from '../helpers.js';

const loadConfig = async (options: unknown): Promise<any> => typedLoadConfig(options as never) as Promise<any>;
const buildOperationManifest = async (...args: any[]): Promise<any> => typedBuildOperationManifest(args[0] as never, args[1] as never) as Promise<any>;
const normalizeOperationTemplate = (...args: any[]): any => typedNormalizeOperationTemplate(args[0] as never);
const operationRequest = (...args: any[]): any => typedOperationRequest(args[0] as never, args[1] as never);

test('operation strings and JSON templates canonicalize to the same stable hash', () => {
  const stringHash = hashOperation('/users/{id}.json?select=id,name');
  const objectHash = hashOperation({
    method: 'GET',
    path: '/users/{id}.json',
    query: {
      select: 'id,name',
    },
  });

  assert.match(stringHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(stringHash, objectHash);
});

test('GraphQL operation templates canonicalize to stable hashes', () => {
  const query = 'query GetUser($id: ID!) { user(id: $id) { id name } }';
  const first = hashOperation({
    name: 'GetUser',
    query,
    operationName: 'GetUser',
    variables: {
      id: '{id}',
    },
  });
  const second = hashOperation({
    operationName: 'GetUser',
    variables: {
      id: '{id}',
    },
    query,
  });

  assert.match(first, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test('operation manifest build emits full server registry and client-safe refs', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/operations'), { recursive: true });
  await writeFile(path.join(cwd, 'db/operations/get-user.jsonc'), `{
    "name": "GetUser",
    "method": "GET",
    "path": "/users/{id}.json",
    "query": {
      "select": "id,name"
    }
  }`, 'utf8');

  const config = await loadConfig({
    cwd,
    operations: {
      sourceDir: './db/operations',
      outFile: './src/generated/db.operations.json',
      refsOutFile: './src/generated/db.operation-refs.json',
    },
  });
  const result = await buildOperationManifest(config, {
    generatedAt: '2026-05-20T00:00:00.000Z',
  });

  const [ref] = Object.keys(result.manifest.operations);
  assert.match(ref, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(result.refs.operations.GetUser, {
    name: 'GetUser',
    ref,
  });
  assert.equal(result.refs.operations.GetUser.path, undefined);
  assert.equal(result.refs.operations.GetUser.query, undefined);
  assert.equal(result.manifest.operations[ref].path, '/users/{id}.json');
  assert.equal(result.manifest.operations[ref].query.select, 'id,name');
  assert.equal(result.manifest.operations[ref].hash, undefined);
  assert.equal(JSON.parse(await readFile(path.join(cwd, 'src/generated/db.operations.json'), 'utf8')).operations[ref].name, 'GetUser');
  assert.equal(JSON.parse(await readFile(path.join(cwd, 'src/generated/db.operation-refs.json'), 'utf8')).operations.GetUser.ref, ref);
  assert.equal(JSON.parse(await readFile(path.join(cwd, 'src/generated/db.operation-refs.json'), 'utf8')).operations.GetUser.hash, undefined);
});

test('operation manifest build supports GraphQL templates', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/operations'), { recursive: true });
  await writeFile(path.join(cwd, 'db/operations/get-user.jsonc'), `{
    "name": "GetUser",
    "query": "query GetUser($id: ID!) { user(id: $id) { id name } }",
    "operationName": "GetUser",
    "variables": {
      "id": "{id}"
    }
  }`, 'utf8');

  const config = await loadConfig({
    cwd,
    operations: {
      sourceDir: './db/operations',
    },
  });
  const result = await buildOperationManifest(config, {
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const [ref] = Object.keys(result.manifest.operations);

  assert.match(ref, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.manifest.operations[ref].kind, 'graphql');
  assert.equal(result.manifest.operations[ref].operationName, 'GetUser');
  assert.deepEqual(result.refs.operations.GetUser, {
    name: 'GetUser',
    ref,
  });
});

test('operation manifest build honors explicit operation refs', async () => {
  const cwd = await makeProject();
  const operation = {
    name: 'GetUser',
    ref: 'users.get',
    method: 'GET',
    path: '/users/{id}.json',
    query: {
      select: 'id,name',
    },
  };

  const nameConfig = await loadConfig({
    cwd,
    operations: {
      sourceDir: './db/operations',
    },
  });
  const named = await buildOperationManifest(nameConfig, {
    generatedAt: '2026-05-20T00:00:00.000Z',
    operations: [operation],
  });

  assert.deepEqual(Object.keys(named.manifest.operations), ['users.get']);
  assert.deepEqual(named.refs.operations.GetUser, {
    name: 'GetUser',
    ref: 'users.get',
  });
  assert.equal(named.manifest.operations['users.get'].ref, 'users.get');
});

test('operation manifest build rejects duplicate operation refs', async () => {
  const cwd = await makeProject();
  const config = await loadConfig({
    cwd,
    operations: {
      sourceDir: './db/operations',
    },
  });
  await assert.rejects(
    () => buildOperationManifest(config, {
      generatedAt: '2026-05-20T00:00:00.000Z',
      operations: [
        {
          name: 'GetUser',
          ref: 'users.get',
          method: 'GET',
          path: '/users/{id}.json',
        },
        {
          name: 'FetchUser',
          ref: 'users.get',
          method: 'GET',
          path: '/profiles/{id}.json',
        },
      ],
    }),
    (error: any) => error.code === 'OPERATION_DUPLICATE_REF'
      && error.details.ref === 'users.get',
  );
});

test('operation manifest build rejects duplicate operation names', async () => {
  const cwd = await makeProject();
  const config = await loadConfig({
    cwd,
    operations: {
      sourceDir: './db/operations',
    },
  });

  await assert.rejects(
    () => buildOperationManifest(config, {
      generatedAt: '2026-05-20T00:00:00.000Z',
      operations: [
        {
          name: 'GetUser',
          method: 'GET',
          path: '/users/{id}.json',
        },
        {
          name: 'GetUser',
          method: 'GET',
          path: '/profiles/{id}.json',
        },
      ],
    }),
    (error: any) => error.code === 'OPERATION_DUPLICATE_NAME'
      && error.details.name === 'GetUser',
  );
});

test('operation manifest build allows duplicate templates when refs are unique', async () => {
  const cwd = await makeProject();
  const config = await loadConfig({
    cwd,
    operations: {
      sourceDir: './db/operations',
    },
  });

  const result = await buildOperationManifest(config, {
    generatedAt: '2026-05-20T00:00:00.000Z',
    operations: [
      {
        name: 'GetUser',
        ref: 'users.get',
        method: 'GET',
        path: '/users/{id}.json',
      },
      {
        name: 'FetchUser',
        ref: 'users.fetch',
        method: 'GET',
        path: '/users/{id}.json',
      },
    ],
  });

  assert.deepEqual(Object.keys(result.manifest.operations), ['users.get', 'users.fetch']);
});

test('operation manifest maps keep prototype names as data keys', async () => {
  const cwd = await makeProject();
  const config = await loadConfig({
    cwd,
    operations: {
      sourceDir: './db/operations',
    },
  });

  const result = await buildOperationManifest(config, {
    generatedAt: '2026-05-20T00:00:00.000Z',
    operations: [
      {
        name: '__proto__',
        ref: 'users.proto',
        method: 'GET',
        path: '/users/{id}.json',
      },
      {
        name: 'ConstructorUser',
        ref: 'constructor',
        method: 'GET',
        path: '/profiles/{id}.json',
      },
      {
        name: 'GetUser',
        ref: '__proto__',
        method: 'GET',
        path: '/accounts/{id}.json',
      },
    ],
  });

  assert.equal(Object.getPrototypeOf(result.manifest.operations), null);
  assert.equal(Object.getPrototypeOf(result.refs.operations), null);
  assert.equal(result.manifest.operations.__proto__.path, '/accounts/{id}.json');
  assert.equal(result.manifest.operations.constructor.path, '/profiles/{id}.json');
  assert.equal(result.refs.operations.__proto__.ref, 'users.proto');
  assert.equal(result.refs.operations.constructor, undefined);
});

test('operation requests validate variables and encode path and query values', () => {
  assert.throws(
    () => operationRequest('/users/{id}.json?select=id,name', {}),
    (error: any) => error.code === 'OPERATION_VARIABLE_MISSING'
      && error.details.missing.includes('id'),
  );

  assert.throws(
    () => operationRequest('/users/{id}.json?select=id,name', { id: 'u_1', extra: 'nope' }),
    (error: any) => error.code === 'OPERATION_VARIABLE_UNKNOWN'
      && error.details.extra.includes('extra'),
  );

  const request = operationRequest('/users/{id}.json?filter={filter}&select=id,name', {
    id: 'u 1/../admin',
    filter: 'email=a+b@example.com&role=admin',
  });

  assert.equal(request.method, 'GET');
  assert.equal(request.path, '/users/u%201%2F..%2Fadmin.json?filter=email%3Da%2Bb%40example.com%26role%3Dadmin&select=id,name');
});

test('operation string templates report stable errors for invalid URLs', () => {
  assert.throws(
    () => normalizeOperationTemplate('GET http://%'),
    (error: any) => error.code === 'OPERATION_INVALID_TEMPLATE'
      && error.status === 400
      && error.details.reason === 'invalid-url',
  );

  assert.throws(
    () => normalizeOperationTemplate('GET %'),
    (error: any) => error.code === 'OPERATION_INVALID_TEMPLATE'
      && error.status === 400
      && error.details.reason === 'invalid-encoding',
  );
});

test('GraphQL operation requests substitute registered variables without parsing query variables', () => {
  const request = operationRequest({
    query: 'query GetUser($id: ID!) { user(id: $id) { id name } }',
    operationName: 'GetUser',
    variables: {
      id: '{id}',
    },
  }, {
    id: 'u_1',
  });

  assert.deepEqual(request, {
    kind: 'graphql',
    query: 'query GetUser($id: ID!) { user(id: $id) { id name } }',
    variables: {
      id: 'u_1',
    },
    operationName: 'GetUser',
  });

  assert.throws(
    () => operationRequest({
      query: 'query GetUser($id: ID!) { user(id: $id) { id name } }',
      variables: {
        id: '{id}',
      },
    }, {}),
    (error: any) => error.code === 'OPERATION_VARIABLE_MISSING',
  );
});
