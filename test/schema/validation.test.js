import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { syncDb, loadConfig, loadProjectSchema } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

test('schema validation reports missing required relation targets', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'authors.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": []
  }`);
  await writeFixture(cwd, 'posts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "authorId": {
        "type": "string",
        "required": true,
        "relation": {
          "name": "author",
          "to": "authors",
          "toField": "id",
          "cardinality": "one"
        }
      }
    },
    "seed": [
      { "id": "p_1", "authorId": "missing_author" }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const relationDiagnostics = project.diagnostics.filter((diagnostic) => diagnostic.code === 'SCHEMA_RELATION_TARGET_MISSING');

  assert.equal(relationDiagnostics.length, 1);
  assert.equal(relationDiagnostics[0].severity, 'error');
  assert.equal(relationDiagnostics[0].resource, 'posts');
  assert.equal(relationDiagnostics[0].field, 'authorId');
  assert.match(relationDiagnostics[0].message, /missing_author/);
});

test('schema validation resolves relation targets through resource aliases', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'chart-mappings.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "cash" }
    ]
  }`);
  await writeFixture(cwd, 'pages.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "chartMappingId": {
        "type": "string",
        "required": true,
        "relation": {
          "name": "chartMapping",
          "to": "chart-mappings",
          "toField": "id",
          "cardinality": "one"
        }
      }
    },
    "seed": [
      { "id": "home", "chartMappingId": "cash" }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);

  assert.deepEqual(project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  assert.equal(project.schema.resources.chartMappings.kind, 'collection');
});

test('explicit schema variants validate records by discriminator value', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "blocks": {
        "type": "array",
        "items": {
          "type": "object",
          "discriminator": "type",
          "variants": {
            "chart": {
              "fields": {
                "type": {
                  "type": "enum",
                  "values": ["chart"],
                  "required": true
                },
                "chartId": {
                  "type": "string",
                  "required": true
                }
              }
            },
            "metric": {
              "fields": {
                "type": {
                  "type": "enum",
                  "values": ["metric"],
                  "required": true
                },
                "title": {
                  "type": "string",
                  "required": true
                },
                "source": {
                  "type": "string",
                  "required": true
                },
                "aggregate": {
                  "type": "string",
                  "required": true
                }
              }
            }
          }
        }
      }
    },
    "seed": [
      {
        "id": "broken",
        "blocks": [
          {
            "type": "metric",
            "title": "Revenue"
          }
        ]
      }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const variantDiagnostics = project.diagnostics.filter((diagnostic) => (
    diagnostic.code === 'SCHEMA_REQUIRED_FIELD_MISSING'
  ));

  assert.equal(variantDiagnostics.length, 2);
  assert.deepEqual(variantDiagnostics.map((diagnostic) => diagnostic.field), [
    'blocks[0].source',
    'blocks[0].aggregate',
  ]);
});

test('schema validation reports relation metadata on non-scalar source fields', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'authors.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true }
    },
    "seed": []
  }`);
  await writeFixture(cwd, 'posts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "authorIds": {
        "type": "array",
        "items": { "type": "string" },
        "relation": {
          "name": "authors",
          "to": "authors",
          "toField": "id",
          "cardinality": "one"
        }
      }
    },
    "seed": [
      { "id": "p_1", "authorIds": ["a_1"] }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const relationDiagnostics = project.diagnostics.filter((diagnostic) => diagnostic.code === 'SCHEMA_RELATION_SOURCE_FIELD_INVALID');

  assert.equal(relationDiagnostics.length, 1);
  assert.equal(relationDiagnostics[0].severity, 'error');
  assert.equal(relationDiagnostics[0].resource, 'posts');
  assert.equal(relationDiagnostics[0].field, 'authorIds');
  assert.match(relationDiagnostics[0].message, /posts relation "authors" source field "authorIds" must be a scalar field/);
  assert.match(relationDiagnostics[0].hint, /Use a scalar id field/);
  assert.deepEqual(relationDiagnostics[0].details, {
    relation: {
      name: 'authors',
      sourceResource: 'posts',
      sourceField: 'authorIds',
      targetResource: 'authors',
      targetField: 'id',
      cardinality: 'one',
    },
    sourceFieldType: 'array',
  });
});

test('strict unknown fields fail sync in mixed mode', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schema: {
      unknownFields: 'error'
    }
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada', twitterHandle: '@ada' }]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    }
  }`);

  const config = await loadConfig({ cwd });

  await assert.rejects(
    () => syncDb(config),
    /twitterHandle/,
  );
});

