import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { syncDb as typedSyncDb, loadConfig as typedLoadConfig, loadProjectSchema as typedLoadProjectSchema, generateTypes as typedGenerateTypes, openDb as typedOpenDb, resolveSchemaLocator } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

const loadConfig = async (options: unknown): Promise<any> => typedLoadConfig(options as never) as Promise<any>;
const syncDb = async (...args: any[]): Promise<any> => typedSyncDb(args[0] as never, args[1] as never) as Promise<any>;
const loadProjectSchema = async (...args: any[]): Promise<any> => typedLoadProjectSchema(args[0] as never, args[1] as never) as Promise<any>;
const generateTypes = async (...args: any[]): Promise<any> => typedGenerateTypes(args[0] as never, args[1] as never) as Promise<any>;
const openDb = async (options: unknown): Promise<any> => typedOpenDb(options as never) as Promise<any>;

test('schema-only fixtures generate types and initialize empty state', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'auditEvents.schema.jsonc', `{
    // Audit events generated during local development.
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "type": { "type": "string", "required": true },
      "payload": { "type": "object", "default": {} }
    },
    "seed": []
  }`);

  const config = await loadConfig({ cwd });
  await syncDb(config);
  const generated = await readFile(path.join(cwd, '.db/types/index.d.ts'), 'utf8');

  assert.match(generated, /export type AuditEvent =/);
  assert.match(generated, /payload\?: Record<string, unknown>;/);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/auditEvents.json'), 'utf8')), []);
});

test('schema fields support nullable datetime arrays and flexible object shapes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'charts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "ownerPersonId": { "type": "string", "nullable": true },
      "lastViewedAt": { "type": "datetime" },
      "tags": {
        "type": "array",
        "items": { "type": "string" }
      },
      "schemaSnapshot": {
        "type": "object",
        "additionalProperties": true,
        "fields": {
          "version": { "type": "number" }
        }
      }
    },
    "seed": [
      {
        "id": "chart_1",
        "ownerPersonId": null,
        "lastViewedAt": "2026-05-11T12:00:00.000Z",
        "tags": ["renewal", "priority"],
        "schemaSnapshot": {
          "version": 1,
          "displayOverrides": { "color": "green" }
        }
      }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);
  const generated = await readFile(path.join(cwd, '.db/types/index.d.ts'), 'utf8');
  const state = JSON.parse(await readFile(path.join(cwd, '.db/state/charts.json'), 'utf8'));

  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  assert.match(generated, /ownerPersonId\?: string \| null;/);
  assert.match(generated, /lastViewedAt\?: string;/);
  assert.match(generated, /tags\?: Array<string>;/);
  assert.match(generated, /schemaSnapshot\?: \{/);
  assert.match(generated, /version\?: number;/);
  assert.match(generated, /\[key: string\]: unknown;/);
  assert.deepEqual(state[0].tags, ['renewal', 'priority']);
});

test('data-first arrays infer discriminated object variants and TypeScript unions', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    {
      id: 'home',
      blocks: [
        {
          type: 'chart',
          chartId: 'chart_1',
        },
        {
          type: 'metric',
          title: 'Revenue',
          source: 'orders',
          aggregate: 'sum',
        },
      ],
    },
  ]));

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const generated = (await generateTypes(config, { project })).content;
  const blocks = project.schema.resources.pages.fields.blocks;

  assert.equal(blocks.items.discriminator, 'type');
  assert.deepEqual(Object.keys(blocks.items.variants), ['chart', 'metric']);
  assert.equal(blocks.items.variants.chart.fields.type.values[0], 'chart');
  assert.equal(blocks.items.variants.chart.fields.chartId.required, true);
  assert.equal(blocks.items.variants.metric.fields.title.required, true);
  assert.match(generated, /export type PageBlocksItem =\n  \| \{/);
  assert.match(generated, /type: "chart";/);
  assert.match(generated, /chartId: string;/);
  assert.match(generated, /type: "metric";/);
  assert.match(generated, /aggregate: string;/);
  assert.match(generated, /blocks: Array<PageBlocksItem>;/);
});

