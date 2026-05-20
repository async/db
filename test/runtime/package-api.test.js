import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openJsonFixtureDb } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

test('defaults apply when creating records through the package API', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      },
      "active": {
        "type": "boolean",
        "default": true
      }
    }
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const user = await db.collection('users').create({
    id: 'u_3',
    name: 'Linus',
  });

  assert.deepEqual(user, {
    id: 'u_3',
    name: 'Linus',
    role: 'user',
    active: true,
  });
});

test('defaults can be disabled on package API create', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    defaults: {
      applyOnCreate: false
    }
  };`);
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      },
      "active": {
        "type": "boolean",
        "default": true
      }
    }
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const user = await db.collection('users').create({
    id: 'u_3',
    name: 'Linus',
  });

  assert.deepEqual(user, {
    id: 'u_3',
    name: 'Linus',
  });
});

test('defaults do not backfill omitted fields during package API updates', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    defaults: {
      applyOnSafeMigration: false
    }
  };`);
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      }
    },
    "seed": [
      { "id": "u_1", "name": "Ada Lovelace" }
    ]
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const users = db.collection('users');
  const updated = await users.patch('u_1', {
    name: 'Ada Byron',
  });
  const created = await users.create({
    id: 'u_2',
    name: 'Grace Hopper',
  });

  assert.deepEqual(updated, {
    id: 'u_1',
    name: 'Ada Byron',
  });
  assert.deepEqual(created, {
    id: 'u_2',
    name: 'Grace Hopper',
    role: 'user',
  });
});

test('package API duplicate ids produce actionable errors', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd });

  await assert.rejects(
    () => db.collection('users').create({
      id: 'u_1',
      name: 'Duplicate Ada',
    }),
    (error) => {
      assert.equal(error.code, 'DB_CREATE_DUPLICATE_ID');
      assert.match(error.message, /already exists/);
      assert.match(error.hint, /patch\/update/);
      assert.equal(error.details.resource, 'users');
      return true;
    },
  );
});

test('collection.exists returns whether an id is present', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd });
  const users = db.collection('users');

  assert.equal(await users.exists('u_1'), true);
  assert.equal(await users.exists('missing'), false);
});

test('inferred variants validate writes through the package API', async () => {
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

  const db = await openJsonFixtureDb({ cwd });

  await assert.rejects(
    () => db.collection('pages').create({
      id: 'broken',
      blocks: [
        {
          type: 'chart',
          title: 'Missing chart id',
        },
      ],
    }),
    (error) => {
      assert.equal(error.code, 'DB_SCHEMA_VALIDATION_FAILED');
      assert.equal(error.details.diagnostics[0].code, 'SCHEMA_REQUIRED_FIELD_MISSING');
      assert.equal(error.details.diagnostics[0].field, 'blocks[0].chartId');
      return true;
    },
  );
});

test('package API resolves camelCase and kebab-case resource names', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'chart-mappings.json', JSON.stringify([
    {
      id: 'map_1',
      name: 'Default',
    },
  ]));
  await writeFixture(cwd, 'chart-preferences.json', JSON.stringify({
    theme: 'finance',
  }));

  const db = await openJsonFixtureDb({ cwd });

  assert.deepEqual(await db.collection('chartMappings').all(), [
    {
      id: 'map_1',
      name: 'Default',
    },
  ]);
  assert.deepEqual(await db.collection('chart-mappings').all(), [
    {
      id: 'map_1',
      name: 'Default',
    },
  ]);
  assert.deepEqual(await db.document('chartPreferences').all(), {
    theme: 'finance',
  });
  assert.deepEqual(await db.document('chart-preferences').all(), {
    theme: 'finance',
  });
});

test('package API unknown resource errors include attempted normalized names', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'chart-mappings.json', JSON.stringify([
    {
      id: 'map_1',
      name: 'Default',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd });

  assert.throws(
    () => db.collection('chart-mappingz'),
    (error) => {
      assert.equal(error.code, 'DB_UNKNOWN_RESOURCE');
      assert.equal(error.details.resource, 'chart-mappingz');
      assert.equal(error.details.requestedResource, 'chart-mappingz');
      assert.deepEqual(error.details.normalizedCandidates, ['chart-mappingz', 'chartMappingz']);
      assert.deepEqual(error.details.availableResources, ['chartMappings']);
      assert.match(error.hint, /chartMappings/);
      return true;
    },
  );
});

