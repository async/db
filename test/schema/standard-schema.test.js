import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { executeGraphql, generateTypes, loadConfig, loadDbSchema, openDb, syncDb } from '../../src/index.js';
import { handleRestRequest } from '../../src/rest/handler.js';
import { makeProject, writeFixture } from '../helpers.js';

test('standard schema resources use dependency-free validators plus async-db metadata overlays', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.mjs', `
import { collection, field } from '@async/db/schema';

const UserSchema = {
  '~standard': {
    version: 1,
    vendor: 'fixture-standard',
    validate(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [{ message: 'Expected object' }] };
      }
      if (typeof value.email !== 'string' || !value.email.includes('@')) {
        return { issues: [{ message: 'Email must include @', path: ['email'] }] };
      }
      return {
        value: {
          ...value,
          email: value.email.trim().toLowerCase(),
        },
      };
    },
    jsonSchema: {
      output() {
        return {
          type: 'object',
          required: ['email'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            age: { type: 'number' },
          },
        };
      },
    },
  },
};

export default collection(UserSchema, {
  idField: 'id',
  fields: {
    email: field.meta({
      unique: true,
      description: 'Login email.',
    }),
    displayName: field.computed(field.string(), ({ record }) => record.email),
  },
  seed: [],
});
`);

  const schema = await loadDbSchema({ from: cwd });
  const resource = schema.resource('users');
  const valid = schema.validator('users').assert({
    email: ' ADA@EXAMPLE.COM ',
    age: 37,
  });

  assert.equal(typeof resource.validators.standard['~standard'].validate, 'function');
  assert.equal(resource.fields.email.type, 'string');
  assert.equal(resource.fields.email.required, true);
  assert.equal(resource.fields.email.unique, true);
  assert.equal(resource.fields.email.description, 'Login email.');
  assert.equal(resource.fields.age.type, 'number');
  assert.equal(resource.fields.displayName.computed, true);
  assert.equal(resource.fields.displayName.readOnly, true);
  assert.deepEqual(valid, {
    email: 'ada@example.com',
    age: 37,
  });
  assert.equal('standardSchema' in schema.schema.resources.users, false);
  assert.equal('validators' in schema.schema.resources.users, false);
  assert.doesNotMatch(JSON.stringify(schema.schema.resources.users), /fixture-standard|validate|~standard/);
});

test('standard schema validators can be mixed into object-first async-db schemas', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.mjs', `
import { collection, field } from '@async/db/schema';

const UserSchema = {
  '~standard': {
    version: 1,
    vendor: 'object-first-fixture',
    validate(value) {
      if (!value || typeof value !== 'object' || typeof value.email !== 'string' || !value.email.includes('@')) {
        return { issues: [{ message: 'Email must include @', path: ['email'] }] };
      }
      return {
        value: {
          ...value,
          email: value.email.trim().toLowerCase(),
        },
      };
    },
  },
};

export default collection({
  idField: 'id',
  validator: UserSchema,
  fields: {
    email: field.string({
      required: true,
      unique: true,
      description: 'Login email.',
    }),
    displayName: field.computed(field.string(), ({ record }) => record.email),
  },
  seed: [],
});
`);

  const schema = await loadDbSchema({ from: cwd });
  const valid = schema.validator('users').assert({
    email: ' ADA@EXAMPLE.COM ',
  });

  assert.deepEqual(valid, {
    email: 'ada@example.com',
  });
  assert.equal(schema.resource('users').fields.email.type, 'string');
  assert.equal(schema.resource('users').fields.email.unique, true);
  assert.equal(schema.resource('users').fields.displayName.computed, true);
  assert.equal('validators' in schema.schema.resources.users, false);
});

test('standard schema validators expose async helpers and stable diagnostics', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.mjs', `
import { collection, field } from '@async/db/schema';

const AsyncUserSchema = {
  '~standard': {
    version: 1,
    vendor: 'async-fixture',
    async validate(value) {
      if (!value || typeof value !== 'object' || typeof value.email !== 'string' || !value.email.includes('@')) {
        return {
          issues: [
            {
              message: 'Email must be valid',
              path: [{ key: 'email' }],
            },
          ],
        };
      }
      return { value };
    },
  },
};

export default collection(AsyncUserSchema, {
  idField: 'id',
  fields: {
    email: field.meta({ type: 'string', required: true }),
  },
  seed: [],
});
`);

  const schema = await loadDbSchema({ from: cwd });
  const validator = schema.validator('users');
  const invalid = await validator.validateAsync({ email: 'not-an-email' });

  assert.throws(
    () => validator.validate({ email: 'ada@example.com' }),
    (error) => error.code === 'DB_SCHEMA_ASYNC_VALIDATOR_REQUIRED'
      && /validateAsync/.test(error.hint),
  );
  assert.equal(invalid.ok, false);
  assert.deepEqual(
    invalid.errors.map((diagnostic) => [
      diagnostic.code,
      diagnostic.field,
      diagnostic.details.vendor,
      diagnostic.details.path,
    ]),
    [
      ['STANDARD_SCHEMA_VALIDATION_FAILED', 'email', 'async-fixture', ['email']],
    ],
  );
  await assert.rejects(
    () => validator.assertAsync({ email: 'not-an-email' }),
    (error) => error.code === 'DB_SCHEMA_VALIDATION_FAILED'
      && error.details.diagnostics[0].code === 'STANDARD_SCHEMA_VALIDATION_FAILED',
  );
});

test('standard schema resources without metadata use conservative generated type fallback', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.schema.mjs', `
import { document } from '@async/db/schema';

