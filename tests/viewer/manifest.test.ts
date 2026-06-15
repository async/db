import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { generateViewerManifest as typedGenerateViewerManifest, loadConfig as typedLoadConfig, loadProjectSchema as typedLoadProjectSchema, renderViewerManifest as typedRenderViewerManifest, syncDb as typedSyncDb } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

const loadConfig = async (options: unknown): Promise<any> => typedLoadConfig(options as never) as Promise<any>;
const syncDb = async (...args: any[]): Promise<any> => typedSyncDb(args[0] as never, args[1] as never) as Promise<any>;
const loadProjectSchema = async (...args: any[]): Promise<any> => typedLoadProjectSchema(args[0] as never, args[1] as never) as Promise<any>;
const generateViewerManifest = (...args: any[]): any => typedGenerateViewerManifest(args[0] as never, args[1] as never);
const renderViewerManifest = (...args: any[]): any => typedRenderViewerManifest(args[0] as never, args[1] as never, args[2] as never);

test('viewer manifest exposes custom-viewer metadata without runtime internals', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    server: {
      apiBase: '/_db',
      viewerLinks: [
        { label: 'Custom Data Viewer', href: '/app/db-viewer' }
      ],
    },
    graphql: {
      enabled: true,
      path: '/_db/graphql',
    },
    falcor: {
      enabled: true,
    },
    rest: {
      formats: {
        yaml: {
          mediaTypes: ['application/yaml', 'text/yaml'],
          contentType: 'application/yaml; charset=utf-8',
          render({ data }) {
            return JSON.stringify(data);
          },
        },
      },
    },
    schemaManifest: {
      customizeField({ fieldName, defaultManifest }) {
        if (fieldName === 'status') {
          return {
            ...defaultManifest,
            ui: {
              ...defaultManifest.ui,
              component: 'segmented-control',
            },
          };
        }

        return defaultManifest;
      },
      customizeResource({ resourceName, defaultManifest }) {
        if (resourceName === 'projects') {
          return {
            ...defaultManifest,
            editor: {
              title: 'Projects',
            },
          };
        }

        return defaultManifest;
      }
    }
  };`);
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    }
  }`);
  await writeFixture(cwd, 'projects.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "description": "Local projects.",
    "fields": {
      "id": { "type": "string", "required": true },
      "ownerId": {
        "type": "string",
        "relation": {
          "name": "owner",
          "to": "users",
          "toField": "id",
          "cardinality": "one"
        }
      },
      "status": {
        "type": "enum",
        "values": ["planned", "active"],
        "default": "planned"
      }
    },
    "seed": [{ "id": "p_1", "ownerId": "u_1", "status": "planned" }]
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const manifest = renderViewerManifest(project.resources, config, {
    diagnostics: [{
      code: 'SOURCE_WARNING',
      severity: 'warn',
      message: 'Fixture warning.',
    }],
    generatedAt: '2026-05-20T00:00:00.000Z',
  });

  assert.equal(manifest.kind, 'db.viewerManifest');
  assert.equal(manifest.version, 1);
  assert.equal(manifest.generatedAt, '2026-05-20T00:00:00.000Z');
  assert.equal(manifest.api.viewer, '/_db');
  assert.equal(manifest.api.manifest, '/_db/manifest');
  assert.equal(manifest.api.manifestJson, '/_db/manifest.json');
  assert.equal(manifest.api.manifestHtml, '/_db/manifest.html');
  assert.equal(manifest.api.manifestMarkdown, '/_db/manifest.md');
  assert.deepEqual(manifest.api.formats.yaml, {
    extension: '.yaml',
    mediaTypes: ['application/yaml', 'text/yaml'],
    contentType: 'application/yaml; charset=utf-8',
    manifestPath: '/_db/manifest.yaml',
  });
  assert.deepEqual(manifest.api.formats.json, {
    extension: '.json',
    mediaTypes: ['application/json'],
    contentType: 'application/json; charset=utf-8',
    manifestPath: '/_db/manifest.json',
  });
  assert.deepEqual(manifest.api.viewers, [
    {
      label: 'Data Viewer',
      href: '/_db',
      source: 'built-in',
    },
    {
      label: 'Custom Data Viewer',
      href: '/app/db-viewer',
      source: 'custom',
    },
  ]);
  assert.equal(manifest.api.schema, '/_db/schema');
  assert.equal(manifest.api.events, '/_db/events');
  assert.equal(manifest.api.log, '/_db/log');
  assert.equal(manifest.api.batch, '/_db/batch');
  assert.equal(manifest.api.import, '/_db/import');
  assert.equal(manifest.api.graphql, '/_db/graphql');
  assert.equal(manifest.api.falcor, '/model.json');
  assert.equal(manifest.api.restBasePath, '');
  assert.equal(manifest.api.resourceBasePath, '/resources');
  assert.deepEqual(manifest.api.resources.projects, {
    kind: 'collection',
    list: '/projects',
    record: '/projects/{id}',
    canonicalList: '/resources/projects',
    canonicalRecord: '/resources/projects/{id}',
    identity: ['id'],
  });
  assert.equal(manifest.capabilities.collections, true);
  assert.equal(manifest.capabilities.documents, false);
  assert.equal(manifest.capabilities.rest, true);
  assert.equal(manifest.capabilities.writes, true);
  assert.equal(manifest.capabilities.restBatch, true);
  assert.equal(manifest.capabilities.graphql, true);
  assert.equal(manifest.capabilities.falcor, true);
  assert.equal(manifest.capabilities.csvImport, true);
  assert.equal(manifest.capabilities.liveEvents, true);
  assert.equal(manifest.collections.projects.kind, 'collection');
  assert.equal(manifest.collections.projects.typeName, 'Project');
  assert.equal(manifest.collections.projects.routePath, '/projects');
  assert.equal(manifest.collections.projects.editor.title, 'Projects');
  assert.equal(manifest.collections.projects.fields.status.default, 'planned');
  assert.equal(manifest.collections.projects.fields.status.ui.component, 'segmented-control');
  assert.equal(manifest.collections.projects.fields.ownerId.ui.optionsFrom, 'users');
  assert.deepEqual(manifest.collections.projects.relations, [{
    name: 'owner',
    sourceResource: 'projects',
    sourceField: 'ownerId',
    targetResource: 'users',
    targetField: 'id',
    cardinality: 'one',
  }]);
  assert.deepEqual(manifest.diagnostics, [{
    code: 'SOURCE_WARNING',
    severity: 'warn',
    message: 'Fixture warning.',
  }]);
  assert.equal('seed' in manifest.collections.projects, false);
  assert.equal('source' in manifest.collections.projects, false);
  assert.equal('graphql' in manifest, false);
  assert.equal('rest' in manifest, false);
});

