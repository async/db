import { generatedHeader } from './header.js';

export function renderRestRoutes(): string {
  return `${generatedHeader()}
import type { Hono } from 'hono';
import type { DbRepository } from './repository.js';
import { resources } from './schema.js';

export function registerDbRoutes(app: Hono, repository: DbRepository) {
  for (const [resourceName, resource] of Object.entries<any>(resources)) {
    if (resource.kind === 'collection') {
      app.get(resource.routePath, async (c) => c.json(await repository.collection(resourceName).all()));
      app.get(resource.routePath + '/:id', async (c) => {
        const record = await repository.collection(resourceName).get(c.req.param('id'));
        return record ? c.json(record) : c.json({ error: 'Not found' }, 404);
      });
      app.post(resource.routePath, async (c) => {
        const record = await repository.collection(resourceName).create(await c.req.json());
        return c.json(record, 201);
      });
      app.patch(resource.routePath + '/:id', async (c) => {
        const record = await repository.collection(resourceName).patch(c.req.param('id'), await c.req.json());
        return record ? c.json(record) : c.json({ error: 'Not found' }, 404);
      });
      app.delete(resource.routePath + '/:id', async (c) => {
        const deleted = await repository.collection(resourceName).delete(c.req.param('id'));
        return deleted ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
      });
    } else {
      app.get(resource.routePath, async (c) => c.json(await repository.document(resourceName).all()));
      app.put(resource.routePath, async (c) => c.json(await repository.document(resourceName).put(await c.req.json())));
      app.patch(resource.routePath, async (c) => c.json(await repository.document(resourceName).patch(await c.req.json())));
    }
  }
}
`;
}