test('data-first polymorphic arrays without a stable discriminator use normal object inference', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([
    {
      id: 'home',
      blocks: [
        {
          chartId: 'chart_1',
        },
        {
          title: 'Revenue',
          source: 'orders',
        },
      ],
    },
  ]));

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const blocks = project.schema.resources.pages.fields.blocks;

  assert.equal(blocks.items.discriminator, undefined);
  assert.equal(blocks.items.variants, undefined);
  assert.equal(blocks.items.fields.chartId.required, false);
  assert.equal(blocks.items.fields.title.required, false);
});

test('nested enum aliases use deterministic full field paths', async () => {
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
          "fields": {
            "type": {
              "type": "enum",
              "values": ["chart", "metric"],
              "required": true
            }
          }
        }
      }
    },
    "seed": []
  }`);

  const config = await loadConfig({ cwd });
  const generated = (await generateTypes(config)).content;

  assert.match(generated, /export type PageBlocksItemType = "chart" \| "metric";/);
  assert.match(generated, /type: PageBlocksItemType;/);
  assert.doesNotMatch(generated, /type: PageType;/);
});

test('schema fields can declare to-one relation metadata', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'authors.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "a_1", "name": "Ada Lovelace" }
    ]
  }`);
  await writeFixture(cwd, 'posts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "title": { "type": "string", "required": true },
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
      { "id": "p_1", "title": "Intro", "authorId": "a_1" }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  assert.deepEqual(result.schema.resources.posts.relations, [
    {
      name: 'author',
      sourceResource: 'posts',
      sourceField: 'authorId',
      targetResource: 'authors',
      targetField: 'id',
      cardinality: 'one',
    },
  ]);
  assert.deepEqual(result.schema.relations, result.schema.resources.posts.relations);
  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
});

test('.schema.mjs helpers expose nullable datetime and flexible objects', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'charts.schema.mjs', `
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    ownerPersonId: field.nullable(field.string()),
    lastViewedAt: field.datetime(),
    schemaSnapshot: field.object({
      version: field.number(),
    }, { additionalProperties: true }),
  },
  seed: [
    {
      id: 'chart_1',
      ownerPersonId: null,
      lastViewedAt: '2026-05-11T12:00:00.000Z',
      schemaSnapshot: {
        version: 1,
        displayOverrides: { color: 'green' },
      },
    },
  ],
});
`);

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);
  const generated = await readFile(path.join(cwd, '.db/types/index.d.ts'), 'utf8');

  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  assert.match(generated, /ownerPersonId\?: string \| null;/);
  assert.match(generated, /lastViewedAt\?: string;/);
  assert.match(generated, /\[key: string\]: unknown;/);
});

test('.schema.js helpers load in projects with package type module', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8');
  await writeFixture(cwd, 'charts.schema.js', `
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
  },
  seed: [{ id: 'chart_1', title: 'Revenue' }],
});
`);

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  assert.equal(result.schema.resources.charts.kind, 'collection');
  await assert.rejects(() => readFile(path.join(cwd, 'db/package.json'), 'utf8'), /ENOENT/);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/charts.json'), 'utf8')), [
    { id: 'chart_1', title: 'Revenue' },
  ]);
});

test('.schema.js creates a db package module marker when the project root is not ESM', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'charts.schema.js', `
import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
  },
  seed: [{ id: 'chart_1', title: 'Revenue' }],
});
`);

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);
  const packageJson = JSON.parse(await readFile(path.join(cwd, 'db/package.json'), 'utf8'));

  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  assert.deepEqual(packageJson, { type: 'module' });
  assert.equal(result.schema.resources.charts.kind, 'collection');
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/charts.json'), 'utf8')), [
    { id: 'chart_1', title: 'Revenue' },
  ]);
});

test('.schema.js auto module marker can be disabled by config', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schema: {
      autoModulePackageJson: false,
    },
  };`);
  await writeFixture(cwd, 'charts.schema.js', `
import { collection, field } from '@async/db/schema';

