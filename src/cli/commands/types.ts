import { watch } from 'node:fs';
import path from 'node:path';
import { loadProjectSchema } from '../../schema.js';
import { generateTypes } from '../../types.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printDiagnostic, printTypesHelp } from '../output.js';

type CliConfig = {
  cwd?: string;
  sourceDir?: string;
  [key: string]: unknown;
};

export async function runTypes(config: CliConfig, args: string[]): Promise<never | void> {
  if (isHelpRequested(args)) {
    printTypesHelp();
    return;
  }

  if (args.includes('--watch')) {
    await runTypesOnce(config, args);
    console.log(`Watching ${path.relative(config.cwd, config.sourceDir) || '.'}`);
    watch(config.sourceDir, { recursive: true }, async () => {
      try {
        await runTypesOnce(config, args);
      } catch (error) {
        console.error((error as Error).message);
      }
    });
    return new Promise(() => {});
  }

  await runTypesOnce(config, args);
}

async function runTypesOnce(config: CliConfig, args: string[]): Promise<void> {
  const outFile = valueAfter(args, '--out');
  const project = await loadProjectSchema(config);
  const result = await generateTypes(config as never, { project, outFile });

  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic as never);
  }

  for (const filePath of result.outFiles) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
}