test('package create assigns a counter id when the body omits id', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "1", "name": "Ada Lovelace" }
    ]
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const user = await db.collection('users').create({
    name: 'Grace Hopper',
  });

  assert.deepEqual(user, {
    id: '2',
    name: 'Grace Hopper',
  });
});

test('package API rejects records that do not match schema field types', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": { "type": "enum", "values": ["admin", "user"] }
    },
    "seed": []
  }`);

  const db = await openJsonFixtureDb({ cwd });

  await assert.rejects(
    () => db.collection('users').create({
      id: 'u_1',
      email: 42,
      role: 'owner',
    }),
    (error) => {
      assert.equal(error.code, 'DB_SCHEMA_VALIDATION_FAILED');
      assert.match(error.message, /email/);
      assert.equal(error.details.diagnostics[0].code, 'SCHEMA_FIELD_TYPE_MISMATCH');
      return true;
    },
  );
});

test('package API rejects constrained field values and unique duplicates', async () => {
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
      "age": {
        "type": "number",
        "min": 13
      }
    },
    "seed": [
      { "id": "u_1", "email": "ada@example.com", "age": 28 }
    ]
  }`);

  const db = await openJsonFixtureDb({ cwd });

  await assert.rejects(
    () => db.collection('users').create({
      id: 'u_2',
      email: 'ada@example.com',
      age: 20,
    }),
    (error) => {
      assert.equal(error.code, 'DB_SCHEMA_VALIDATION_FAILED');
      assert.equal(error.details.diagnostics[0].code, 'SCHEMA_UNIQUE_VALUE_DUPLICATE');
      assert.match(error.details.diagnostics[0].message, /email/);
      return true;
    },
  );

  await assert.rejects(
    () => db.collection('users').create({
      id: 'u_3',
      email: 'not-an-email',
      age: 12,
    }),
    (error) => {
      assert.equal(error.code, 'DB_SCHEMA_VALIDATION_FAILED');
      assert.deepEqual(
        error.details.diagnostics.map((diagnostic) => diagnostic.details.constraint),
        ['pattern', 'min'],
      );
      return true;
    },
  );
});

test('package API serializes concurrent collection writes in one process', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": []
  }`);

  const db = await openJsonFixtureDb({ cwd });
  await Promise.all(Array.from({ length: 12 }, (_, index) => db.collection('users').create({
    id: `u_${index}`,
    name: `User ${index}`,
  })));

  assert.equal((await db.collection('users').all()).length, 12);
});

test('package API serializes concurrent document writes in one process', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.schema.jsonc', `{
    "kind": "document",
    "fields": {
      "theme": { "type": "string" },
      "locale": { "type": "string" },
      "active": { "type": "boolean" }
    },
    "seed": {
      "theme": "light"
    }
  }`);

  const db = await openJsonFixtureDb({ cwd });
  await Promise.all([
    db.document('settings').update({ locale: 'en-US' }),
    db.document('settings').update({ active: true }),
  ]);

  assert.deepEqual(await db.document('settings').all(), {
    theme: 'light',
    locale: 'en-US',
    active: true,
  });
});

test('singleton documents support JSON pointer get and set', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
    features: {
      billing: false,
    },
  }));

  const db = await openJsonFixtureDb({ cwd });
  const settings = db.document('settings');

  await settings.set('/features/billing', true);

  assert.equal(await settings.get('/features/billing'), true);
  assert.equal((await settings.all()).features.billing, true);
});

test('memory store supports CRUD without writing JSON state files', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `export default {
    stores: {
      default: 'memory'
    }
  };`);

  const db = await openJsonFixtureDb({ cwd });
  await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });

  assert.deepEqual(await db.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
    { id: 'u_2', name: 'Grace Hopper' },
  ]);
  await assert.rejects(
    () => access(path.join(cwd, '.jsondb/state/users.json')),
    { code: 'ENOENT' },
  );
});

test('named store aliases select their configured driver', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `export default {
    stores: {
      default: 'json',
      analytics: 'memory'
    },
    resources: {
      users: {
        store: 'analytics'
      }
    }
  };`);

  const db = await openJsonFixtureDb({ cwd });
  await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });

  assert.deepEqual(await db.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
    { id: 'u_2', name: 'Grace Hopper' },
  ]);
  await assert.rejects(
    () => access(path.join(cwd, '.jsondb/state/users.json')),
    { code: 'ENOENT' },
  );
});

test('custom store factory hydrates, reads, and writes through package API', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `const values = new Map();

