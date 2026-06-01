import path from 'node:path';
import { dbError } from '../../errors.js';
import { loadProjectSchema } from '../../schema.js';
import { generateViewerManifest } from '../../viewer-manifest.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printViewerHelp } from '../output.js';

type CliConfig = {
  cwd?: string;
  [key: string]: unknown;
};

export async function runViewer(config: CliConfig, args: string[]): Promise<void> {
  if (isHelpRequested(args)) {
    printViewerHelp();
    return;
  }

  if (args[0] !== 'manifest') {
    throw dbError(
      'VIEWER_UNKNOWN_COMMAND',
      `Unknown viewer command "${args[0] ?? ''}".`,
      {
        hint: 'Use async-db viewer manifest [--out <file>].',
      },
    );
  }

  const project = await loadProjectSchema(config);
  const result = await generateViewerManifest(config, {
    project,
    outFile: valueAfter(args, '--out'),
  });

  if (result.outFiles.length === 0) {
    console.log(result.content);
    return;
  }

  for (const filePath of result.outFiles) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
}