const SettingsSchema = {
  '~standard': {
    version: 1,
    vendor: 'opaque-fixture',
    validate(value) {
      return value && typeof value === 'object'
        ? { value }
        : { issues: [{ message: 'Expected object' }] };
    },
  },
};

export default document(SettingsSchema);
`);

  const config = await loadConfig({ cwd });
  const project = await syncDb(config);
  await generateTypes(config, { project });
  const generatedTypes = await readFile(path.join(cwd, '.db/types/index.ts'), 'utf8');

  assert.match(generatedTypes, /export type Settings = \{\n  \[key: string\]: unknown;\n\};/);
  assert.equal(project.schema.resources.settings.fields, undefined);
  assert.match(
    project.diagnostics.map((diagnostic) => diagnostic.code).join('\n'),
    /STANDARD_SCHEMA_FIELDS_UNKNOWN/,
  );
});

test('standard schema async validators run through package REST and GraphQL collection writes with computed fields', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.mjs', `
import { collection, field } from '@async/db/schema';

const AsyncUserSchema = {
  '~standard': {
    version: 1,
    vendor: 'async-runtime-fixture',
    async validate(value) {
      await Promise.resolve();
      if (!value || typeof value !== 'object' || typeof value.email !== 'string' || !value.email.includes('@')) {
        return {
          issues: [
            {
              message: 'Email must be valid',
              path: ['email'],
            },
          ],
        };
      }
      return {
        value: {
          ...value,
          email: value.email.trim().toLowerCase(),
        },
      };
    },
    jsonSchema: {
      output() {
        return {
          type: 'object',
          required: ['email', 'firstName', 'lastName'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
          },
        };
      },
    },
  },
};

export default collection(AsyncUserSchema, {
  idField: 'id',
  fields: {
    displayName: field.computed(field.string(), {
      resolveMany({ records }) {
        return new Map(records.map((record) => [
          record.id,
          \`\${record.firstName} \${record.lastName}\`,
        ]));
      },
    }),
  },
  seed: [],
});
`);

  const db = await openDb({ cwd });

  const packageUser = await db.collection('users').create({
    id: 'u_1',
    email: ' ADA@EXAMPLE.COM ',
    firstName: 'Ada',
    lastName: 'Lovelace',
  });

  const rest = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('POST', {
      id: 'u_2',
      email: ' GRACE@EXAMPLE.COM ',
      firstName: 'Grace',
      lastName: 'Hopper',
    }),
    rest,
    new URL('http://db.local/users'),
  );

  const graphql = await executeGraphql(db, {
    query: `mutation {
      createUser(input: {
        id: "u_3",
        email: " KATHERINE@EXAMPLE.COM ",
        firstName: "Katherine",
        lastName: "Johnson"
      }) {
        id
        email
        displayName
      }
    }`,
  });

  const selectedRest = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('GET'),
    selectedRest,
    new URL('http://db.local/users?select=id,email,displayName'),
  );

  assert.equal(packageUser.email, 'ada@example.com');
  assert.equal(rest.status, 201);
  assert.equal(rest.json().email, 'grace@example.com');
  assert.deepEqual(graphql, {
    data: {
      createUser: {
        id: 'u_3',
        email: 'katherine@example.com',
        displayName: 'Katherine Johnson',
      },
    },
  });
  assert.deepEqual(selectedRest.json(), [
    {
      id: 'u_1',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    },
    {
      id: 'u_2',
      email: 'grace@example.com',
      displayName: 'Grace Hopper',
    },
    {
      id: 'u_3',
      email: 'katherine@example.com',
      displayName: 'Katherine Johnson',
    },
  ]);
});

test('standard schema async validators run through package REST and GraphQL document writes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.schema.mjs', `
import { document, field } from '@async/db/schema';

const AsyncSettingsSchema = {
  '~standard': {
    version: 1,
    vendor: 'async-document-fixture',
    async validate(value) {
      await Promise.resolve();
      if (!value || typeof value !== 'object' || typeof value.theme !== 'string') {
        return {
          issues: [
            {
              message: 'Theme must be a string',
              path: ['theme'],
            },
          ],
        };
      }
      return {
        value: {
          ...value,
          theme: value.theme.trim().toLowerCase(),
        },
      };
    },
    jsonSchema: {
      output() {
        return {
          type: 'object',
          required: ['theme'],
          properties: {
            theme: { type: 'string' },
          },
        };
      },
    },
  },
};

export default document(AsyncSettingsSchema, {
  fields: {
    label: field.computed(field.string(), ({ record }) => record.theme.toUpperCase()),
  },
  seed: {
    theme: 'light',
  },
});
`);

  const db = await openDb({ cwd });

  assert.deepEqual(await db.document('settings').update({ theme: ' DARK ' }), {
    theme: 'dark',
  });

  const rest = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('PATCH', {
      theme: ' BLUE ',
    }),
    rest,
    new URL('http://db.local/settings'),
  );

  const graphql = await executeGraphql(db, {
    query: `mutation {
      updateSettings(patch: { theme: " GREEN " }) {
        theme
        label
      }
    }`,
  });

  assert.equal(rest.status, 200);
  assert.deepEqual(rest.json(), {
    theme: 'blue',
  });
  assert.deepEqual(graphql, {
    data: {
      updateSettings: {
        theme: 'green',
        label: 'GREEN',
      },
    },
  });
});

function makeRequest(method, body, headers = {}) {
  return {
    method,
    headers,
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
