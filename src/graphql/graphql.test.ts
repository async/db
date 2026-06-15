import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openDb } from '../index.js';
import { makeProject, writeConfig, writeFixture } from '../../tests/helpers.js';
import { handleGraphqlRequest as typedHandleGraphqlRequest } from './http.js';
import { executeGraphql as typedExecuteGraphql } from './index.js';

const executeGraphql = async (...args: any[]): Promise<any> => typedExecuteGraphql(args[0] as never, args[1] as never) as Promise<any>;
const handleGraphqlRequest = async (...args: any[]): Promise<void> => typedHandleGraphqlRequest(args[0] as never, args[1] as never, args[2] as never);

test('dependency-free GraphQL queries support aliases and variables', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "profile": {
        "type": "object",
        "fields": {
          "title": { "type": "string" }
        }
      }
    },
    "seed": [
      {
        "id": "u_1",
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "profile": { "title": "Admin" }
      }
    ]
  }`);

  const db = await openDb({ cwd });
  const result = await executeGraphql(db, {
    query: `query GetUser($id: ID!) {
      allUsers: users {
        id
        displayName: name
      }
      ada: user(id: $id) {
        emailAddress: email
        profile {
          jobTitle: title
        }
      }
    }`,
    variables: {
      id: 'u_1',
    },
  });

  assert.deepEqual(result, {
    data: {
      allUsers: [
        {
          id: 'u_1',
          displayName: 'Ada Lovelace',
        },
      ],
      ada: {
        emailAddress: 'ada@example.com',
        profile: {
          jobTitle: 'Admin',
        },
      },
    },
  });
});

test('dependency-free GraphQL supports repeated root fields with aliases in one request', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      email: 'ada@example.com',
    },
  ]));

  const db = await openDb({ cwd });
  const result = await executeGraphql(db, {
    query: `{
      users {
        id
        email
      }
      secondUsers: users {
        id
        email
      }
    }`,
  });

  assert.deepEqual(result, {
    data: {
      users: [
        {
          id: 'u_1',
          email: 'ada@example.com',
        },
      ],
      secondUsers: [
        {
          id: 'u_1',
          email: 'ada@example.com',
        },
      ],
    },
  });
});

test('GraphQL supports operationName fragments and __typename for Apollo clients', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "email": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "u_1", "name": "Ada Lovelace", "email": "ada@example.com" }
    ]
  }`);

  const db = await openDb({ cwd });
  const result = await executeGraphql(db, {
    query: `
      query ListUsers {
        users {
          ...UserFields
        }
      }

      query GetUser($id: ID!) {
        __typename
        user(id: $id) {
          __typename
          ...UserFields
        }
      }

      fragment UserFields on User {
        id
        displayName: name
      }
    `,
    operationName: 'GetUser',
    variables: {
      id: 'u_1',
    },
  });

  assert.deepEqual(result, {
    data: {
      __typename: 'Query',
      user: {
        __typename: 'User',
        id: 'u_1',
        displayName: 'Ada Lovelace',
      },
    },
  });
});

test('GraphQL supports include and skip directives on fields and fragments', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    },
  ]));

  const db = await openDb({ cwd });
  const result = await executeGraphql(db, {
    query: `
      query GetUser($id: ID!, $withEmail: Boolean!, $hideName: Boolean!) {
        user(id: $id) {
          id
          name @skip(if: $hideName)
          email @include(if: $withEmail)
          ...ExtraFields @include(if: $withEmail)
        }
      }

      fragment ExtraFields on User {
        typeName: __typename
      }
    `,
    variables: {
      id: 'u_1',
      withEmail: true,
      hideName: true,
    },
  });

  assert.deepEqual(result, {
    data: {
      user: {
        id: 'u_1',
        email: 'ada@example.com',
        typeName: 'User',
      },
    },
  });
});

