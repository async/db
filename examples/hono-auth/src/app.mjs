import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '@async/db';
import { registerDbRoutes } from '@async/db/hono';

const exampleRoot = fileURLToPath(new URL('..', import.meta.url));

export const demoAuthorizationHeaders = {
  admin: 'Bearer admin-token',
  user: 'Bearer user-token',
};

const demoSessions = new Map([
  [authorizationToken(demoAuthorizationHeaders.admin), { userId: 'u_admin', role: 'admin' }],
  [authorizationToken(demoAuthorizationHeaders.user), { userId: 'u_user', role: 'user' }],
]);

export async function createApp(options = {}) {
  const { Hono } = await import('hono');
  const app = new Hono();
  const db = options.db ?? await openDb({
    cwd: options.cwd ?? path.resolve(exampleRoot),
  });

  registerDbRoutes(app, db, {
    prefix: '/api',
    resources: ['pages', 'users'],
    lifecycleHooks: {
      beforeRequest(ctx) {
        const session = sessionFromAuthorizationHeader(ctx.c.req.header('authorization'));
        if (!session) {
          return ctx.c.json({ error: 'Unauthorized' }, 401);
        }
        ctx.c.set('session', session);
      },
      beforeWrite(ctx) {
        const session = ctx.c.get('session');
        if (session?.role !== 'admin') {
          return ctx.c.json({ error: 'Forbidden' }, 403);
        }
        normalizeWriteBody(ctx.body);
      },
    },
    resourceOptions: {
      pages: {
        hooks: {
          beforeCreate(ctx) {
            ctx.body.createdAt ??= ctx.body.updatedAt;
          },
        },
      },
    },
  });

  return app;
}

export function sessionFromAuthorizationHeader(header) {
  return demoSessions.get(authorizationToken(header)) ?? null;
}

function authorizationToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header ?? ''));
  return match?.[1] ?? null;
}

function normalizeWriteBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return;
  }

  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      body[key] = value.trim();
    }
  }

  body.updatedAt = new Date().toISOString();
}
