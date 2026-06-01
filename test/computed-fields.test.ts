import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { executeGraphql as typedExecuteGraphql, generateSchemaManifest as typedGenerateSchemaManifest, loadConfig as typedLoadConfig, loadDbSchema as typedLoadDbSchema, openDb as typedOpenDb, syncDb as typedSyncDb } from '../src/index.js';
import { handleRestRequest as typedHandleRestRequest } from '../src/rest/handler.js';
import { makeProject, writeFixture } from './helpers.js';

const loadConfig = async (options: unknown): Promise<any> => typedLoadConfig(options as never) as Promise<any>;
const syncDb = async (...args: any[]): Promise<any> => typedSyncDb(args[0] as never, args[1] as never) as Promise<any>;
const openDb = async (options: unknown): Promise<any> => typedOpenDb(options as never) as Promise<any>;
const loadDbSchema = async (options: unknown): Promise<any> => typedLoadDbSchema(options as never) as Promise<any>;
const executeGraphql = async (...args: any[]): Promise<any> => typedExecuteGraphql(args[0] as never, args[1] as never) as Promise<any>;
const generateSchemaManifest = (...args: any[]): any => typedGenerateSchemaManifest(args[0] as never, args[1] as never);
const handleRestRequest = async (...args: any[]): Promise<void> => typedHandleRestRequest(args[0], args[1], args[2], args[3]);

test('computed fields normalize as serializable metadata with generated types', async () => {
  const cwd = await makeProject();
  await writeComputedUsersSchema(cwd);

  const config = await loadConfig({ cwd });
  const project = await syncDb(config);
  const manifest = await generateSchemaManifest(config, { project });
  const resource = project.resources.find((candidate) => candidate.name === 'users');
  const generatedTypes = await readFile(path.join(cwd, '.db/types/index.d.ts'), 'utf8');

  assert.equal(resource.fields.fullName.type, 'string');
  assert.equal(resource.fields.fullName.computed, true);
  assert.equal(resource.fields.fullName.readOnly, true);
  assert.equal(typeof resource.resolvers.fields.fullName.resolveMany, 'function');
  assert.equal('resolve' in project.schema.resources.users.fields.fullName, false);
  assert.equal('resolveMany' in project.schema.resources.users.fields.fullName, false);
  assert.doesNotMatch(JSON.stringify(project.schema.resources.users.fields.fullName), /resolve/);
  assert.equal(manifest.manifest.collections.users.fields.fullName.computed, true);
  assert.equal(manifest.manifest.collections.users.fields.fullName.readOnly, true);
  assert.equal(manifest.manifest.collections.users.fields.fullName.ui.readonly, true);
  assert.doesNotMatch(JSON.stringify(manifest.manifest.collections.users.fields.fullName), /resolve/);
  assert.match(generatedTypes, /fullName\?: string;/);
});

test('REST and GraphQL resolve selected computed fields without changing default REST reads', async () => {
  const cwd = await makeProject();
  await writeComputedUsersSchema(cwd);
  const db = await openDb({ cwd });

  const defaultRest = makeResponse();
  const selectedRest = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    defaultRest,
    new URL('http://db.local/users'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET'),
    selectedRest,
    new URL('http://db.local/users?select=id,fullName'),
  );

  const graphql = await executeGraphql(db, {
    query: `{
      users {
        id
        fullName
      }
    }`,
  });

  assert.deepEqual(defaultRest.json(), [
    {
      id: 'u_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
  ]);
  assert.deepEqual(selectedRest.json(), [
    {
      id: 'u_1',
      fullName: 'Ada Lovelace',
    },
  ]);
  assert.deepEqual(graphql, {
    data: {
      users: [
        {
          id: 'u_1',
          fullName: 'Ada Lovelace',
        },
      ],
    },
  });
});

test('computed fields fall back to per-record resolve when resolveMany is not provided', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.mjs', `
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    firstName: field.string({ required: true }),
    lastName: field.string({ required: true }),
    initials: field.computed(field.string(), {
      resolve({ record }) {
        return \`\${record.firstName[0]}\${record.lastName[0]}\`;
      },
    }),
  },
  seed: [
    { id: 'u_1', firstName: 'Ada', lastName: 'Lovelace' },
    { id: 'u_2', firstName: 'Grace', lastName: 'Hopper' },
  ],
});
`);
  const db = await openDb({ cwd });

  const rest = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('GET'),
    rest,
    new URL('http://db.local/users?select=id,initials'),
  );
  const graphql = await executeGraphql(db, {
    query: `{
      users {
        id
        initials
      }
    }`,
  });

  assert.deepEqual(rest.json(), [
    { id: 'u_1', initials: 'AL' },
    { id: 'u_2', initials: 'GH' },
  ]);
  assert.deepEqual(graphql.data.users, [
    { id: 'u_1', initials: 'AL' },
    { id: 'u_2', initials: 'GH' },
  ]);
});

test('computed field shorthand binds runtime context as this for normal functions', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.mjs', `
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    firstName: field.string({ required: true }),
    contextName: field.computed(field.string(), function users_contextName_resolver() {
      return \`\${this.get('prefix') ?? this.get('resource').name}:\${this.value.firstName}\`;
    }),
  },
  seed: [
    { id: 'u_1', firstName: 'Ada' },
  ],
});
`);
  const db = await openDb({
    cwd,
    services: {
      prefix: 'service',
    },
  });

  const rest = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('GET'),
    rest,
    new URL('http://db.local/users?select=id,contextName'),
  );

  assert.deepEqual(rest.json(), [
    { id: 'u_1', contextName: 'service:Ada' },
  ]);
});