export default collection({
  fields: {
    id: field.string({ required: true }),
  },
});
`);

  const config = await loadConfig({ cwd });
  const result = await syncDb(config, { allowErrors: true });
  const diagnostic = result.diagnostics.find((item) => item.file === 'db/charts.schema.js');

  assert.equal(diagnostic?.code, 'SOURCE_LOAD_FAILED');
  assert.match(diagnostic.message, /Could not load db\/charts\.schema\.js/);
  assert.match(diagnostic.hint, /"type": "module"/);
  assert.match(diagnostic.hint, /autoModulePackageJson/);
  await assert.rejects(() => readFile(path.join(cwd, 'db/package.json'), 'utf8'), /ENOENT/);
});

test('root db.schema.mjs loads as the authoritative schema registry', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'db.schema.mjs'), `
import { collection, field } from '@async/db/schema';

export default {
  users: collection({
    idField: 'id',
    fields: {
      id: field.string({ required: true }),
      name: field.string({ required: true }),
    },
  }),
};
`);
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada', email: 'ada@example.com' }]));
  await writeFixture(cwd, 'users.schema.json', JSON.stringify({
    kind: 'collection',
    fields: {
      id: { type: 'string', required: true },
      email: { type: 'string', required: true },
    },
  }));

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const users = project.resources.find((resource) => resource.name === 'users');

  assert.deepEqual(Object.keys(users.fields), ['id', 'name']);
  assert.equal(users.schemaPath, path.join(cwd, 'db.schema.mjs'));
  assert.equal(project.diagnostics.some((diagnostic) => diagnostic.code === 'SCHEMA_UNKNOWN_FIELD'), true);
});

test('root db.schema.js loads as the authoritative schema registry in module projects', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(cwd, 'db.schema.js'), `
import { collection, field } from '@async/db/schema';

export default {
  users: collection({
    idField: 'id',
    fields: {
      id: field.string({ required: true }),
      name: field.string({ required: true }),
    },
  }),
};
`);
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada', email: 'ada@example.com' }]));

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const users = project.resources.find((resource) => resource.name === 'users');

  assert.equal(users.schemaPath, path.join(cwd, 'db.schema.js'));
  assert.deepEqual(Object.keys(users.fields), ['id', 'name']);
  assert.equal(project.diagnostics.some((diagnostic) => diagnostic.code === 'SCHEMA_UNKNOWN_FIELD'), true);
});

test('root db.schema.js without a module root package keeps a helpful diagnostic', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'db.schema.js'), `
import { collection, field } from '@async/db/schema';

export default {
  users: collection({
    fields: {
      id: field.string({ required: true }),
    },
  }),
};
`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const diagnostic = project.diagnostics.find((item) => item.file === 'db.schema.js');

  assert.equal(diagnostic?.code, 'SOURCE_LOAD_FAILED');
  assert.match(diagnostic.message, /Could not load db\.schema\.js/);
  assert.match(diagnostic.hint, /"type": "module"/);
  await assert.rejects(() => readFile(path.join(cwd, 'db/package.json'), 'utf8'), /ENOENT/);
});

test('root db.schema.mjs wins over db.schema.js with a warning', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(cwd, 'db.schema.mjs'), `
import { collection, field } from '@async/db/schema';

export default {
  users: collection({
    fields: {
      id: field.string({ required: true }),
      name: field.string({ required: true }),
    },
  }),
};
`);
  await writeFile(path.join(cwd, 'db.schema.js'), `
import { collection, field } from '@async/db/schema';

