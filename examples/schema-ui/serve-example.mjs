/**
 * Examples launcher hook — mounted by `scripts/serve-examples.js` when present.
 * Keeps JSONDB REST / `/__jsondb` wiring local to this example.
 */
import { startSchemaUiServer } from './src/start-schema-ui-server.mjs';

/** @param {{ cwd: string; host: string; port: number; repoRoot: string }} context */
export async function startExampleServer(context) {
  const { cwd, host, port } = context;

  const app = await startSchemaUiServer({
    cwd,
    host,
    port,
    skipSync: false,
  });

  return {
    ...app,
    viewerUrl: `${app.url}/__jsondb`,
    demoUrl: `${app.url}/`,
    demoLinks: [
      { label: 'Static templates', href: '/templates' },
    ],
  };
}