test('GraphQL exposes minimal schema and type introspection', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "active": { "type": "boolean" }
    },
    "seed": []
  }`);

  const db = await openDb({ cwd });
  const result = await executeGraphql(db, {
    query: `{
      __schema {
        queryType { name }
        mutationType { name }
        types {
          name
          kind
        }
      }
      __type(name: "User") {
        name
        kind
        fields {
          name
          type {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }`,
  });

  assert.equal(result.data.__schema.queryType.name, 'Query');
  assert.equal(result.data.__schema.mutationType.name, 'Mutation');
  assert.ok(result.data.__schema.types.some((type) => type.name === 'User' && type.kind === 'OBJECT'));
  assert.deepEqual(result.data.__type, {
    name: 'User',
    kind: 'OBJECT',
    fields: [
      {
        name: 'id',
        type: {
          kind: 'NON_NULL',
          name: null,
          ofType: {
            kind: 'SCALAR',
            name: 'ID',
          },
        },
      },
      {
        name: 'name',
        type: {
          kind: 'NON_NULL',
          name: null,
          ofType: {
            kind: 'SCALAR',
            name: 'String',
          },
        },
      },
      {
        name: 'active',
        type: {
          kind: 'SCALAR',
          name: 'Boolean',
          ofType: null,
        },
      },
    ],
  });
});

test('dependency-free GraphQL collection mutations create update and delete records', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      }
    },
    "seed": []
  }`);

  const db = await openDb({ cwd });
  const created = await executeGraphql(db, {
    query: `mutation CreateUser($input: JSON!) {
      created: createUser(input: $input) {
        id
        name
        role
      }
    }`,
    variables: {
      input: {
        id: 'u_2',
        name: 'Grace Hopper',
        email: 'grace@example.com',
      },
    },
  });

  assert.deepEqual(created, {
    data: {
      created: {
        id: 'u_2',
        name: 'Grace Hopper',
        role: 'user',
      },
    },
  });

  const updated = await executeGraphql(db, {
    query: `mutation {
      updateUser(id: "u_2", patch: { role: "admin" }) {
        id
        role
      }
    }`,
  });

  assert.deepEqual(updated, {
    data: {
      updateUser: {
        id: 'u_2',
        role: 'admin',
      },
    },
  });

  const deleted = await executeGraphql(db, {
    query: `mutation {
      removed: deleteUser(id: "u_2")
    }`,
  });

  assert.deepEqual(deleted, {
    data: {
      removed: true,
    },
  });
});

test('GraphQL compound identity resources use key input objects', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'package-versions.schema.jsonc', `{
    "kind": "collection",
    "identity": { "fields": ["name", "version"] },
    "fields": {
      "name": { "type": "string", "required": true },
      "version": { "type": "string", "required": true },
      "tag": { "type": "string" }
    },
    "seed": [
      { "name": "@async/db", "version": "0.9.0", "tag": "latest" }
    ]
  }`);

  const db = await openDb({ cwd });
  const key = { name: '@async/db', version: '0.9.0' };

  const read = await executeGraphql(db, {
    query: `query GetPackageVersion($key: JSON!) {
      packageVersion(key: $key) {
        name
        version
        tag
      }
    }`,
    variables: { key },
  });

  assert.deepEqual(read, {
    data: {
      packageVersion: {
        name: '@async/db',
        version: '0.9.0',
        tag: 'latest',
      },
    },
  });

  const updated = await executeGraphql(db, {
    query: `mutation UpdatePackageVersion($key: JSON!) {
      updatePackageVersion(key: $key, patch: { tag: "stable", version: "ignored" }) {
        name
        version
        tag
      }
    }`,
    variables: { key },
  });

  assert.deepEqual(updated, {
    data: {
      updatePackageVersion: {
        name: '@async/db',
        version: '0.9.0',
        tag: 'stable',
      },
    },
  });

  const deleted = await executeGraphql(db, {
    query: `mutation DeletePackageVersion($key: JSON!) {
      deletePackageVersion(key: $key)
    }`,
    variables: { key },
  });

  assert.deepEqual(deleted, {
    data: {
      deletePackageVersion: true,
    },
  });
});