test('loaded schema exposes field resolver callables with delegated this context', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.mjs', `
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    firstName: field.string({ required: true }),
    lastName: field.string({ required: true }),
    displayName: field.computed(field.string(), function users_displayName_resolver({ record }) {
      const prefix = this.get('prefix') ?? 'user';
      return \`\${prefix}:\${this.value.firstName}:\${this._internal.value.lastName}:\${record.lastName}:\${this.get('resource').name}\`;
    }),
    initials: field.computed(field.string(), {
      resolveMany({ records }) {
        return new Map(records.map((record) => [
          record.id,
          \`\${record.firstName[0]}\${record.lastName[0]}\`,
        ]));
      },
    }),
  },
  seed: [],
});
`);

  const schema = await loadDbSchema({ from: cwd });
  const displayName = schema.resolver('users.displayName', {
    context: {
      prefix: 'ctx',
      value: {
        firstName: 'Override',
      },
    },
  });
  const value = await displayName({
    record: {
      id: 'u_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
  });

  assert.equal(value, 'ctx:Override:Lovelace:Lovelace:users');

  const userResolvers = schema.resolver('users');
  assert.equal(
    await userResolvers.displayName({
      record: {
        id: 'u_1',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    }),
    'user:Ada:Lovelace:Lovelace:users',
  );
  assert.equal(
    await userResolvers.initials({
      record: {
        id: 'u_2',
        firstName: 'Grace',
        lastName: 'Hopper',
      },
    }),
    'GH',
  );

  const many = await userResolvers.initials.resolveMany({
    records: [
      {
        id: 'u_3',
        firstName: 'Katherine',
        lastName: 'Johnson',
      },
    ],
  });
  assert.equal(many.get('u_3'), 'KJ');
});

test('write paths reject computed fields', async () => {
  const cwd = await makeProject();
  await writeComputedUsersSchema(cwd);
  const db = await openDb({ cwd });

  await assert.rejects(
    () => db.collection('users').create({
      id: 'u_2',
      firstName: 'Grace',
      lastName: 'Hopper',
      fullName: 'Wrong',
    }),
    (error: any) => error.code === 'DB_SCHEMA_VALIDATION_FAILED'
      && error.details.diagnostics.some((diagnostic) => diagnostic.code === 'FIELD_READ_ONLY'),
  );

  const rest = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('POST', {
      id: 'u_2',
      firstName: 'Grace',
      lastName: 'Hopper',
      fullName: 'Wrong',
    }),
    rest,
    new URL('http://db.local/users'),
  );

  const graphql = await executeGraphql(db, {
    query: `mutation {
      createUser(input: {
        id: "u_2",
        firstName: "Grace",
        lastName: "Hopper",
        fullName: "Wrong"
      }) {
        id
      }
    }`,
  });

  assert.equal(rest.status, 400);
  assert.equal(rest.json().error.code, 'DB_SCHEMA_VALIDATION_FAILED');
  assert.equal(rest.json().error.details.diagnostics[0].code, 'FIELD_READ_ONLY');
  assert.equal(graphql.errors[0].extensions.code, 'DB_SCHEMA_VALIDATION_FAILED');
  assert.equal(graphql.errors[0].extensions.details.diagnostics[0].code, 'FIELD_READ_ONLY');
});

async function writeComputedUsersSchema(cwd) {
  await writeFixture(cwd, 'users.schema.mjs', `
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    firstName: field.string({ required: true }),
    lastName: field.string({ required: true }),
    fullName: field.computed(field.string({
      description: 'Display name assembled from first and last name.',
    }), {
      resolveMany({ records }) {
        return new Map(records.map((record) => [
          record.id,
          \`\${record.firstName} \${record.lastName}\`,
        ]));
      },
    }),
  },
  seed: [
    {
      id: 'u_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
  ],
});
`);
}

function makeRequest(method: string, body: unknown = undefined, headers: Record<string, string> = {}) {
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
