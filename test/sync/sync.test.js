import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { openDb, syncDb, loadConfig } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

test('data-first fixtures generate schema, types, and runtime state', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'admin',
    },
  ]));

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  assert.equal(result.schema.resources.users.kind, 'collection');
  assert.match(await readFile(path.join(cwd, '.db/types/index.ts'), 'utf8'), /export type User =/);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/users.json'), 'utf8'))[0].id, 'u_1');
});

test('outputs config writes committed sync artifacts', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    outputs: {
      committedTypes: './src/generated/db.types.ts',
      schemaManifest: './src/generated/db.schema.json',
      viewerManifest: './src/generated/db.viewer.json',
    },
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const config = await loadConfig({ cwd });
  await syncDb(config);

  assert.match(await readFile(path.join(cwd, 'src/generated/db.types.ts'), 'utf8'), /export type User =/);
  assert.equal(JSON.parse(await readFile(path.join(cwd, 'src/generated/db.schema.json'), 'utf8')).collections.users.kind, 'collection');
  assert.equal(JSON.parse(await readFile(path.join(cwd, 'src/generated/db.viewer.json'), 'utf8')).kind, 'db.viewerManifest');
});

test('openDb leaves generated files untouched when fixtures are unchanged', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schemaOutFile: './src/generated/db.schema.json',
    types: {
      commitOutFile: './src/generated/db.types.ts'
    }
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  await openDb({ cwd });

  const generatedPaths = [
    '.db/schema.generated.json',
    '.db/types/index.ts',
    '.db/state/users.json',
    '.db/state/.sources.json',
    'src/generated/db.schema.json',
    'src/generated/db.types.ts',
  ].map((filePath) => path.join(cwd, filePath));
  const before = await fileMtimes(generatedPaths);
  const metadataBefore = JSON.parse(await readFile(path.join(cwd, '.db/state/.sources.json'), 'utf8'));

  await delay(20);
  await openDb({ cwd });

  assert.deepEqual(await fileMtimes(generatedPaths), before);
  assert.equal(
    JSON.parse(await readFile(path.join(cwd, '.db/state/.sources.json'), 'utf8')).resources.users.updatedAt,
    metadataBefore.resources.users.updatedAt,
  );
});

test('nested fixture folders are discovered and keep relative source paths', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/content'), { recursive: true });
  await writeFile(path.join(cwd, 'db/content/pages.schema.jsonc'), `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "title": { "type": "string", "required": true }
    }
  }\n`, 'utf8');
  await writeFile(path.join(cwd, 'db/content/pages.json'), `${JSON.stringify([
    {
      id: 'home',
      title: 'Home',
    },
  ])}\n`, 'utf8');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);
  const metadata = JSON.parse(await readFile(path.join(cwd, '.db/state/.sources.json'), 'utf8'));

  assert.equal(result.schema.resources.pages.kind, 'collection');
  assert.match(result.logs.join('\n'), /Loaded db\/content\/pages\.schema\.jsonc/);
  assert.equal(metadata.resources.pages.path, 'db/content/pages.json');
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/pages.json'), 'utf8')), [
    {
      id: 'home',
      title: 'Home',
    },
  ]);
});

test('operation source folder is ignored by fixture discovery', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/operations'), { recursive: true });
  await writeFile(path.join(cwd, 'db/users.json'), `${JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ])}\n`, 'utf8');
  await writeFile(path.join(cwd, 'db/operations/get-user.jsonc'), `{
    "name": "GetUser",
    "method": "GET",
    "path": "/users/{id}.json",
    "query": {
      "select": "id,name"
    }
  }\n`, 'utf8');

  const config = await loadConfig({
    cwd,
    operations: {
      sourceDir: './db/operations',
    },
  });
  const result = await syncDb(config);

  assert.deepEqual(Object.keys(result.schema.resources), ['users']);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]);
});

test('nested fixture duplicate resource names produce actionable diagnostics', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/cms'), { recursive: true });
  await mkdir(path.join(cwd, 'db/marketing'), { recursive: true });
  await writeFile(path.join(cwd, 'db/cms/pages.json'), `${JSON.stringify([{ id: 'cms-home' }])}\n`, 'utf8');
  await writeFile(path.join(cwd, 'db/marketing/pages.json'), `${JSON.stringify([{ id: 'marketing-home' }])}\n`, 'utf8');

  const config = await loadConfig({ cwd });

  await assert.rejects(
    () => syncDb(config),
    (error) => {
      assert.equal(error.diagnostics?.[0]?.code, 'DUPLICATE_RESOURCE_NAME');
      assert.match(error.diagnostics[0].message, /Duplicate resource name "pages"/);
      assert.match(error.diagnostics[0].message, /db\/cms\/pages\.json/);
      assert.match(error.diagnostics[0].message, /db\/marketing\/pages\.json/);
      assert.match(error.diagnostics[0].hint, /resources\.naming/);
      return true;
    },
  );
});

