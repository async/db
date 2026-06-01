import { startDbServer } from '../../server.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printServeHelp } from '../output.js';

type CliConfig = {
  server?: {
    host?: string;
    port?: string | number;
  };
  [key: string]: unknown;
};

export async function runServe(config: CliConfig, args: string[]): Promise<never | void> {
  if (isHelpRequested(args)) {
    printServeHelp();
    return;
  }

  const host = valueAfter(args, '--host') ?? config.server.host;
  const port = valueAfter(args, '--port') ?? config.server.port;
  const { url } = await startDbServer({
    ...config,
    host,
    port,
  });
  console.log(`db server listening at ${url}`);
  return new Promise(() => {});
}