test('viewer manifest marks REST resources and batching unavailable when REST is disabled', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    rest: {
      enabled: false,
    },
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const manifest = renderViewerManifest(project.resources, config, {
    generatedAt: '2026-05-20T00:00:00.000Z',
  });

  assert.equal(manifest.capabilities.rest, false);
  assert.equal(manifest.capabilities.writes, false);
  assert.equal(manifest.capabilities.restBatch, false);
  assert.equal(manifest.capabilities.graphql, false);
  assert.equal(manifest.capabilities.csvImport, true);
  assert.equal(manifest.api.batch, '/__db/batch');
  assert.equal(manifest.api.resources.users.list, '/users');
});

test('viewer manifest marks GraphQL unavailable when GraphQL is disabled', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    graphql: {
      enabled: false,
      path: '/_db/graphql'
    },
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const manifest = renderViewerManifest(project.resources, config, {
    generatedAt: '2026-05-20T00:00:00.000Z',
  });

  assert.equal(manifest.capabilities.graphql, false);
  assert.equal(manifest.api.graphql, '/_db/graphql');
  assert.equal(manifest.capabilities.rest, true);
  assert.equal(manifest.capabilities.writes, true);
});

test('viewerManifestOutFile writes a committed manifest during sync', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    viewerManifestOutFile: './src/generated/db.viewer.json'
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', email: 'ada@example.com' }]));

  const config = await loadConfig({ cwd });
  await syncDb(config);

  const manifest = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.viewer.json'), 'utf8'));

  assert.equal(manifest.kind, 'db.viewerManifest');
  assert.equal(manifest.api.manifest, '/__db/manifest');
  assert.equal(manifest.api.manifestJson, '/__db/manifest.json');
  assert.equal(manifest.api.manifestHtml, '/__db/manifest.html');
  assert.equal(manifest.api.manifestMarkdown, '/__db/manifest.md');
  assert.equal(manifest.collections.users.fields.email.ui.component, 'email');
  assert.equal('seed' in manifest.collections.users, false);
  assert.equal('source' in manifest.collections.users, false);
});

test('generateViewerManifest writes an explicit out file relative to cwd', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({ theme: 'dark' }));

  const config = await loadConfig({ cwd });
  const result = await generateViewerManifest(config, {
    outFile: './artifacts/viewer.json',
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const manifest = JSON.parse(await readFile(path.join(cwd, 'artifacts/viewer.json'), 'utf8'));

  assert.deepEqual(result.outFiles, [path.join(cwd, 'artifacts/viewer.json')]);
  assert.equal(manifest.documents.settings.kind, 'document');
  assert.equal(manifest.api.resources.settings.read, '/settings');
  assert.equal(manifest.generatedAt, '2026-05-20T00:00:00.000Z');
  assert.equal(manifest.api.formats.md.manifestPath, '/__db/manifest.md');
});
