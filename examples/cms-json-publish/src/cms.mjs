import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '@async/db';

export function createCms(db, { tenantId }) {
  return {
    async setup() {
      const tenant = await db.forks.ensure(tenantId, {
        from: 'main',
        metadata: {
          purpose: 'tenant',
          app: 'cms-json-publish',
        },
      });
      await tenant.branches.ensure('draft', { from: 'main', metadata: { purpose: 'draft' } });
      await tenant.branches.ensure('published', { from: 'main', metadata: { purpose: 'published' } });
    },

    async saveDraft(pageId, changes) {
      const tenant = await db.forks.open(tenantId);
      const draft = await tenant.branches.open('draft');
      return draft.collection('pages').patch(pageId, {
        ...changes,
        status: 'draft',
        updatedAt: new Date().toISOString(),
      });
    },

    async createPreview(previewId) {
      const tenant = await db.forks.open(tenantId);
      return tenant.branches.create(previewId, {
        from: 'draft',
        metadata: { purpose: 'preview' },
      });
    },

    async publish({ label = 'publish' } = {}) {
      const tenant = await db.forks.open(tenantId);
      const draft = await tenant.branches.open('draft');
      const published = await tenant.branches.open('published');
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
      const tenant = await db.forks.open(tenantId);
      const published = await tenant.branches.open('published');
      return published.collection('pages').all();
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
