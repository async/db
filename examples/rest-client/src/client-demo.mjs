import { createDbClient } from '@async/db/client';

const baseUrl = process.env.ASYNC_DB_URL ?? 'http://127.0.0.1:7331';
const db = createDbClient({
  baseUrl,
  batching: true,
});

const users = await db.rest.get('/users?select=id,name,email', { batch: false });
const settings = await db.rest.get('/settings', { batch: false });
const batch = await db.rest.batch([
  { method: 'GET', path: '/users?select=id,name' },
  { method: 'GET', path: '/settings' },
]);

console.log(JSON.stringify({
  baseUrl,
  users: users.body,
  settings: settings.body,
  batch: batch.map((item) => ({
    status: item.status,
    body: item.body,
  })),
}, null, 2));
