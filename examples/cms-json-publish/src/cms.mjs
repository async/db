import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '@async/db';

export function createCms(db, { tenantId }) {
  return {
    async setup() {
      await db.forks.create(tenantId, {
        from: 'main',
        kind: 'tenant',
        metadata: {
          app: 'cms-json-publish',
        },
      });
      const tenant = db.fork(tenantId);
      await tenant.branches.create('draft', { from: 'main', kind: 'draft' });
      await tenant.branches.create('published', { from: 'main', kind: 'published' });
    },

    async saveDraft(pageId, changes) {
      const tenant = db.fork(tenantId);
      const draft = tenant.branch('draft');
      return draft.collection('pages').patch(pageId, {
        ...changes,
        status: 'draft',
        updatedAt: new Date().toISOString(),
      });
    },

    async createPreview(previewId) {
      const tenant = db.fork(tenantId);
      await tenant.branches.create(previewId, {
        from: 'draft',
        kind: 'preview',
      });

      return tenant.branch(previewId);
    },

    async publish({ label = 'publish' } = {}) {
      const tenant = db.fork(tenantId);
      const draft = tenant.branch('draft');
      const published = tenant.branch('published');
      const snapshot = await draft.snapshots.create({
        label,
        resources: ['pages', 'navigation'],
      });
      const pages = await draft.collection('pages').all();
      const publicPages = pages
        .filter((page) => page.status === 'published')
        .map(({ id, slug, title, status, summary, bodyMarkdown }) => ({
          id,
          slug,
          title,
          status,
          summary,
          bodyMarkdown,
        }));

      await published.collection('pages').replaceAll(publicPages);
      await published.collection('navigation').replaceAll(await draft.collection('navigation').all());

      return {
        snapshot,
        publicPages,
      };
    },

    async listPublishedPages() {
      const tenant = db.fork(tenantId);
      return tenant.branch('published').collection('pages').all();
    },
  };
}

async function main() {
  const db = await openDb({
    cwd: new URL('../', import.meta.url).pathname,
  });
  const cms = createCms(db, { tenantId: 'tenant_acme' });

  await cms.setup();
  await cms.saveDraft('roadmap', {
    title: 'Private roadmap',
  });
  await cms.createPreview('preview_homepage');
  const { publicPages } = await cms.publish({ label: 'initial-public-json' });

  assert.deepEqual(publicPages.map((page) => page.slug), ['home']);
  assert.deepEqual(await cms.listPublishedPages(), [
      {
        id: 'home',
        slug: 'home',
        title: 'Home',
        status: 'published',
        summary: 'Public home page',
        bodyMarkdown: '# Home',
      },
  ]);

  await db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
