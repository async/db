/**
 * Examples launcher hook — mounted by `scripts/serve-examples.js` when present.
 * Keeps db REST / `/__db` wiring local to this example.
 */
import { createSchemaUiRuntime } from './src/start-schema-ui-server.js';

/** @param {{ cwd: string; url: string; repoRoot: string }} context */
export async function createExampleRuntime(context) {
  const { cwd, basePath, url } = context;
  const runtime = await createSchemaUiRuntime({
    cwd,
    basePath,
    skipSync: false,
  });

  return {
    ...runtime,
    viewerUrl: `${url}/__db`,
    demoUrl: `${url}/`,
    demoLinks: [
      { label: 'Static templates', href: '/templates' },
    ],
  };
}
