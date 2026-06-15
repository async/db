import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { syncDb as typedSyncDb, loadConfig as typedLoadConfig } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

const loadConfig = async (options: unknown): Promise<any> => typedLoadConfig(options as never) as Promise<any>;
const syncDb = async (...args: any[]): Promise<any> => typedSyncDb(args[0] as never, args[1] as never) as Promise<any>;

test('schemaOutFile writes a committed manifest with inferred UI defaults without changing fixtures', async () => {
  const cwd = await makeProject();
  const usersFixture = JSON.stringify([
    {
      id: 'u_1',
      email: 'ada@example.com',
      active: true,
      avatarUrl: 'https://example.com/ada.png',
      body: 'First local admin user.',
    },
  ]);
  await writeConfig(cwd, `export default {
    schemaOutFile: './src/generated/db.schema.json'
  };`);
  await writeFixture(cwd, 'users.json', usersFixture);

  const config = await loadConfig({ cwd });
  await syncDb(config);

  const manifest = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.schema.json'), 'utf8'));
  const sourceAfterSync = await readFile(path.join(cwd, 'db/users.json'), 'utf8');

  assert.equal(sourceAfterSync, `${usersFixture}\n`);
  assert.equal(manifest.version, 1);
  assert.deepEqual(Object.keys(manifest.documents), []);
  assert.equal(manifest.collections.users.kind, 'collection');
  assert.equal(manifest.collections.users.name, 'users');
  assert.equal(manifest.collections.users.idField, 'id');
  assert.equal(manifest.collections.users.fields.id.ui.readonly, true);
  assert.equal(manifest.collections.users.fields.email.ui.component, 'email');
  assert.equal(manifest.collections.users.fields.active.ui.component, 'toggle');
  assert.equal(manifest.collections.users.fields.avatarUrl.ui.component, 'image');
  assert.equal(manifest.collections.users.fields.body.ui.component, 'textarea');
  assert.equal(manifest.collections.users.fields.email.required, true);
  assert.equal('seed' in manifest.collections.users, false);
  assert.equal('source' in manifest.collections.users, false);
  assert.equal('diagnostics' in manifest, false);
  assert.equal('graphql' in manifest, false);
  assert.equal('rest' in manifest, false);
});

test('schema manifest includes schema defaults, nested fields, arrays, relations, and enum UI defaults', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schemaOutFile: './src/generated/db.schema.json'
  };`);
  await writeFixture(cwd, 'groups.schema.jsonc', `{
    "kind": "collection",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    }
  }`);
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "role": { "type": "enum", "values": ["admin", "user"], "default": "user" },
      "status": { "type": "enum", "values": ["draft", "review", "published", "archived"] },
      "groupId": { "type": "string", "relation": { "to": "groups" } },
      "tags": { "type": "array", "items": { "type": "string" } },
      "profile": {
        "type": "object",
        "fields": {
          "bio": { "type": "string" }
        }
      }
    }
  }`);

  const config = await loadConfig({ cwd });
  await syncDb(config);

  const manifest = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.schema.json'), 'utf8'));
  const users = manifest.collections.users;

  assert.equal(users.fields.role.default, 'user');
  assert.deepEqual(users.fields.role.values, ['admin', 'user']);
  assert.equal(users.fields.role.ui.component, 'radio');
  assert.equal(users.fields.status.ui.component, 'select');
  assert.equal(users.fields.groupId.ui.component, 'relationSelect');
  assert.equal(users.fields.groupId.ui.optionsFrom, 'groups');
  assert.equal(users.fields.tags.ui.component, 'tags');
  assert.equal(users.fields.tags.items.type, 'string');
  assert.equal(users.fields.profile.ui.component, 'fieldset');
  assert.equal(users.fields.profile.fields.bio.ui.component, 'textarea');
});