test('GraphQL collection updates do not backfill omitted schema defaults', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    defaults: {
      applyOnSafeMigration: false
    }
  };`);
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      }
    },
    "seed": [
      { "id": "u_1", "name": "Ada Lovelace" }
    ]
  }`);

  const db = await openDb({ cwd });
  const updated = await executeGraphql(db, {
    query: `mutation {
      updateUser(id: "u_1", patch: { name: "Ada Byron" }) {
        id
        name
      }
    }`,
  });

  assert.deepEqual(updated, {
    data: {
      updateUser: {
        id: 'u_1',
        name: 'Ada Byron',
      },
    },
  });
  assert.equal('role' in await db.collection('users').get('u_1'), false);
});

test('GraphQL collection mutations write through the selected non-JSON store', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `export default {
    stores: {
      default: 'memory'
    }
  };`);

  const db = await openDb({ cwd });
  const created = await executeGraphql(db, {
    query: `mutation {
      createUser(input: { id: "u_2", name: "Grace Hopper" }) {
        id
        name
      }
    }`,
  });

  assert.deepEqual(created, {
    data: {
      createUser: {
        id: 'u_2',
        name: 'Grace Hopper',
      },
    },
  });
  assert.deepEqual(await db.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
    { id: 'u_2', name: 'Grace Hopper' },
  ]);
  await assert.rejects(
    () => access(path.join(cwd, '.db/state/users.json')),
    { code: 'ENOENT' },
  );
});

test('dependency-free GraphQL mutations reject schema field type mismatches', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": { "type": "enum", "values": ["admin", "user"] }
    },
    "seed": []
  }`);

  const db = await openDb({ cwd });
  const result = await executeGraphql(db, {
    query: `mutation {
      createUser(input: { id: "u_1", email: 42, role: "owner" }) {
        id
      }
    }`,
  });

  assert.equal(result.data, null);
  assert.equal(result.errors[0].extensions.code, 'DB_SCHEMA_VALIDATION_FAILED');
  assert.match(result.errors[0].message, /email/);
  assert.equal(result.errors[0].extensions.details.diagnostics[0].code, 'SCHEMA_FIELD_TYPE_MISMATCH');
});

test('dependency-free GraphQL mutations reject schema constraint violations', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": {
        "type": "string",
        "required": true,
        "unique": true,
        "pattern": "^[^@\\\\s]+@[^@\\\\s]+\\\\.[^@\\\\s]+$"
      },
      "age": {
        "type": "number",
        "min": 13
      }
    },
    "seed": [
      { "id": "u_1", "email": "ada@example.com", "age": 28 }
    ]
  }`);

  const db = await openDb({ cwd });
  const result = await executeGraphql(db, {
    query: `mutation {
      createUser(input: { id: "u_2", email: "bad-email", age: 12 }) {
        id
      }
    }`,
  });

  assert.equal(result.data, null);
  assert.equal(result.errors[0].extensions.code, 'DB_SCHEMA_VALIDATION_FAILED');
  assert.deepEqual(
    result.errors[0].extensions.details.diagnostics.map((diagnostic) => diagnostic.details.constraint),
    ['pattern', 'min'],
  );
});

test('dependency-free GraphQL document queries and mutations work', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
    locale: 'en-US',
    features: {
      billing: false,
    },
  }));

  const db = await openDb({ cwd });
  const updated = await executeGraphql(db, {
    query: `mutation {
      updateSettings(patch: { theme: "dark" }) {
        theme
        locale
      }
      setSettings(path: "/features/billing", value: true) {
        features {
          billing
        }
      }
    }`,
  });

  assert.deepEqual(updated, {
    data: {
      updateSettings: {
        theme: 'dark',
        locale: 'en-US',
      },
      setSettings: {
        features: {
          billing: true,
        },
      },
    },
  });

  const queried = await executeGraphql(db, {
    query: `{
      appSettings: settings {
        theme
        features {
          billingEnabled: billing
        }
      }
    }`,
  });

  assert.deepEqual(queried, {
    data: {
      appSettings: {
        theme: 'dark',
        features: {
          billingEnabled: true,
        },
      },
    },
  });
});

