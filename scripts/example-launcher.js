import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startJsonDbServer } from '../src/server.js';

/**
 * Launch one example HTTP stack. Uses `serve-example.mjs` when the example ships it;
 * otherwise starts the stock jsondb server for that cwd.
 *
 * Runner code (`serve-examples.js`) owns ports and catalog metadata; examples own how
 * requests are handled by exporting `startExampleServer(context)` from `serve-example.mjs`.
 *
 * @param {{ cwd: string; host: string; port: number; repoRoot: string }} context
 * @returns {Promise<{
 *   server: import('node:http').Server;
 *   db?: object;
 *   url: string;
 *   viewerUrl: string;
 *   demoUrl?: string;
 *   demoLinks?: Array<{ label: string; href: string }>;
 *   starterKind: 'jsondb' | 'custom';
 * }>}
 */
export async function launchExampleHttpStack(context) {
  const { cwd, host, port, repoRoot } = context;
  const hookFsPath = path.join(cwd, 'serve-example.mjs');

  try {
    await access(hookFsPath);
  } catch {
    const app = await startJsonDbServer({
      cwd,
      host,
      port,
      allowSourceErrors: true,
    });

    return {
      starterKind: 'jsondb',
      server: app.server,
      db: app.db,
      url: app.url,
      viewerUrl: `${app.url}/__jsondb`,
      demoUrl: undefined,
      demoLinks: [],
    };
  }

  const hookUrl = `${pathToFileURL(hookFsPath).href}`;
  const mod = await import(hookUrl);

  if (typeof mod.startExampleServer !== 'function') {
    throw new Error(
      `${path.relative(repoRoot, hookFsPath)} must export async function startExampleServer.`,
    );
  }

  const started = await mod.startExampleServer({ cwd, host, port, repoRoot });

  return {
    starterKind: 'custom',
    server: started.server,
    db: started.db,
    url: started.url,
    viewerUrl: started.viewerUrl ?? `${started.url}/__jsondb`,
    demoUrl: started.demoUrl,
    demoLinks: Array.isArray(started.demoLinks) ? started.demoLinks : [],
  };
}
