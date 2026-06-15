import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  buildContractRefsManifest as typedBuildContractRefsManifest,
  checkContracts as typedCheckContracts,
  inferContractsFromTags as typedInferContractsFromTags,
  loadConfig as typedLoadConfig,
} from '../../src/index.js';
import { field } from '../../src/schema-builders.js';
import { makeProject, writeFixture } from '../helpers.js';

const loadConfig = async (options: unknown): Promise<any> => typedLoadConfig(options as never) as Promise<any>;
const buildContractRefsManifest = async (...args: any[]): Promise<any> => typedBuildContractRefsManifest(args[0] as never, args[1] as never) as Promise<any>;
const checkContracts = async (...args: any[]): Promise<any> => typedCheckContracts(args[0] as never) as Promise<any>;
const inferContractsFromTags = async (...args: any[]): Promise<any> => typedInferContractsFromTags(args[0] as never, args[1] as never) as Promise<any>;

test('field builder tags are non-enumerable helpers that persist as schema tags', () => {
  const tagged = field.string().tag('public').tag('internal');

  assert.deepEqual(tagged.tags, ['public', 'internal']);
  assert.equal(Object.keys(tagged).includes('tag'), false);
});

test('contracts infer from schema field tags', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "fields": {
      "id": { "type": "string", "tags": ["public"] },
      "name": { "type": "string", "visibility": "public" },
      "email": { "type": "string", "tags": ["internal"] }
    },
    "seed": []
  }`);
  const config = await loadConfig({ cwd });
  const inferred = await inferContractsFromTags(config, {
    generatedAt: '2026-06-04T00:00:00.000Z',
  });

  assert.deepEqual(inferred.contracts.public.resources.users, {
    fields: ['id', 'name'],
    read: true,
    write: false,
  });
  assert.deepEqual(inferred.contracts.internal.resources.users.fields, ['email']);
});

test('contract refs manifest scopes operations by configured contract', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/operations'), { recursive: true });
  await writeFile(path.join(cwd, 'db/operations/get-user.jsonc'), `{
    "name": "GetUser",
    "ref": "users.get",
    "method": "GET",
    "path": "/users/{id}.json",
    "query": { "select": "id,name" }
  }`, 'utf8');
  const config = await loadConfig({
    cwd,
    contracts: {
      public: {
        resources: {
          users: {
            fields: ['id', 'name'],
            read: true,
            write: false,
          },
        },
        operations: ['GetUser'],
      },
    },
  });

  const result = await buildContractRefsManifest(config, {
    generatedAt: '2026-06-04T00:00:00.000Z',
    write: false,
  });

  assert.deepEqual(result.manifest.contracts.public.operations.GetUser, {
    name: 'GetUser',
    ref: 'users.get',
  });
  assert.deepEqual(result.outFiles, []);
});

test('contracts check validates operation resources and selected fields', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada',
      email: 'ada@example.com',
    },
  ]));
  const config = await loadConfig({
    cwd,
    contracts: {
      public: {
        resources: {
          users: {
            fields: ['id', 'name'],
            read: true,
            write: false,
          },
        },
        operations: ['GetUser'],
      },
    },
    operations: {
      registry: {
        'users.get': {
          name: 'GetUser',
          ref: 'users.get',
          method: 'GET',
          path: '/users/{id}.json',
          query: {
            select: 'id,email',
          },
        },
      },
    },
  });

  const result = await checkContracts(config);

  assert.equal(result.ok, false);
  assert.equal(result.findings.some((finding) => finding.code === 'CONTRACT_OPERATION_FIELD_NOT_ALLOWED' && finding.field === 'email'), true);
});