export default {
  users: collection({
    fields: {
      id: field.string({ required: true }),
      email: field.string({ required: true }),
    },
  }),
};
`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const users = project.resources.find((resource) => resource.name === 'users');
  const duplicate = project.diagnostics.find((diagnostic) => diagnostic.code === 'ROOT_SCHEMA_DUPLICATE_IGNORED');

  assert.equal(users.schemaPath, path.join(cwd, 'db.schema.mjs'));
  assert.deepEqual(Object.keys(users.fields), ['id', 'name']);
  assert.equal(duplicate?.severity, 'warn');
  assert.match(duplicate.message, /db\.schema\.mjs/);
  assert.match(duplicate.message, /db\.schema\.js/);
});

test('schema locators resolve projects, db folders, root schemas, and schema files', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeFile(path.join(cwd, 'db.schema.mjs'), 'export default {};');
  await writeFixture(cwd, 'users.schema.json', JSON.stringify({ fields: {} }));
  await writeFile(path.join(cwd, 'db/docs/index.schema.mjs'), 'export default { fields: {} };');

  const project = await resolveSchemaLocator({ cwd, from: '.' });
  assert.equal(project.mode, 'project');
  assert.equal(project.cwd, cwd);
  assert.equal(project.sourceDir, path.join(cwd, 'db'));

  const dbFolder = await resolveSchemaLocator({ cwd, from: './db' });
  assert.equal(dbFolder.mode, 'source-dir');
  assert.equal(dbFolder.cwd, cwd);
  assert.equal(dbFolder.sourceDir, path.join(cwd, 'db'));

  const root = await resolveSchemaLocator({ cwd, from: './db.schema.mjs' });
  assert.equal(root.mode, 'root-schema');
  assert.equal(root.file, path.join(cwd, 'db.schema.mjs'));

  const users = await resolveSchemaLocator({ cwd, from: './db/users.schema.json' });
  assert.equal(users.mode, 'schema-file');
  assert.equal(users.resourceName, 'users');
  assert.equal(users.sourceDir, path.join(cwd, 'db'));

  const docs = await resolveSchemaLocator({ cwd, from: './db/docs/index.schema.mjs' });
  assert.equal(docs.mode, 'schema-file');
  assert.equal(docs.resourceName, 'docs');
  assert.equal(docs.sourceDir, path.join(cwd, 'db'));
});

test('schema load mode skips seed files and content source readers', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada', extra: true }]));
  await writeFixture(cwd, 'users.schema.mjs', `
import { collection, field } from '@async/db/schema';

export default collection({
  fields: {
    id: field.string({ required: true }),
    name: field.string({ required: true }),
  },
  seed: [{ id: 'seeded', name: 'Seeded' }],
});
`);
  await writeFile(path.join(cwd, 'db/docs/index.schema.mjs'), `
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'json' }),
  fields: {
    id: field.string({ required: true }),
    body: field.string(),
  },
});
`);
  await writeFile(path.join(cwd, 'db/docs/broken.mdx'), 'not json');

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config, { load: 'schema' });
  const users = project.resources.find((resource) => resource.name === 'users');

  assert.equal(project.loadMode, 'schema');
  assert.deepEqual(project.resources.map((resource) => resource.name), ['docs', 'users']);
  assert.deepEqual(users.seed, []);
  assert.equal(project.diagnostics.some((diagnostic) => diagnostic.code === 'SCHEMA_UNKNOWN_FIELD'), false);
  assert.equal(project.diagnostics.some((diagnostic) => diagnostic.code === 'CONTENT_SOURCE_LOAD_FAILED'), false);
});

test('single schema file locator limits resources and loads sibling seed in data mode', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.json', JSON.stringify({
    kind: 'collection',
    fields: {
      id: { type: 'string', required: true },
      name: { type: 'string', required: true },
    },
  }));
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeFixture(cwd, 'posts.json', JSON.stringify([{ id: 'p_1', title: 'Ignored' }]));

  const config = await loadConfig({ cwd, from: './db/users.schema.json' });
  const schemaOnly = await loadProjectSchema(config, { load: 'schema' });
  const withData = await loadProjectSchema(config, { load: 'data' });

  assert.equal(config.schemaLocator.mode, 'schema-file');
  assert.deepEqual(schemaOnly.resources.map((resource) => resource.name), ['users']);
  assert.deepEqual(schemaOnly.resources[0].seed, []);
  assert.deepEqual(withData.resources.map((resource) => resource.name), ['users']);
  assert.deepEqual(withData.resources[0].seed, [{ id: 'u_1', name: 'Ada' }]);
});

test('folder index.schema.mjs creates a static collection from frontmatter mdx files', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeConfig(cwd, `export default {
    resources: {
      docs: {
        store: 'static'
      }
    }
  };`);
  await writeFile(path.join(cwd, 'db/docs/index.schema.mjs'), `
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'frontmatter' }),
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true }),
  },
});
`);
  await writeFile(path.join(cwd, 'db/docs/intro.mdx'), `---
