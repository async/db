import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { syncDb as typedSyncDb, loadConfig as typedLoadConfig } from '../../src/index.js';
import { mergeManifest, resourceNameFromPath } from '../../src/config-public.js';
import { makeProject, writeConfig } from '../helpers.js';

const loadConfig = async (options: unknown): Promise<any> => typedLoadConfig(options as never) as Promise<any>;
const syncDb = async (...args: any[]): Promise<any> => typedSyncDb(args[0] as never, args[1] as never) as Promise<any>;

test('default config adds a small local mock delay range', async () => {
  const cwd = await makeProject();
  const config = await loadConfig({ cwd });

  assert.deepEqual(config.mock.delay, [30, 100]);
  assert.equal(config.server.apiBase, '/__db');
  assert.equal(config.server.dataPath, '/db');
  assert.equal(config.stateDir, path.join(cwd, '.db'));
  assert.equal(config.types.outFile, path.join(cwd, '.db/types/index.d.ts'));
  assert.equal(config.outputs.stateDir, path.join(cwd, '.db'));
  assert.equal(config.outputs.types, path.join(cwd, '.db/types/index.d.ts'));
  assert.equal(config.outputs.contractRefs, null);
  assert.deepEqual(config.contracts, {});
});

test('loadConfig normalizes public outputs config and mirrors legacy fields', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    outputs: {
      stateDir: './var/db',
      types: './generated/runtime.types.ts',
      committedTypes: './src/generated/db.types.ts',
      schemaManifest: './src/generated/db.schema.json',
      viewerManifest: './src/generated/db.viewer.json',
      operationRegistry: './src/generated/db.operations.json',
      operationRefs: './src/generated/db.operation-refs.json',
      contractRefs: './src/generated/db.contract-refs.json',
      honoStarterDir: './generated/hono',
    },
  };`);

  const config = await loadConfig({ cwd });

  assert.equal(config.outputs.stateDir, path.join(cwd, 'var/db'));
  assert.equal(config.outputs.types, path.join(cwd, 'generated/runtime.types.ts'));
  assert.equal(config.outputs.committedTypes, path.join(cwd, 'src/generated/db.types.ts'));
  assert.equal(config.outputs.schemaManifest, path.join(cwd, 'src/generated/db.schema.json'));
  assert.equal(config.outputs.viewerManifest, path.join(cwd, 'src/generated/db.viewer.json'));
  assert.equal(config.outputs.operationRegistry, path.join(cwd, 'src/generated/db.operations.json'));
  assert.equal(config.outputs.operationRefs, path.join(cwd, 'src/generated/db.operation-refs.json'));
  assert.equal(config.outputs.contractRefs, path.join(cwd, 'src/generated/db.contract-refs.json'));
  assert.equal(config.outputs.honoStarterDir, path.join(cwd, 'generated/hono'));

  assert.equal(config.stateDir, path.join(cwd, 'var/db'));
  assert.equal(config.types.outFile, path.join(cwd, 'generated/runtime.types.ts'));
  assert.equal(config.types.commitOutFile, path.join(cwd, 'src/generated/db.types.ts'));
  assert.equal(config.schemaOutFile, path.join(cwd, 'src/generated/db.schema.json'));
  assert.equal(config.viewerManifestOutFile, path.join(cwd, 'src/generated/db.viewer.json'));
  assert.equal(config.operations.outFile, path.join(cwd, 'src/generated/db.operations.json'));
  assert.equal(config.operations.refsOutFile, path.join(cwd, 'src/generated/db.operation-refs.json'));
  assert.equal(config.generate.hono.outDir, path.join(cwd, 'generated/hono'));
});

test('public outputs config wins over legacy output keys', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    stateDir: './legacy-db',
    schemaOutFile: './legacy/schema.json',
    viewerManifestOutFile: './legacy/viewer.json',
    outputs: {
      stateDir: './var/db',
      types: './generated/runtime.types.ts',
      committedTypes: './src/generated/db.types.ts',
      schemaManifest: './src/generated/db.schema.json',
      viewerManifest: './src/generated/db.viewer.json',
      operationRegistry: './src/generated/db.operations.json',
      operationRefs: './src/generated/db.operation-refs.json',
      contractRefs: './src/generated/db.contract-refs.json',
      honoStarterDir: './generated/hono',
    },
    types: {
      outFile: './legacy/types.ts',
      commitOutFile: './legacy/commit-types.ts',
    },
    operations: {
      outFile: './legacy/operations.json',
      refsOutFile: './legacy/operation-refs.json',
    },
    generate: {
      hono: {
        outDir: './legacy/hono',
      },
    },
  };`);

  const config = await loadConfig({ cwd });

  assert.equal(config.stateDir, path.join(cwd, 'var/db'));
  assert.equal(config.types.outFile, path.join(cwd, 'generated/runtime.types.ts'));
  assert.equal(config.types.commitOutFile, path.join(cwd, 'src/generated/db.types.ts'));
  assert.equal(config.schemaOutFile, path.join(cwd, 'src/generated/db.schema.json'));
  assert.equal(config.viewerManifestOutFile, path.join(cwd, 'src/generated/db.viewer.json'));
  assert.equal(config.operations.outFile, path.join(cwd, 'src/generated/db.operations.json'));
  assert.equal(config.operations.refsOutFile, path.join(cwd, 'src/generated/db.operation-refs.json'));
  assert.equal(config.outputs.contractRefs, path.join(cwd, 'src/generated/db.contract-refs.json'));
  assert.equal(config.generate.hono.outDir, path.join(cwd, 'generated/hono'));
});

test('operations strict mode defaults off', async () => {
  const cwd = await makeProject();
  const config = await loadConfig({ cwd });

  assert.equal(config.operations.strict, false);
});