test('schema-backed CSV arrays stay arrays in runtime state', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'charts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "tags": {
        "type": "array",
        "items": { "type": "string" }
      }
    }
  }`);
  await writeFixture(cwd, 'charts.csv', 'id,tags\nchart_1,renewal;priority\nchart_2,"[""growth"",""upsell""]"');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);
  const state = JSON.parse(await readFile(path.join(cwd, '.db/state/charts.json'), 'utf8'));

  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  assert.deepEqual(state, [
    {
      id: 'chart_1',
      tags: ['renewal', 'priority'],
    },
    {
      id: 'chart_2',
      tags: ['growth', 'upsell'],
    },
  ]);
});

test('schema seed records are validated without a separate data file', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "u_1" }
    ]
  }`);

  const config = await loadConfig({ cwd });

  await assert.rejects(
    () => syncDb(config),
    /missing required field "email"/,
  );
});

test('schema validation rejects declared field type mismatches', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": { "type": "enum", "values": ["admin", "user"] },
      "profile": {
        "type": "object",
        "fields": {
          "age": { "type": "number" },
          "flags": {
            "type": "array",
            "items": { "type": "boolean" }
          }
        }
      }
    },
    "seed": [
      {
        "id": 1,
        "email": 42,
        "role": "owner",
        "profile": {
          "age": "old",
          "flags": ["yes"]
        }
      }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);

  assert.deepEqual(
    project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.code),
    [
      'SCHEMA_FIELD_TYPE_MISMATCH',
      'SCHEMA_FIELD_TYPE_MISMATCH',
      'SCHEMA_ENUM_VALUE_INVALID',
      'SCHEMA_FIELD_TYPE_MISMATCH',
      'SCHEMA_FIELD_TYPE_MISMATCH',
    ],
  );
  assert.match(project.diagnostics.map((diagnostic) => diagnostic.message).join('\n'), /profile\.flags\[0\]/);
  await assert.rejects(() => syncDb(config), /expected string/);
});

test('schema field constraints validate seed records and schema metadata', async () => {
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
      "displayName": {
        "type": "string",
        "minLength": 2,
        "maxLength": 20
      },
      "score": {
        "type": "number",
        "min": 0,
        "max": 100
      },
      "tags": {
        "type": "array",
        "minLength": 1,
        "maxLength": 2,
        "items": { "type": "string" }
      }
    },
    "seed": [
      {
        "id": "u_1",
        "email": "bad-email",
        "displayName": "A",
        "score": -1,
        "tags": []
      },
      {
        "id": "u_2",
        "email": "ada@example.com",
        "displayName": "Ada Lovelace With A Very Long Name",
        "score": 101,
        "tags": ["one", "two", "three"]
      },
      {
        "id": "u_3",
        "email": "ada@example.com",
        "displayName": "Ada",
        "score": 50,
        "tags": ["one"]
      }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

  assert.equal(project.schema.resources.users.fields.email.unique, true);
  assert.equal(project.schema.resources.users.fields.email.pattern, '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$');
  assert.equal(project.schema.resources.users.fields.score.min, 0);
  assert.equal(project.schema.resources.users.fields.tags.maxLength, 2);
  assert.deepEqual(
    errors.map((diagnostic) => [diagnostic.code, diagnostic.field, diagnostic.details?.constraint]),
    [
      ['SCHEMA_FIELD_CONSTRAINT_VIOLATION', 'email', 'pattern'],
      ['SCHEMA_FIELD_CONSTRAINT_VIOLATION', 'displayName', 'minLength'],
      ['SCHEMA_FIELD_CONSTRAINT_VIOLATION', 'score', 'min'],
      ['SCHEMA_FIELD_CONSTRAINT_VIOLATION', 'tags', 'minLength'],
      ['SCHEMA_FIELD_CONSTRAINT_VIOLATION', 'displayName', 'maxLength'],
      ['SCHEMA_FIELD_CONSTRAINT_VIOLATION', 'score', 'max'],
      ['SCHEMA_FIELD_CONSTRAINT_VIOLATION', 'tags', 'maxLength'],
      ['SCHEMA_UNIQUE_VALUE_DUPLICATE', 'email', 'unique'],
    ],
  );
  assert.match(errors[0].message, /email/);
  assert.match(errors[0].hint, /pattern/);
  await assert.rejects(() => syncDb(config), /violates pattern/);
});