test('resource aliases that collapse across camelCase and kebab-case fail fast', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    resources: {
      customizeResource({ file, defaultResource }) {
        if (file === 'db/chart-mappings.json') {
          return { ...defaultResource, name: 'chart-mappings' };
        }
        return defaultResource;
      }
    }
  };`);
  await writeFixture(cwd, 'chartMappings.json', JSON.stringify([{ id: 'camel' }]));
  await writeFixture(cwd, 'chart-mappings.json', JSON.stringify([{ id: 'kebab' }]));

  const config = await loadConfig({ cwd });
  const rejectsWithAliasCollision = (error) => {
    assert.equal(error.diagnostics?.[0]?.code, 'RESOURCE_ALIAS_COLLISION');
    assert.match(error.diagnostics[0].message, /Resource aliases are ambiguous/);
    assert.deepEqual(error.diagnostics[0].details.alias, 'chart-mappings');
    assert.deepEqual(error.diagnostics[0].details.resources, ['chart-mappings', 'chartMappings']);
    return true;
  };

  await assert.rejects(
    () => syncDb(config),
    rejectsWithAliasCollision,
  );
  await assert.rejects(
    () => syncDb(config, { allowErrors: true }),
    rejectsWithAliasCollision,
  );
});

test('path-derived resource names that collapse before aliases still fail fast', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    resources: {
      naming: 'folder-prefixed'
    }
  };`);
  await mkdir(path.join(cwd, 'db/chart'), { recursive: true });
  await writeFile(path.join(cwd, 'db/chart/mapping.json'), `${JSON.stringify([{ id: 'nested' }])}\n`, 'utf8');
  await writeFixture(cwd, 'chart-mapping.json', JSON.stringify([{ id: 'flat' }]));

  const config = await loadConfig({ cwd });

  await assert.rejects(
    () => syncDb(config),
    (error) => {
      assert.equal(error.diagnostics?.[0]?.code, 'DUPLICATE_RESOURCE_NAME');
      assert.match(error.diagnostics[0].message, /Duplicate resource name "chartMapping"/);
      assert.match(error.diagnostics[0].message, /db\/chart\/mapping\.json/);
      assert.match(error.diagnostics[0].message, /db\/chart-mapping\.json/);
      return true;
    },
  );
});

test('resource naming strategies and customizeResource support duplicate filenames', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    resources: {
      naming: 'folder-prefixed',
      customizeResource({ file, defaultResource }) {
        if (file === 'db/marketing/pages.json') {
          return {
            ...defaultResource,
            name: 'landingPages'
          };
        }
        return defaultResource;
      }
    }
  };`);
  await mkdir(path.join(cwd, 'db/cms'), { recursive: true });
  await mkdir(path.join(cwd, 'db/marketing'), { recursive: true });
  await writeFile(path.join(cwd, 'db/cms/pages.json'), `${JSON.stringify([{ id: 'cms-home' }])}\n`, 'utf8');
  await writeFile(path.join(cwd, 'db/marketing/pages.json'), `${JSON.stringify([{ id: 'marketing-home' }])}\n`, 'utf8');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  assert.deepEqual(Object.keys(result.schema.resources), ['cmsPages', 'landingPages']);
  assert.equal(result.schema.resources.cmsPages.routePath, '/cms-pages');
  assert.equal(result.schema.resources.landingPages.typeName, 'LandingPage');
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/cmsPages.json'), 'utf8')), [{ id: 'cms-home' }]);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/landingPages.json'), 'utf8')), [{ id: 'marketing-home' }]);
});

test('resource-specific config keys resolve kebab-case aliases', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    collections: {
      'chart-mappings': {
        idField: 'mappingKey'
      }
    }
  };`);
  await writeFixture(cwd, 'chart-mappings.json', JSON.stringify([
    {
      mappingKey: 'cash',
      account: '1000',
    },
  ]));

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);

  assert.equal(result.schema.resources.chartMappings.idField, 'mappingKey');
  assert.equal(result.schema.resources.chartMappings.fields.mappingKey.required, true);
});