title: Intro
---
# Hello
`, 'utf8');

  const db = await openDb({ cwd });

  assert.deepEqual(await db.collection('docs').all(), [
    {
      id: 'intro',
      title: 'Intro',
      body: '# Hello',
    },
  ]);
  await assert.rejects(
    () => db.collection('docs').create({ id: 'next', title: 'Next', body: 'Body' }),
    (error: any) => error.code === 'STORE_RESOURCE_READ_ONLY',
  );
});

test('folder index.schema.js creates a static collection with a db package module marker', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeConfig(cwd, `export default {
    resources: {
      docs: {
        store: 'static'
      }
    }
  };`);
  await writeFile(path.join(cwd, 'db/docs/index.schema.js'), `
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'frontmatter' }),
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true }),
  },
});
`);
  await writeFile(path.join(cwd, 'db/docs/intro.mdx'), `---
title: Intro
---
# Intro
`);

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  assert.equal(result.schema.resources.docs.kind, 'collection');
  assert.equal(result.resources.find((resource) => resource.name === 'docs').schemaPath, path.join(cwd, 'db/docs/index.schema.js'));
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'db/package.json'), 'utf8')), { type: 'module' });

  const db = await openDb({ cwd });
  assert.deepEqual(await db.collection('docs').all(), [
    {
      id: 'intro',
      title: 'Intro',
      body: '# Intro',
    },
  ]);
});

test('folder index.schema.mjs requires an explicit source glob', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeFile(path.join(cwd, 'db/docs/index.schema.mjs'), `
import { collection, field } from '@async/db/schema';

export default collection({
  fields: {
    id: field.string({ required: true }),
  },
});
`);

  const project = await loadProjectSchema(await loadConfig({ cwd }));
  const diagnostic = project.diagnostics.find((entry) => entry.code === 'SCHEMA_UNBUNDLE_FOLDER_SOURCE_REQUIRED');

  assert.equal(diagnostic.severity, 'error');
  assert.equal(diagnostic.resource, 'docs');
  assert.equal(diagnostic.file, 'db/docs/index.schema.mjs');
  assert.match(diagnostic.hint, /source: files\('\.\/\*\*\/\*\.mdx', \{ read: 'frontmatter' \}\)/);
});

test('schema-only fixtures can generate synthetic seed records', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    seed: {
      generateFromSchema: true,
      generatedCount: 3,
    },
  };`);
  await writeFixture(cwd, 'users.schema.json', JSON.stringify({
    kind: 'collection',
    idField: 'id',
    fields: {
      id: { type: 'string', required: true },
      name: { type: 'string', required: true },
      role: { type: 'enum', values: ['admin', 'user'] },
      active: { type: 'boolean' },
    },
    seed: [],
  }));

  const config = await loadConfig({ cwd });
  await syncDb(config);
  const state = JSON.parse(await readFile(path.join(cwd, '.db/state/users.json'), 'utf8'));

  assert.equal(state.length, 3);
  assert.equal(state[0].id, '1');
  assert.equal(state[0].name, 'name_1');
  assert.equal(state[0].role, 'admin');
  assert.equal(state[1].role, 'user');
});

test('.schema.json files load as schema sources', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.json', JSON.stringify({
    kind: 'collection',
    idField: 'id',
    fields: {
      id: { type: 'string', required: true },
      name: { type: 'string', required: true },
    },
    seed: [],
  }));

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const users = project.resources.find((resource) => resource.name === 'users');

  assert.equal(project.schema.resources.users.kind, 'collection');
  assert.equal(users.schemaSource, 'json');
  assert.match(users.schemaPath, /users\.schema\.json$/);
});

test('mixed mode treats schema as authoritative and warns for unknown data fields', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
      twitterHandle: '@ada',
    },
  ]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    }
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);

  assert.equal(project.diagnostics.length, 1);
  assert.equal(project.diagnostics[0].severity, 'warn');
  assert.match(project.diagnostics[0].message, /twitterHandle/);
});

