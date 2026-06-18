import { createDatabaseDashboardRuntime } from './server/runtime.js';

/** @param {{ cwd: string; basePath?: string; url: string; repoRoot: string }} context */
export async function createExampleRuntime(context) {
  const { cwd, basePath, url, repoRoot } = context;
  const runtime = await createDatabaseDashboardRuntime({
    cwd,
    basePath,
    repoRoot,
  });

  return {
    ...runtime,
    viewerUrl: `${url}/__db`,
    demoUrl: `${url}/`,
    demoLinks: [
      { label: 'Dashboard', href: '/' },
    ],
  };
}