test('CSV fixtures infer schema and refresh runtime state when the source hash changes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.csv', [
    'id,name,active,score,zip',
    'u_1,Ada Lovelace,true,10,02139',
    'u_2,Grace Hopper,false,11.5,10001',
  ].join('\n'));

  const config = await loadConfig({ cwd });
  const firstSync = await syncDb(config);
  const statePath = path.join(cwd, '.db/state/users.json');
  const metadataPath = path.join(cwd, '.db/state/.sources.json');

  assert.equal(firstSync.schema.resources.users.kind, 'collection');
  assert.equal(firstSync.schema.resources.users.idField, 'id');
  assert.equal(firstSync.schema.resources.users.fields.active.type, 'boolean');
  assert.equal(firstSync.schema.resources.users.fields.score.type, 'number');
  assert.equal(firstSync.schema.resources.users.fields.zip.type, 'string');
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: 'u_1',
      name: 'Ada Lovelace',
      active: true,
      score: 10,
      zip: '02139',
    },
    {
      id: 'u_2',
      name: 'Grace Hopper',
      active: false,
      score: 11.5,
      zip: '10001',
    },
  ]);

  await writeFile(statePath, `${JSON.stringify([{ id: 'runtime_edit', name: 'Runtime Edit' }], null, 2)}\n`);
  await syncDb(config);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: 'runtime_edit',
      name: 'Runtime Edit',
    },
  ]);

  await writeFixture(cwd, 'users.csv', [
    'id,name,active,score,zip',
    'u_3,Linus Torvalds,true,99,00901',
  ].join('\n'));
  await syncDb(config);

  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: 'u_3',
      name: 'Linus Torvalds',
      active: true,
      score: 99,
      zip: '00901',
    },
  ]);

  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  assert.equal(metadata.resources.users.format, 'csv');
  assert.equal(metadata.resources.users.path, 'db/users.csv');
  assert.match(metadata.resources.users.hash, /^[a-f0-9]{64}$/);
});

test('JSON fixture hashes refresh mirror state only when the source file changes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    },
    {
      name: 'Grace Hopper',
      email: 'grace@example.com',
    },
  ]));

  const config = await loadConfig({ cwd });
  const firstSync = await syncDb(config);
  const statePath = path.join(cwd, '.db/state/users.json');
  const metadataPath = path.join(cwd, '.db/state/.sources.json');

  assert.equal(firstSync.schema.resources.users.fields.id.type, 'string');
  assert.equal(firstSync.schema.resources.users.fields.id.required, true);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: '1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    },
    {
      id: '2',
      name: 'Grace Hopper',
      email: 'grace@example.com',
    },
  ]);
  assert.doesNotMatch(await readFile(path.join(cwd, 'db/users.json'), 'utf8'), /"id"/);

  await writeFile(statePath, `${JSON.stringify([{ id: 'runtime_edit', name: 'Runtime Edit' }], null, 2)}\n`);
  await syncDb(config);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: 'runtime_edit',
      name: 'Runtime Edit',
    },
  ]);

  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      name: 'Linus Torvalds',
      email: 'linus@example.com',
    },
  ]));
  await syncDb(config);

  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: '1',
      name: 'Linus Torvalds',
      email: 'linus@example.com',
    },
  ]);

  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  assert.equal(metadata.resources.users.format, 'json');
  assert.equal(metadata.resources.users.path, 'db/users.json');
  assert.match(metadata.resources.users.hash, /^[a-f0-9]{64}$/);
});

test('sourceFile store writes generated ids back to JSON fixtures', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sourceDir: './db',
    stateDir: './.db',
    resources: {
      users: {
        store: 'sourceFile'
      }
    }
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      name: 'Ada Lovelace'
    },
    {
      id: '10',
      name: 'Grace Hopper'
    },
    {
      name: 'Katherine Johnson'
    }
  ]));

  const config = await loadConfig({ cwd });
  await syncDb(config);

  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'db/users.json'), 'utf8')), [
    {
      id: '11',
      name: 'Ada Lovelace',
    },
    {
      id: '10',
      name: 'Grace Hopper',
    },
    {
      id: '12',
      name: 'Katherine Johnson',
    },
  ]);
});

test('json store does not write generated ids back to JSON fixtures', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      name: 'Ada Lovelace'
    }
  ]));

  const config = await loadConfig({ cwd });
  await syncDb(config);

  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'db/users.json'), 'utf8')), [
    {
      name: 'Ada Lovelace',
    },
  ]);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/users.json'), 'utf8')), [
    {
      id: '1',
      name: 'Ada Lovelace',
    },
  ]);
});

async function fileMtimes(filePaths) {
  const entries = await Promise.all(filePaths.map(async (filePath) => [
    filePath,
    (await stat(filePath, { bigint: true })).mtimeNs,
  ]));
  return Object.fromEntries(entries);
}

test('types.commitOutFile writes a committed type copy', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sourceDir: './db',
    stateDir: './.db',
    types: {
      enabled: true,
      outFile: './.db/types/index.ts',
      commitOutFile: './src/generated/db.types.ts'
    }
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const config = await loadConfig({ cwd });
  await syncDb(config);

  const ignoredTypes = await readFile(path.join(cwd, '.db/types/index.ts'), 'utf8');
  const committedTypes = await readFile(path.join(cwd, 'src/generated/db.types.ts'), 'utf8');

  assert.equal(committedTypes, ignoredTypes);
  assert.match(committedTypes, /users: User;/);
});