test('.schema.mjs files can use schema helpers', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.mjs', `import { collection, field } from '@async/db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true, description: 'Stable user id.' }),
    role: field.enum(['admin', 'user'], { default: 'user' })
  },
  seed: [{ id: 'u_1', role: 'admin' }]
});
`);

  const config = await loadConfig({ cwd });
  const result = await generateTypes(config);

  assert.match(result.content, /\/\*\* Stable user id\. \*\//);
  assert.match(result.content, /export type UserRole = "admin" \| "user";/);
});

test('JSONC data-first fixtures can be inferred', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.jsonc', `{
    // Local app settings.
    "theme": "light",
    "features": {
      "billing": false,
    },
  }`);

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);
  const generated = await readFile(path.join(cwd, '.db/types/index.d.ts'), 'utf8');

  assert.equal(result.schema.resources.settings.kind, 'document');
  assert.match(generated, /export type Settings =/);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/settings.json'), 'utf8')), {
    theme: 'light',
    features: {
      billing: false,
    },
  });
});

test('source load errors report the file and keep other resources available when allowed', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeFixture(cwd, 'broken.json', '{"id": ');

  const config = await loadConfig({ cwd });
  const project = await syncDb(config, { allowErrors: true });

  assert.deepEqual(Object.keys(project.schema.resources), ['users']);
  assert.equal(project.diagnostics[0].code, 'SOURCE_LOAD_FAILED');
  assert.equal(project.diagnostics[0].file, 'db/broken.json');
  assert.match(project.diagnostics[0].message, /Could not load db\/broken\.json/);
  assert.match(await readFile(path.join(cwd, '.db/schema.generated.json'), 'utf8'), /SOURCE_LOAD_FAILED/);
});

test('source discovery ignores dot folders inside db', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await mkdir(path.join(cwd, 'db/.db/state'), { recursive: true });
  await writeFile(path.join(cwd, 'db/.db/state/internal.json'), `${JSON.stringify([{ id: 'leak' }])}\n`, 'utf8');
  await mkdir(path.join(cwd, 'db/.cache'), { recursive: true });
  await writeFile(path.join(cwd, 'db/.cache/hidden.json'), `${JSON.stringify([{ id: 'hidden' }])}\n`, 'utf8');

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);

  assert.deepEqual(project.resources.map((resource) => resource.name), ['users']);
});

test('custom source readers can load data files with source context helpers', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sources: {
      readers: [
        {
          name: 'pipe-data',
          match({ file }) {
            return file.endsWith('.pipe');
          },
          async read({ file, sourceFile, filename, extension, config, hash, readText, readBuffer }) {
            if (file !== 'db/users.pipe' || filename !== 'users.pipe' || extension !== '.pipe') {
              throw new Error('unexpected source context');
            }
            if (!sourceFile.endsWith('/db/users.pipe') || !config.cwd) {
              throw new Error('missing absolute source context');
            }
            const text = await readText();
            const buffer = await readBuffer();
            if (buffer.length !== Buffer.byteLength(text) || !/^[a-f0-9]{64}$/.test(hash)) {
              throw new Error('missing source helpers');
            }
            return {
              kind: 'data',
              resourceName: 'users',
              format: 'pipe',
              data: text.trim().split('\\n').map((line) => {
                const [id, name] = line.split('|');
                return { id, name };
              }),
            };
          },
        },
      ],
    },
  };`);
  await writeFixture(cwd, 'users.pipe', 'u_1|Ada Lovelace');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  assert.equal(result.schema.resources.users.kind, 'collection');
  assert.equal(result.schema.resources.users.fields.name.type, 'string');
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]);
  const metadata = JSON.parse(await readFile(path.join(cwd, '.db/state/.sources.json'), 'utf8'));
  assert.equal(metadata.resources.users.format, 'pipe');
  assert.equal(metadata.resources.users.path, 'db/users.pipe');
});