test('dependency-free GraphQL supports batched requests', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "u_1", "name": "Ada Lovelace" }
    ]
  }`);
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));

  const db = await openDb({ cwd });
  const result = await executeGraphql(db, [
    {
      query: '{ users { id name } }',
    },
    {
      query: '{ settings { theme } }',
    },
  ]);

  assert.deepEqual(result, [
    {
      data: {
        users: [
          {
            id: 'u_1',
            name: 'Ada Lovelace',
          },
        ],
      },
    },
    {
      data: {
        settings: {
          theme: 'light',
        },
      },
    },
  ]);
});

test('GraphQL errors include codes hints and available fields', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const result = await executeGraphql(db, {
    query: '{ nope { id } }',
  });

  assert.equal(result.data, null);
  assert.equal(result.errors[0].extensions.code, 'GRAPHQL_UNKNOWN_QUERY_FIELD');
  assert.match(result.errors[0].message, /Unknown GraphQL query field "nope"/);
  assert.match(result.errors[0].extensions.hint, /users/);
  assert.deepEqual(result.errors[0].extensions.details.availableFields, ['users', 'user']);
});

test('GraphQL missing variable errors explain the fix', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const result = await executeGraphql(db, {
    query: 'query GetUser($id: ID!) { user(id: $id) { id } }',
  });

  assert.equal(result.errors[0].extensions.code, 'GRAPHQL_MISSING_VARIABLE');
  assert.match(result.errors[0].message, /\$id/);
  assert.match(result.errors[0].extensions.hint, /variables object/);
});

test('GraphQL collection mutations reject missing id arguments', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const updated = await executeGraphql(db, {
    query: `mutation {
      updateUser(patch: { name: "Ada Byron" }) {
        id
      }
    }`,
  });
  const deleted = await executeGraphql(db, {
    query: `mutation {
      deleteUser
    }`,
  });
  const emptyIdUpdate = await executeGraphql(db, {
    query: `mutation {
      updateUser(id: "", patch: { name: "Ada Byron" }) {
        id
      }
    }`,
  });
  const nullIdDelete = await executeGraphql(db, {
    query: 'mutation DeleteUser($id: ID) { deleteUser(id: $id) }',
    variables: {
      id: null,
    },
  });

  assert.equal(updated.data, null);
  assert.equal(updated.errors[0].extensions.code, 'GRAPHQL_MISSING_ID_ARGUMENT');
  assert.equal(updated.errors[0].extensions.details.field, 'updateUser');
  assert.equal(updated.errors[0].extensions.details.argument, 'id');

  assert.equal(deleted.data, null);
  assert.equal(deleted.errors[0].extensions.code, 'GRAPHQL_MISSING_ID_ARGUMENT');
  assert.equal(deleted.errors[0].extensions.details.field, 'deleteUser');
  assert.equal(deleted.errors[0].extensions.details.argument, 'id');

  assert.equal(emptyIdUpdate.data, null);
  assert.equal(emptyIdUpdate.errors[0].extensions.code, 'GRAPHQL_MISSING_ID_ARGUMENT');
  assert.equal(emptyIdUpdate.errors[0].extensions.details.field, 'updateUser');

  assert.equal(nullIdDelete.data, null);
  assert.equal(nullIdDelete.errors[0].extensions.code, 'GRAPHQL_MISSING_ID_ARGUMENT');
  assert.equal(nullIdDelete.errors[0].extensions.details.field, 'deleteUser');
});

test('GraphQL HTTP handler returns 413 for oversized JSON bodies', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([]));

  const db = await openDb({
    cwd,
    server: {
      maxBodyBytes: 12,
    },
  });
  const response = makeResponse();

  await handleGraphqlRequest(
    db,
    makeRequest('POST', {
      query: '{ users { id } }',
    }),
    response,
  );

  assert.equal(response.status, 413);
  assert.equal(response.json().error.code, 'JSON_BODY_TOO_LARGE');
});

function makeRequest(method, body) {
  return {
    method,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
  };
}

function makeResponse() {
  return {
    status: null,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += chunk;
    },
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}
