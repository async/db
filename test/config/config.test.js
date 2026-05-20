import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { syncDb, loadConfig } from '../../src/index.js';
import { mergeManifest, resourceNameFromPath } from '../../src/config-public.js';
import { makeProject, writeConfig } from '../helpers.js';

test('default config adds a small local mock delay range', async () => {
  const cwd = await makeProject();
  const config = await loadConfig({ cwd });

  assert.deepEqual(config.mock.delay, [30, 100]);
  assert.equal(config.server.apiBase, '/__db');
  assert.equal(config.server.dataPath, '/db');
  assert.equal(config.stateDir, path.join(cwd, '.db'));
  assert.equal(config.types.outFile, path.join(cwd, '.db/types/index.ts'));
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
      (error) => {
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
  const base = {
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