test('custom source readers can load schema sources', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sources: {
      readers: [
        {
          name: 'model-schema',
          match({ file }) {
            return file.endsWith('.model');
          },
          read() {
            return {
              kind: 'schema',
              resourceName: 'users',
              format: 'model',
              schema: {
                kind: 'collection',
                idField: 'id',
                fields: {
                  id: { type: 'string', required: true },
                  email: { type: 'string', required: true },
                  role: { type: 'enum', values: ['admin', 'user'], default: 'user' },
                },
                seed: [
                  { id: 'u_1', email: 'ada@example.com' },
                ],
              },
            };
          },
        },
      ],
    },
  };`);
  await writeFixture(cwd, 'users.model', 'collection users');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);
  const users = result.resources.find((resource) => resource.name === 'users');

  assert.equal(users.schemaSource, 'model');
  assert.equal(result.schema.resources.users.fields.role.default, 'user');
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      email: 'ada@example.com',
      role: 'user',
    },
  ]);
});

test('custom source readers run before built-in readers and can override them', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sources: {
      readers: [
        {
          name: 'json-override',
          match({ file }) {
            return file === 'db/users.json';
          },
          async read({ readText }) {
            const text = await readText();
            const [id, name] = text.trim().split('|');
            return {
              kind: 'data',
              resourceName: 'users',
              format: 'pipe-json',
              data: [{ id, name }],
            };
          },
        },
      ],
    },
  };`);
  await writeFixture(cwd, 'users.json', 'u_1|Override JSON');

  const config = await loadConfig({ cwd });
  await syncDb(config);

  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      name: 'Override JSON',
    },
  ]);
});

test('custom source readers can return multiple named sources from one file', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sources: {
      readers: [
        {
          name: 'bundle',
          match({ file }) {
            return file.endsWith('.bundle');
          },
          read() {
            return [
              {
                kind: 'data',
                resourceName: 'users',
                format: 'bundle',
                data: [{ id: 'u_1', name: 'Ada' }],
              },
              {
                kind: 'schema',
                resourceName: 'settings',
                format: 'bundle',
                schema: {
                  kind: 'document',
                  fields: {
                    theme: { type: 'string', default: 'light' },
                  },
                  seed: {},
                },
              },
            ];
          },
        },
      ],
    },
  };`);
  await writeFixture(cwd, 'app.bundle', 'bundle content');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  assert.deepEqual(Object.keys(result.schema.resources), ['settings', 'users']);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/settings.json'), 'utf8')), {
    theme: 'light',
  });
});

test('custom multi-source readers must name every returned source', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sources: {
      readers: [
        {
          name: 'bad-bundle',
          match({ file }) {
            return file.endsWith('.bundle');
          },
          read() {
            return [
              {
                kind: 'data',
                resourceName: 'users',
                data: [{ id: 'u_1' }],
              },
              {
                kind: 'data',
                data: [{ id: 'p_1' }],
              },
            ];
          },
        },
      ],
    },
  };`);
  await writeFixture(cwd, 'app.bundle', 'bundle content');

  const config = await loadConfig({ cwd });

  await assert.rejects(
    () => syncDb(config),
    (error: any) => {
      assert.equal(error.diagnostics?.[0]?.code, 'SOURCE_READER_RESOURCE_NAME_REQUIRED');
      assert.equal(error.diagnostics[0].file, 'db/app.bundle');
      assert.match(error.diagnostics[0].message, /bad-bundle/);
      assert.match(error.diagnostics[0].hint, /resourceName/);
      return true;
    },
  );
});

test('read mdx scans component usage into records and accepts allow-listed components', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeFile(path.join(cwd, 'db/docs/index.schema.mjs'), `
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'mdx', components: ['Callout', 'Tabs'] }),
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true }),
  },
});
`);
  await writeFile(path.join(cwd, 'db/docs/intro.mdx'), [
    '---',
    'title: Intro',
    '---',
    "import Chart from './chart.js'",
    '',
    '<Callout level="info">Welcome.</Callout>',
    '<Tabs.Item value="a" />',
    '<Chart data={[1]} />',
    '',
    '```jsx',
    '<Marquee>code samples never count</Marquee>',
    '```',
    '',
  ].join('\n'), 'utf8');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  assert.deepEqual(result.diagnostics.filter((diagnostic: any) => diagnostic.severity === 'error'), []);
  assert.deepEqual(result.diagnostics.filter((diagnostic: any) => diagnostic.code === 'SCHEMA_UNKNOWN_FIELD'), []);
  assert.equal(result.schema.resources.docs.fields.components.type, 'array');
  assert.equal(result.schema.resources.docs.fields.components.items.type, 'string');
  assert.equal(result.schema.resources.docs.fields.imports.type, 'array');
  assert.equal(result.schema.resources.docs.fields.exports.type, 'array');

  const db = await openDb({ cwd });
  const docs = await db.collection('docs').all();
  assert.equal(docs.length, 1);
  assert.deepEqual(docs[0].components, ['Callout', 'Chart', 'Tabs.Item']);
  assert.deepEqual(docs[0].imports, ['./chart.js']);
  assert.deepEqual(docs[0].exports, []);
  assert.match(docs[0].body, /<Callout level="info">/);
});

