import { serve } from '@hono/node-server';
import { createApp } from './app.mjs';

const port = Number(process.env.PORT ?? 8787);
const app = await createApp();

serve({
  fetch: app.fetch,
  hostname: '127.0.0.1',
  port,
});

console.log(`db Hono auth example: http://127.0.0.1:${port}`);