export default {
  stores: {
    default: 'ephemeral',
    ephemeral: ({ storeName }) => ({
      name: storeName,
      hydrate(resources) {
        for (const resource of resources) {
          values.set(resource.name, structuredClone(resource.seed));
        }
      },
      readResource(resource, fallback) {
        return structuredClone(values.get(resource.name) ?? fallback);
      },
      writeResource(resource, value) {
        values.set(resource.name, structuredClone(value));
      }
    })
  }
};`);

  const db = await openJsonFixtureDb({ cwd });
  await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });

  assert.deepEqual(await db.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
    { id: 'u_2', name: 'Grace Hopper' },
  ]);
  await assert.rejects(
    () => access(path.join(cwd, '.jsondb/state/users.json')),
    { code: 'ENOENT' },
  );
});

test('missing configured store names produce store-facing diagnostics', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `export default {
    resources: {
      users: {
        store: 'missingStore'
      }
    },
    stores: {
      analytics: 'memory'
    }
  };`);

  await assert.rejects(
    () => openJsonFixtureDb({ cwd }),
    (error) => {
      assert.equal(error.code, 'STORE_NOT_FOUND');
      assert.match(error.message, /missingStore/);
      assert.equal(error.details.resource, 'users');
      assert.equal(error.details.store, 'missingStore');
      assert.deepEqual(error.details.availableStores, [
        'json',
        'memory',
        'sourceFile',
        'static',
        'analytics',
      ]);
      assert.doesNotMatch(error.message, /adapter/i);
      return true;
    },
  );
});

test('custom store fallback serializes concurrent writes per resource', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `const values = new Map();
const delay = () => new Promise((resolve) => setTimeout(resolve, 5));

export default {
  stores: {
    default: 'queued',
    queued: {
      async hydrate(resources) {
        for (const resource of resources) {
          values.set(resource.name, structuredClone(resource.seed));
        }
      },
      async readResource(resource, fallback) {
        await delay();
        return structuredClone(values.get(resource.name) ?? fallback);
      },
      async writeResource(resource, value) {
        await delay();
        values.set(resource.name, structuredClone(value));
      }
    }
  }
};`);

  const db = await openJsonFixtureDb({ cwd });
  await Promise.all([
    db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' }),
    db.collection('users').create({ id: 'u_3', name: 'Katherine Johnson' }),
    db.collection('users').create({ id: 'u_4', name: 'Margaret Hamilton' }),
  ]);

  assert.deepEqual((await db.collection('users').all()).map((user) => user.id), [
    'u_1',
    'u_2',
    'u_3',
    'u_4',
  ]);
});

test('db.close calls custom store close hooks once', async () => {
  const cwd = await makeProject();
  const closeMarker = path.join(cwd, 'store-closed.txt');
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `import { writeFileSync } from 'node:fs';

const values = new Map();
let closeCount = 0;

export default {
  stores: {
    default: 'closable',
    closable: {
      hydrate(resources) {
        for (const resource of resources) {
          values.set(resource.name, structuredClone(resource.seed));
        }
      },
      readResource(resource, fallback) {
        return structuredClone(values.get(resource.name) ?? fallback);
      },
      writeResource(resource, value) {
        values.set(resource.name, structuredClone(value));
      },
      close() {
        closeCount += 1;
        writeFileSync(${JSON.stringify(closeMarker)}, String(closeCount));
      }
    }
  }
};`);

  const db = await openJsonFixtureDb({ cwd });
  await db.collection('users').all();
  await db.close();
  await db.close();

  assert.equal(await readFile(closeMarker, 'utf8'), '1');
});

test('failed custom store writes do not emit runtime events', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `const values = new Map();

