import { createDbClient } from '@async/db/client';

const baseUrl = process.env.ASYNC_DB_URL ?? 'http://127.0.0.1:7331';
const db = createDbClient({
  baseUrl,
  batching: true,
});

const users = await db.rest.get('/db/users.json', { batch: false });
const settings = await db.rest.get('/db/settings.json', { batch: false });
const batch = await db.rest.batch([
  { method: 'GET', path: '/db/users.json?select=id,name' },
  { method: 'GET', path: '/db/settings.json' },
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