test('read mdx fails sync when a doc uses a component outside the allow-list', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeFile(path.join(cwd, 'db/docs/index.schema.mjs'), `
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'mdx', components: ['Callout'] }),
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true }),
  },
});
`);
  await writeFile(path.join(cwd, 'db/docs/landing.mdx'), [
    '---',
    'title: Landing',
    '---',
    '<Callout>fine</Callout>',
    '<Marquee speed={9}>not registered</Marquee>',
    '',
  ].join('\n'), 'utf8');

  const config = await loadConfig({ cwd });

  await assert.rejects(
    () => syncDb(config),
    (error: any) => {
      const finding = (error.diagnostics ?? []).find((diagnostic: any) => diagnostic.code === 'CONTENT_COMPONENT_NOT_ALLOWED');
      assert.ok(finding, 'expected a CONTENT_COMPONENT_NOT_ALLOWED diagnostic');
      assert.equal(finding.severity, 'error');
      assert.equal(finding.resource, 'docs');
      assert.match(finding.message, /<Marquee>/);
      assert.match(finding.message, /Callout/);
      assert.deepEqual(finding.details.components, ['Marquee']);
      assert.deepEqual(finding.details.allowed, ['Callout']);
      assert.match(finding.hint, /components/);
      return true;
    },
  );
});

test('read mdx without a components list is inventory-only and never fails', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeFile(path.join(cwd, 'db/docs/index.schema.mjs'), `
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'mdx' }),
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true }),
  },
});
`);
  await writeFile(path.join(cwd, 'db/docs/page.mdx'), [
    '---',
    'title: Page',
    '---',
    '<Anything goes={true} />',
    '',
  ].join('\n'), 'utf8');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  assert.deepEqual(result.diagnostics.filter((diagnostic: any) => diagnostic.severity === 'error'), []);
  const db = await openDb({ cwd });
  assert.deepEqual((await db.collection('docs').all())[0].components, ['Anything']);
});

test('a components list without read mdx warns that checking is off', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeFile(path.join(cwd, 'db/docs/index.schema.mjs'), `
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'frontmatter', components: ['Callout'] }),
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true }),
  },
});
`);
  await writeFile(path.join(cwd, 'db/docs/page.mdx'), [
    '---',
    'title: Page',
    '---',
    'plain body',
    '',
  ].join('\n'), 'utf8');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  const warning = result.diagnostics.find((diagnostic: any) => diagnostic.code === 'CONTENT_COMPONENTS_IGNORED');
  assert.ok(warning, 'expected a CONTENT_COMPONENTS_IGNORED warning');
  assert.equal(warning.severity, 'warn');
  assert.match(warning.message, /read: 'mdx'/);
});

test('read mdx allows components the doc imports or exports itself', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeFile(path.join(cwd, 'db/docs/index.schema.mjs'), `
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'mdx', components: [] }),
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true }),
  },
});
`);
  await writeFile(path.join(cwd, 'db/docs/self-sufficient.mdx'), [
    '---',
    'title: Self sufficient',
    '---',
    "import { Sparkline } from './local-charts.js'",
    'export const Inline = (props) => <strong {...props} />;',
    '',
    '<Sparkline points={[1, 2, 3]} />',
    '<Inline>bold</Inline>',
    '',
  ].join('\n'), 'utf8');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  assert.deepEqual(result.diagnostics.filter((diagnostic: any) => diagnostic.severity === 'error'), []);
  const db = await openDb({ cwd });
  const [doc] = await db.collection('docs').all();
  assert.deepEqual(doc.components, ['Inline', 'Sparkline']);
  assert.deepEqual(doc.imports, ['./local-charts.js']);
  assert.deepEqual(doc.exports, ['Inline']);
});