export default {
  stores: {
    default: 'failing',
    failing: {
      hydrate(resources) {
        for (const resource of resources) {
          values.set(resource.name, structuredClone(resource.seed));
        }
      },
      readResource(resource, fallback) {
        return structuredClone(values.get(resource.name) ?? fallback);
      },
      writeResource() {
        throw new Error('custom write failed');
      }
    }
  }
};`);

  const db = await openJsonFixtureDb({ cwd });
  const events = [];
  const unsubscribe = db.events.subscribe((event) => {
    events.push(event);
  });

  await assert.rejects(
    () => db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' }),
    /custom write failed/,
  );
  unsubscribe();

  assert.deepEqual(events, []);
});

test('static store resources are readable and reject writes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));
  await writeConfig(cwd, `export default {
    resources: {
      settings: {
        store: 'static'
      }
    }
  };`);

  const db = await openJsonFixtureDb({ cwd });

  assert.deepEqual(await db.document('settings').all(), { theme: 'light' });
  await assert.rejects(
    () => db.document('settings').update({ theme: 'dark' }),
    (error) => {
      assert.equal(error.code, 'STORE_RESOURCE_READ_ONLY');
      assert.match(error.message, /settings/);
      return true;
    },
  );
});

test('store runtime emits live events only after successful writes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));

  const db = await openJsonFixtureDb({ cwd });
  const events = [];
  const unsubscribe = db.events.subscribe((event) => {
    events.push(event);
  });

  await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });
  await assert.rejects(() => db.collection('users').create({ id: 'u_2', name: 'Duplicate' }));
  unsubscribe();

  assert.equal(events.length, 1);
  assert.equal(events[0].resource, 'users');
  assert.equal(events[0].kind, 'collection');
  assert.equal(events[0].op, 'create');
  assert.equal(events[0].id, 'u_2');
  assert.equal(events[0].version, 1);
  assert.match(events[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('sourceFile store writes plain JSON fixture while json store remains default', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `export default {
    resources: {
      settings: {
        store: 'sourceFile'
      }
    }
  };`);

  const db = await openJsonFixtureDb({ cwd });
  await db.document('settings').update({ theme: 'dark' });
  await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });

  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'db/settings.json'), 'utf8')), {
    theme: 'dark',
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/users.json'), 'utf8')), [
    { id: 'u_1', name: 'Ada Lovelace' },
    { id: 'u_2', name: 'Grace Hopper' },
  ]);
  await assert.rejects(
    () => access(path.join(cwd, '.jsondb/state/settings.json')),
    { code: 'ENOENT' },
  );
  assert.equal(JSON.parse(await readFile(path.join(cwd, '.jsondb/schema.generated.json'), 'utf8')).resources.settings.kind, 'document');
});

test('sourceFile store rejects non-JSON source resources with structured diagnostics', async () => {
  const cases = [
    {
      filename: 'users.jsonc',
      body: `[
        { "id": "u_1", "name": "Ada Lovelace" },
      ]`,
      dataFormat: 'jsonc',
    },
    {
      filename: 'users.csv',
      body: 'id,name\nu_1,Ada Lovelace\n',
      dataFormat: 'csv',
    },
  ];

  for (const fixture of cases) {
    const cwd = await makeProject();
    await writeFixture(cwd, fixture.filename, fixture.body);
    await writeConfig(cwd, `export default {
      resources: {
        users: {
          store: 'sourceFile'
        }
      }
    };`);

    await assert.rejects(
      () => openJsonFixtureDb({ cwd }),
      (error) => {
        assert.equal(error.code, 'STORE_SOURCE_NOT_WRITABLE');
        assert.match(error.message, /sourceFile/);
        assert.equal(error.details.resource, 'users');
        assert.equal(error.details.dataFormat, fixture.dataFormat);
        assert.match(error.hint, /store "sourceFile"/);
        return true;
      },
    );
  }
});
