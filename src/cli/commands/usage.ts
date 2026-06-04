import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeUsageManifestForCheck,
  scanDbUsage,
  writeUsageManifest,
  type UsageManifest,
} from '../../features/usage/scanner.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printUsageHelp, printUsageResult } from '../output.js';

type CliConfig = {
  cwd?: string;
  [key: string]: unknown;
};

export async function runUsage(config: CliConfig, args: string[]): Promise<void> {
  if (isHelpRequested(args)) {
    printUsageHelp();
    return;
  }

  if (args[0] !== 'scan') {
    throw new Error('Unknown usage command. Use async-db usage scan.');
  }

  const cwd = path.resolve(config.cwd ?? process.cwd());
  const scanArgs = args.slice(1);
  const outFile = valueAfter(scanArgs, '--out');
  const checkFile = valueAfter(scanArgs, '--check');
  const manifest = await scanDbUsage({
    cwd,
    target: scanTarget(scanArgs),
    ignorePaths: [outFile, checkFile].filter((filePath): filePath is string => Boolean(filePath)),
    production: scanArgs.includes('--production'),
  });

  if (checkFile) {
    await checkUsageManifest(cwd, checkFile, manifest);
    console.log(`Usage manifest matches ${relativeOutputPath(cwd, resolveOutputPath(cwd, checkFile))}`);
  }

  if (outFile) {
    const resolved = resolveOutputPath(cwd, outFile);
    await writeUsageManifest(resolved, manifest);
    console.log(`Generated ${relativeOutputPath(cwd, resolved)}`);
  }

  if (scanArgs.includes('--json')) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (!outFile && !checkFile) {
    printUsageResult(manifest);
  }
}

async function checkUsageManifest(cwd: string, filePath: string, manifest: UsageManifest): Promise<void> {
  const resolved = resolveOutputPath(cwd, filePath);
  const current = JSON.parse(await readFile(resolved, 'utf8') as string) as UsageManifest;
  if (JSON.stringify(normalizeUsageManifestForCheck(current)) === JSON.stringify(normalizeUsageManifestForCheck(manifest))) {
    return;
  }

  const error = new Error(`Usage manifest check failed for ${relativeOutputPath(cwd, resolved)}. Run async-db usage scan --out ${filePath} to update it.`) as Error & {
    code?: string;
  };
  error.code = 'USAGE_MANIFEST_CHECK_FAILED';
  throw error;
}

function scanTarget(args: string[]): string | undefined {
  return args.find((arg, index) => (
    index === 0
    && !arg.startsWith('-')
  ));
}

function resolveOutputPath(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
}

function relativeOutputPath(cwd: string, filePath: string): string {
  return path.relative(cwd, filePath).split(path.sep).join('/');
}
