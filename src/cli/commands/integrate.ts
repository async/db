import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  inspectSqliteIntegration,
  normalizeIntegrationReportForCheck,
  writeIntegrationReport,
  type SqliteIntegrationReport,
} from '../../features/integrate/sqlite-inspector.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printIntegrateHelp, printIntegrationReport } from '../output.js';

type CliConfig = {
  cwd?: string;
  [key: string]: unknown;
};

export async function runIntegrate(config: CliConfig, args: string[]): Promise<void> {
  if (isHelpRequested(args)) {
    printIntegrateHelp();
    return;
  }

  if (args[0] !== 'inspect') {
    throw new Error('Unknown integrate command. Use async-db integrate inspect.');
  }

  const cwd = path.resolve(config.cwd ?? process.cwd());
  const inspectArgs = args.slice(1);
  const sqliteFile = valueAfter(inspectArgs, '--sqlite');
  if (!sqliteFile) {
    throw new Error('async-db integrate inspect requires --sqlite <file>.');
  }

  const outFile = valueAfter(inspectArgs, '--out');
  const checkFile = valueAfter(inspectArgs, '--check');
  const report = await inspectSqliteIntegration({
    cwd,
    target: scanTarget(inspectArgs),
    sqliteFile,
    ignorePaths: [outFile, checkFile].filter((filePath): filePath is string => Boolean(filePath)),
  });

  if (checkFile) {
    await checkIntegrationReport(cwd, checkFile, report);
    console.log(`Integration report matches ${relativeOutputPath(cwd, resolveOutputPath(cwd, checkFile))}`);
  }

  if (outFile) {
    const resolved = resolveOutputPath(cwd, outFile);
    await writeIntegrationReport(resolved, report);
    console.log(`Generated ${relativeOutputPath(cwd, resolved)}`);
  }

  if (inspectArgs.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (!outFile && !checkFile) {
    printIntegrationReport(report);
  }
}

async function checkIntegrationReport(cwd: string, filePath: string, report: SqliteIntegrationReport): Promise<void> {
  const resolved = resolveOutputPath(cwd, filePath);
  const current = JSON.parse(await readFile(resolved, 'utf8') as string) as SqliteIntegrationReport;
  if (JSON.stringify(normalizeIntegrationReportForCheck(current)) === JSON.stringify(normalizeIntegrationReportForCheck(report))) {
    return;
  }

  const error = new Error(`Integration report check failed for ${relativeOutputPath(cwd, resolved)}. Run async-db integrate inspect --sqlite <file> --out ${filePath} to update it.`) as Error & {
    code?: string;
  };
  error.code = 'INTEGRATION_REPORT_CHECK_FAILED';
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