test('schema manifest customizeField can override and omit field output', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schemaOutFile: './src/generated/db.schema.json',
    schemaManifest: {
      customizeField({ fieldName, resourceName, path, file, defaultManifest }) {
        if (fieldName === 'secret') {
          return null;
        }

        if (resourceName === 'users' && fieldName.endsWith('Markdown')) {
          return {
            ...defaultManifest,
            ui: {
              ...defaultManifest.ui,
              component: 'markdown',
              section: \`\${file}:\${path}\`
            }
          };
        }

        return defaultManifest;
      }
    }
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      bioMarkdown: '# Ada',
      secret: 'hidden',
    },
  ]));

  const config = await loadConfig({ cwd });
  await syncDb(config);

  const manifest = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.schema.json'), 'utf8'));

  assert.equal(manifest.collections.users.fields.bioMarkdown.ui.component, 'markdown');
  assert.equal(manifest.collections.users.fields.bioMarkdown.ui.section, 'db/users.json:bioMarkdown');
  assert.equal('secret' in manifest.collections.users.fields, false);
});

test('schema manifest customizeField can customize object fields inside arrays', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schemaOutFile: './src/generated/db.schema.json',
    schemaManifest: {
      customizeField({ resourceName, fieldName, path, file, defaultManifest }) {
        const baseUi = defaultManifest.ui && typeof defaultManifest.ui === 'object'
          ? defaultManifest.ui
          : {};

        if (resourceName !== 'pages') {
          return defaultManifest;
        }

        if (path === 'blocks') {
          return {
            ...defaultManifest,
            ui: {
              ...baseUi,
              component: 'block-list',
              source: file
            }
          };
        }

        if (fieldName === 'type') {
          return {
            ...defaultManifest,
            values: ['chart', 'metric'],
            ui: {
              ...baseUi,
              component: 'select',
              label: 'Block type',
              orderKey: path
            }
          };
        }

        if (fieldName === 'chartId') {
          return {
            ...defaultManifest,
            ui: {
              ...baseUi,
              component: 'relation-select',
              relationTo: 'charts',
              source: file
            }
          };
        }

        return defaultManifest;
      }
    }
  };`);
  await mkdir(path.join(cwd, 'db/cms'), { recursive: true });
  await writeFile(path.join(cwd, 'db/cms/pages.schema.jsonc'), `{
    "kind": "collection",
    "fields": {
      "id": { "type": "string", "required": true },
      "blocks": {
        "type": "array",
        "items": {
          "type": "object",
          "fields": {
            "type": { "type": "string", "required": true },
            "chartId": { "type": "string" }
          }
        }
      }
    }
  }\n`, 'utf8');

  const config = await loadConfig({ cwd });
  await syncDb(config);

  const manifest = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.schema.json'), 'utf8'));
  const blocks = manifest.collections.pages.fields.blocks;

  assert.equal(blocks.ui.component, 'block-list');
  assert.equal(blocks.ui.source, 'db/cms/pages.schema.jsonc');
  assert.equal(blocks.items.fields.type.values[0], 'chart');
  assert.equal(blocks.items.fields.type.ui.component, 'select');
  assert.equal(blocks.items.fields.type.ui.label, 'Block type');
  assert.equal(blocks.items.fields.type.ui.orderKey, 'blocks.type');
  assert.equal(blocks.items.fields.chartId.ui.component, 'relation-select');
  assert.equal(blocks.items.fields.chartId.ui.relationTo, 'charts');
  assert.equal(blocks.items.fields.chartId.ui.source, 'db/cms/pages.schema.jsonc');
});

test('schema manifest customizeResource can add resource-level metadata', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schemaOutFile: './src/generated/db.schema.json',
    schemaManifest: {
      customizeResource({ resourceName, file, defaultManifest }) {
        return {
          ...defaultManifest,
          editor: {
            group: file.startsWith('db/cms/') ? 'CMS' : 'Data',
            label: resourceName
          }
        };
      }
    }
  };`);
  await mkdir(path.join(cwd, 'db/cms'), { recursive: true });
  await writeFile(path.join(cwd, 'db/cms/pages.schema.jsonc'), `{
    "kind": "collection",
    "fields": {
      "id": { "type": "string", "required": true }
    }
  }\n`, 'utf8');

  const config = await loadConfig({ cwd });
  await syncDb(config);

  const manifest = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.schema.json'), 'utf8'));

  assert.deepEqual(manifest.collections.pages.editor, {
    group: 'CMS',
    label: 'pages',
  });
});

test('schema manifest rejects non-serializable customizeField output with diagnostics', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schemaOutFile: './src/generated/db.schema.json',
    schemaManifest: {
      customizeField({ defaultManifest }) {
        return {
          ...defaultManifest,
          ui: {
            ...defaultManifest.ui,
            render: () => 'nope'
          }
        };
      }
    }
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const config = await loadConfig({ cwd });

  await assert.rejects(
    () => syncDb(config),
    (error: any) => {
      assert.equal(error.diagnostics?.[0]?.code, 'SCHEMA_MANIFEST_FIELD_NOT_SERIALIZABLE');
      assert.match(error.diagnostics[0].message, /users\.id/);
      assert.match(error.diagnostics[0].hint, /JSON-serializable/);
      return true;
    },
  );
});
