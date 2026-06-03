import { createLocalWebAppRuntime } from './server/runtime.js';

/** @param {{ cwd: string; basePath?: string; url: string }} context */
export async function createExampleRuntime(context) {
  const { cwd, basePath, url, repoRoot } = context;
  const runtime = await createLocalWebAppRuntime({
    cwd,
    basePath,
    repoRoot,
  });

  return {
    ...runtime,
    viewerUrl: `${url}/__db`,
    demoUrl: `${url}/`,
    demoLinks: [
      { label: 'App', href: '/' },
    ],
  };
}
