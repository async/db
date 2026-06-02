import { generatedHeader } from './header.js';

type HonoGraphqlProject = {
  schema: {
    graphql?: string;
  };
};

export function renderGraphqlRoutes(project: HonoGraphqlProject): string {
  return `${generatedHeader()}
import type { Hono } from 'hono';
import { executeGraphql } from '@async/db';
import type { DbRepository } from './repository.js';

const graphqlSdl = ${JSON.stringify(project.schema.graphql)};

export function registerGraphqlRoutes(app: Hono, repository: DbRepository, path = '/graphql') {
  app.get(path, (c) => c.text(graphqlSdl));
  app.post(path, async (c) => executeGraphql(createDbFacade(repository), await c.req.json()).then((result) => c.json(result)));
}

function createDbFacade(repository: DbRepository) {
  return {
    resources: new Map(Object.entries(repository.resources)),
    collection(name: string) {
      return repository.collection(name);
    },
    document(name: string) {
      const document = repository.document(name);
      return {
        all: () => document.all(),
        update: (patch: Record<string, unknown>) => document.patch(patch),
        put: (value: Record<string, unknown>) => document.put(value),
        async set(pointer: string, value: unknown) {
          const current = await document.all();
          setPointer(current, pointer, value);
          await document.put(current);
          return value;
        },
      };
    },
  };
}

function setPointer(document: Record<string, unknown>, pointer: string, value: unknown) {
  const parts = pointer.split('/').slice(1).map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current: Record<string, unknown> = document;
  while (parts.length > 1) {
    const part = parts.shift() as string;
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[0] || ''] = value;
}
`;
}