test('loadConfig rejects removed fixture fork config', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    forks: ['legacy-demo'],
  };`);

  await assert.rejects(
    () => loadConfig({ cwd }),
    (error: any) => {
      assert.equal(error.code, 'CONFIG_LEGACY_FIXTURE_FORKS_REMOVED');
      assert.match(error.message, /forks/);
      assert.match(error.hint, /db\.forks\.create/);
      return true;
    },
  );
});

test('loadConfig rejects removed fixture template config', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    templates: {
      free: {
        dbDir: './db.templates/free',
      },
    },
  };`);

  await assert.rejects(
    () => loadConfig({ cwd }),
    (error: any) => {
      assert.equal(error.code, 'CONFIG_LEGACY_FIXTURE_FORKS_REMOVED');
      assert.match(error.message, /templates/);
      assert.match(error.hint, /Use runtime forks/);
      return true;
    },
  );
});

test('server dataPath can be disabled', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    server: {
      dataPath: false,
    },
  };`);

  const config = await loadConfig({ cwd });

  assert.equal(config.server.apiBase, '/__db');
  assert.equal(config.server.dataPath, false);
});

test('dbDir config changes the fixture source folder', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    dbDir: './db',
  };`);
  await mkdir(path.join(cwd, 'db'), { recursive: true });
  await writeFile(path.join(cwd, 'db/users.json'), `${JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ])}\n`, 'utf8');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);
  const metadata = JSON.parse(await readFile(path.join(cwd, '.db/state/.sources.json'), 'utf8'));

  assert.equal(config.dbDir, path.join(cwd, 'db'));
  assert.equal(config.sourceDir, path.join(cwd, 'db'));
  assert.equal(result.schema.resources.users.kind, 'collection');
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]);
  assert.equal(metadata.resources.users.path, 'db/users.json');
});

test('config files can use the typed defineConfig helper', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `import { defineConfig } from '@async/db/config';

export default defineConfig({
  stores: {
    default: 'json',
  },
  mock: {
    delay: [75, 250],
  },
});
`);

  const config = await loadConfig({ cwd });

  assert.equal(config.stores.default, 'json');
  assert.deepEqual(config.mock.delay, [75, 250]);
});

test('loadConfig accepts public store config without enabling runtime strategy config', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    stores: {
      default: 'json',
      json: {
        driver: 'json',
      },
      memory: {
        driver: 'memory',
      },
    },
    resources: {
      users: {
        store: 'memory',
      },
    },
  };`);

  const config = await loadConfig({ cwd });

  assert.deepEqual(config.stores, {
    default: 'json',
    json: {
      driver: 'json',
    },
    memory: {
      driver: 'memory',
    },
  });
  assert.equal(config.resources.users.store, 'memory');
  assert.equal(config.runtime, undefined);
  assert.equal(config.resources.users.runtime, undefined);
});

test('loadConfig rejects private runtime config with migration diagnostics', async () => {
  const cases = [
    {
      name: 'mode',
      source: `export default {
        mode: 'source',
      };`,
      path: 'mode',
    },
    {
      name: 'runtime.default',
      source: `export default {
        runtime: {
          default: 'memory',
        },
      };`,
      path: 'runtime.default',
    },
    {
      name: 'runtime.adapters',
      source: `export default {
        runtime: {
          adapters: [],
        },
      };`,
      path: 'runtime.adapters',
    },
    {
      name: 'resources.users.runtime',
      source: `export default {
        resources: {
          users: {
            runtime: 'static',
          },
        },
      };`,
      path: 'resources.users.runtime',
    },
  ];

  for (const scenario of cases) {
    const cwd = await makeProject();
    await writeConfig(cwd, scenario.source);

    await assert.rejects(
      () => loadConfig({ cwd }),
      (error: any) => {
        assert.equal(error.code, 'CONFIG_UNSUPPORTED_RUNTIME_BOUNDARY', scenario.name);
        assert.equal(error.diagnostics?.[0]?.code, 'CONFIG_UNSUPPORTED_RUNTIME_BOUNDARY', scenario.name);
        assert.equal(error.diagnostics[0].severity, 'error', scenario.name);
        assert.equal(error.diagnostics[0].path, scenario.path, scenario.name);
        assert.match(error.diagnostics[0].message, /runtime config/i, scenario.name);
        assert.match(error.diagnostics[0].hint, /stores/i, scenario.name);
        assert.match(error.diagnostics[0].hint, /resources\.<name>\.store/i, scenario.name);
        return true;
      },
    );
  }
});

test('resourceNameFromPath derives names from fixture paths', () => {
  assert.equal(resourceNameFromPath('db/cms/pages.schema.jsonc'), 'pages');
  assert.equal(resourceNameFromPath('db/cms/pages.schema.jsonc', { strategy: 'folder-prefixed' }), 'cmsPages');
  assert.equal(resourceNameFromPath('db/cms/landing/pages.json', { strategy: 'path' }), 'cmsLandingPages');
});

test('mergeManifest deep merges without mutating inputs and replaces arrays', () => {
  const base: any = {
    type: 'enum',
    values: ['old'],
    editor: {
      component: 'select',
      label: 'Status',
    },
  };
  const patch = {
    values: ['draft', 'published'],
    editor: {
      source: 'db/cms/pages.schema.jsonc',
      label: undefined,
    },
  };

  assert.deepEqual(mergeManifest(base, patch), {
    type: 'enum',
    values: ['draft', 'published'],
    editor: {
      component: 'select',
      label: 'Status',
      source: 'db/cms/pages.schema.jsonc',
    },
  });
  assert.deepEqual(base.values, ['old']);
  assert.equal(base.editor.source, undefined);
});
