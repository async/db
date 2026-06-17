import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadConfig as typedLoadConfig, openDb as typedOpenDb, syncDb as typedSyncDb } from '../src/index.js';
import { makeProject, writeConfig } from './helpers.js';

const loadConfig = async (options: unknown): Promise<any> => typedLoadConfig(options as never) as Promise<any>;
const syncDb = async (...args: any[]): Promise<any> => typedSyncDb(args[0] as never, args[1] as never) as Promise<any>;
const openDb = async (options: unknown): Promise<any> => typedOpenDb(options as never) as Promise<any>;

test('gitFiles syncs GitHub snapshot records into the JSON mirror', async () => {
  const cwd = await gitProject();
  await writeConfig(cwd, `import { defineConfig } from '@async/db/config';
import { githubRemote } from '@async/db/git';

export default defineConfig({
  git: {
    remotes: {
      content: githubRemote({
        repo: 'acme/site-content',
        branch: 'main',
        mode: 'token',
        token: 'redacted-test-token',
        snapshot: [
          {
            path: 'content/posts/launch.mdx',
            content: '---\\ntitle: "Launch"\\nstatus: published\\n---\\nHello from Git.'
          }
        ]
      })
    }
  },
  outputs: {
    schemaManifest: './src/generated/db.schema.json'
  },
  graphql: { enabled: true }
});`);
  await mkdir(path.join(cwd, 'db/posts'), { recursive: true });
  await writeFile(path.join(cwd, 'db/posts/index.schema.js'), `import { collection, field } from '@async/db/schema';
import { gitFiles } from '@async/db/git';

export default collection({
  source: gitFiles('content/posts/{id}.mdx', {
    remote: 'content',
    read: 'frontmatter',
    bodyField: 'body'
  }),
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    status: field.enum(['draft', 'published'], { default: 'draft' }),
    body: field.string({ required: true })
  }
});
`, 'utf8');

  const config = await loadConfig({ cwd });
  const result = await syncDb(config);
  const state = JSON.parse(await readFile(path.join(cwd, '.db/state/posts.json'), 'utf8'));
  const generated = JSON.parse(await readFile(path.join(cwd, '.db/schema.generated.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(cwd, 'src/generated/db.schema.json'), 'utf8'));
  const generatedText = await readFile(path.join(cwd, '.db/schema.generated.json'), 'utf8');

  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  assert.deepEqual(state, [
    {
      id: 'launch',
      title: 'Launch',
      status: 'published',
      body: 'Hello from Git.',
    },
  ]);
  assert.equal(generated.resources.posts.source.definition.kind, 'git-files');
  assert.equal(generated.resources.posts.source.definition.remote, 'content');
  assert.deepEqual(generated.resources.posts.source.definition.patterns, ['content/posts/{id}.mdx']);
  assert.equal(manifest.collections.posts.source.remote, 'content');
  assert.equal(generatedText.includes('redacted-test-token'), false);

  const db = await openDb({ cwd, syncOnOpen: false });
  await db.runtime.hydrate();
  await assert.rejects(
    () => db.collection('posts').create({
      id: 'draft',
      title: 'Draft',
      body: 'Draft',
    }),
    (error: any) => error.code === 'GIT_WRITE_DRIVER_REQUIRED',
  );
  await db.close();
});

test('gitFile and gitCollectionFile parse singleton and collection JSON snapshots', async () => {
  const cwd = await gitProject();
  await writeConfig(cwd, `import { defineConfig } from '@async/db/config';
import { githubRemote } from '@async/db/git';

export default defineConfig({
  git: {
    remotes: {
      content: githubRemote({
        repo: 'acme/site-content',
        branch: 'main',
        mode: 'token',
        snapshot: [
          { path: 'content/site.json', content: '{"title":"Acme","theme":"light"}' },
          { path: 'content/authors.json', content: '[{"id":"ada","name":"Ada"},{"id":"grace","name":"Grace"}]' }
        ]
      })
    }
  }
});`);
  await writeFile(path.join(cwd, 'db/site.schema.js'), `import { document, field } from '@async/db/schema';
import { gitFile } from '@async/db/git';

export default document({
  source: gitFile('content/site.json', {
    remote: 'content',
    read: 'json'
  }),
  fields: {
    title: field.string({ required: true }),
    theme: field.string()
  }
});
`, 'utf8');
  await writeFile(path.join(cwd, 'db/authors.schema.js'), `import { collection, field } from '@async/db/schema';
import { gitCollectionFile } from '@async/db/git';

export default collection({
  source: gitCollectionFile('content/authors.json', {
    remote: 'content',
    read: 'json'
  }),
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    name: field.string({ required: true })
  }
});
`, 'utf8');

  const config = await loadConfig({ cwd });
  await syncDb(config);

  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/site.json'), 'utf8')), {
    title: 'Acme',
    theme: 'light',
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.db/state/authors.json'), 'utf8')), [
    { id: 'ada', name: 'Ada' },
    { id: 'grace', name: 'Grace' },
  ]);
});

test('git source diagnostics report missing remote aliases', async () => {
  const cwd = await gitProject();
  await writeConfig(cwd, `import { defineConfig } from '@async/db/config';

export default defineConfig({
  git: {
    remotes: {}
  }
});`);
  await writeFile(path.join(cwd, 'db/posts.schema.js'), `import { collection, field } from '@async/db/schema';
import { gitFiles } from '@async/db/git';

export default collection({
  source: gitFiles('content/posts/{id}.mdx', {
    remote: 'missing',
    read: 'frontmatter'
  }),
  fields: {
    id: field.string({ required: true }),
    title: field.string()
  }
});
`, 'utf8');

  const config = await loadConfig({ cwd });
  await assert.rejects(
    () => syncDb(config),
    (error: any) => {
      assert.equal(error.diagnostics.some((diagnostic: any) => diagnostic.code === 'GIT_REMOTE_NOT_FOUND'), true);
      return true;
    },
  );
});

test('sqliteMirror becomes the default runtime mirror for Git-backed resources', async (t) => {
  const cwd = await gitProject();
  await writeConfig(cwd, `import { defineConfig } from '@async/db/config';
import { githubRemote } from '@async/db/git';
import { sqliteMirror } from '@async/db/sqlite';

export default defineConfig({
  git: {
    remotes: {
      content: githubRemote({
        repo: 'acme/site-content',
        mode: 'token',
        snapshot: [
          { path: 'content/authors/ada.json', content: '{"name":"Ada"}' }
        ]
      })
    },
    mirror: sqliteMirror({
      file: './.db/git-mirror.sqlite',
      writes: 'through'
    })
  }
});`);
  await mkdir(path.join(cwd, 'db/authors'), { recursive: true });
  await writeFile(path.join(cwd, 'db/authors/index.schema.js'), `import { collection, field } from '@async/db/schema';
import { gitFiles } from '@async/db/git';

export default collection({
  source: gitFiles('content/authors/{id}.json', {
    remote: 'content',
    read: 'json'
  }),
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    name: field.string({ required: true })
  }
});
`, 'utf8');

  let db;
  try {
    db = await openDb({ cwd });
  } catch (error) {
    if (String((error as Error).message).includes('node:sqlite')) {
      t.skip('node:sqlite is not available in this runtime');
      return;
    }
    throw error;
  }

  assert.equal(db.runtime.strategyFor(db.resources.get('authors')), 'gitMirror');
  assert.deepEqual(await db.collection('authors').all(), [
    { id: 'ada', name: 'Ada' },
  ]);
  await db.collection('authors').create({
    id: 'grace',
    name: 'Grace',
  });
  assert.deepEqual(await db.collection('authors').all(), [
    { id: 'ada', name: 'Ada' },
    { id: 'grace', name: 'Grace' },
  ]);
  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(path.join(cwd, '.db/git-mirror.sqlite'), { open: true, readOnly: true });
  try {
    const row = sqlite.prepare('SELECT COUNT(*) AS count FROM "_db_git_outbox" WHERE resource = ?').get('authors') as { count: number };
    assert.equal(row.count, 1);
  } finally {
    sqlite.close();
  }
  assert.deepEqual(await db._.git.pending(), []);
  assert.deepEqual(await db._.git.flush(), {
    flushed: 0,
    receipts: [],
    mode: 'through',
  });
  await db.close();
});

async function gitProject(): Promise<string> {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8');
  return cwd;
}
