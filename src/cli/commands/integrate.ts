import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  inspectSqliteIntegration,
  normalizeIntegrationReportForCheck,
  renderSqliteImporter,
  writeIntegrationReport,
  type SqliteIntegrationReport,
} from '../../features/integrate/sqlite-inspector.js';
import {
  inspectPostgresIntegration,
  normalizePostgresIntegrationReportForCheck,
  renderPostgresImporter,
  type PostgresIntegrationReport,
} from '../../features/integrate/postgres-inspector.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printIntegrateHelp, printIntegrationReport } from '../output.js';

type CliConfig = {
  cwd?: string;
  [key: string]: unknown;
};

export async function runIntegrate(config: CliConfig, args: string[]): Promise<void> {
  const cwd = path.resolve(config.cwd ?? process.cwd());

  if (isHelpRequested(args)) {
    printIntegrateHelp();
    return;
  }

  if (args[0] === 'generate' && args[1] === 'importer') {
    await generateImporter(cwd, args.slice(2));
    return;
  }

  if (args[0] !== 'inspect') {
    throw new Error('Unknown integrate command. Use async-db integrate inspect or async-db integrate generate importer.');
  }

  const inspectArgs = args.slice(1);
  const sqliteFile = valueAfter(inspectArgs, '--sqlite');
  const isPostgres = inspectArgs.includes('--postgres');
  if (sqliteFile && isPostgres) {
    throw new Error('async-db integrate inspect accepts either --sqlite <file> or --postgres, not both.');
  }
  if (!sqliteFile && !isPostgres) {
    throw new Error('async-db integrate inspect requires --sqlite <file> or --postgres.');
  }

  const outFile = valueAfter(inspectArgs, '--out');
  const checkFile = valueAfter(inspectArgs, '--check');
  const targetState = valueAfter(inspectArgs, '--target-state');
  const report = sqliteFile
    ? await inspectSqliteIntegration({
      cwd,
      target: scanTarget(inspectArgs),
      sqliteFile,
      targetState,
      ignorePaths: [outFile, checkFile].filter((filePath): filePath is string => Boolean(filePath)),
    })
    : await inspectPostgresIntegration({
      cwd,
      target: scanTarget(inspectArgs),
      postgresUrlEnv: valueAfter(inspectArgs, '--postgres-url-env'),
      schemas: csvValues(valueAfter(inspectArgs, '--schema')),
      targetState,
      targetPostgresTable: valueAfter(inspectArgs, '--target-postgres-table'),
      exactRowCounts: inspectArgs.includes('--exact-row-counts'),
      allowPartial: inspectArgs.includes('--allow-partial'),
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

async function generateImporter(cwd: string, args: string[]): Promise<void> {
  const planFile = valueAfter(args, '--plan');
  const outFile = valueAfter(args, '--out');
  if (!planFile) {
    throw new Error('async-db integrate generate importer requires --plan <report.json>.');
  }
  if (!outFile) {
    throw new Error('async-db integrate generate importer requires --out <file>.');
  }
  const report = JSON.parse(await readFile(resolveOutputPath(cwd, planFile), 'utf8') as string) as IntegrationReport;
  const rendered = report.importPlan?.kind === 'postgres.importPlan'
    ? renderPostgresImporter(report as PostgresIntegrationReport)
    : renderSqliteImporter(report as SqliteIntegrationReport);
  const resolved = resolveOutputPath(cwd, outFile);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, rendered, 'utf8');
  console.log(`Generated ${relativeOutputPath(cwd, resolved)}`);
}

type IntegrationReport = SqliteIntegrationReport | PostgresIntegrationReport;

async function checkIntegrationReport(cwd: string, filePath: string, report: IntegrationReport): Promise<void> {
  const resolved = resolveOutputPath(cwd, filePath);
  const current = JSON.parse(await readFile(resolved, 'utf8') as string) as IntegrationReport;
  if (JSON.stringify(normalizeReportForCheck(current)) === JSON.stringify(normalizeReportForCheck(report))) {
    return;
  }

  const error = new Error(`Integration report check failed for ${relativeOutputPath(cwd, resolved)}. Run async-db integrate inspect with the same flags and --out ${filePath} to update it.`) as Error & {
    code?: string;
  };
  error.code = 'INTEGRATION_REPORT_CHECK_FAILED';
  throw error;
}

function normalizeReportForCheck(report: IntegrationReport): unknown {
  return 'postgres' in report
    ? normalizePostgresIntegrationReportForCheck(report)
    : normalizeIntegrationReportForCheck(report);
}

function scanTarget(args: string[]): string | undefined {
  return args.find((arg, index) => (
    index === 0
    && !arg.startsWith('-')
  ));
}

function csvValues(value: string | undefined): string[] | undefined {
  return value?.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function resolveOutputPath(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
}

function relativeOutputPath(cwd: string, filePath: string): string {
  return path.relative(cwd, filePath).split(path.sep).join('/');
}
