import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { suppressNodeSqliteExperimentalWarning } from '../sqlite/node-sqlite-warning.js';

const require = createRequire(import.meta.url);

type SqliteValue = string | number | bigint | Buffer | null;

type SqliteRow = Record<string, SqliteValue>;

type SqliteStatement = {
  get(...values: unknown[]): SqliteRow | undefined;
  all(...values: unknown[]): SqliteRow[];
};

type SqliteDatabase = {
  prepare(sql: string): SqliteStatement;
  close(): void;
};

type DatabaseSyncConstructor = new (file: string, options?: { open?: boolean; readOnly?: boolean }) => SqliteDatabase;

export type IntegrationRecommendationKind =
  | 'direct-resource'
  | 'read-model'
  | 'custom-store'
  | 'app-owned-sql'
  | 'manual-review';

export type IntegrationConfidence = 'high' | 'medium' | 'low';

export type SqliteIntegrationAdoptionPathKind =
  | 'operation-wrapper'
  | 'read-model'
  | 'table-backed-adapter'
  | 'app-owned-sql';

export type SqliteIntegrationSuggestionCode =
  | 'INTEGRATE_KEEP_EXISTING_SQLITE_SOURCE'
  | 'INTEGRATE_WRAP_EXISTING_DB_FACADE'
  | 'INTEGRATE_USE_SQLITE_COMPAT_DRIVER'
  | 'INTEGRATE_IMPORT_TO_ASYNC_DB_STATE'
  | 'INTEGRATE_COMPOUND_KEY_USE_OPERATIONS'
  | 'INTEGRATE_APPEND_ONLY_EVENT_LOG'
  | 'INTEGRATE_QUERY_AGGREGATION_API'
  | 'INTEGRATE_READ_MODEL_FIRST'
  | 'INTEGRATE_SIMPLE_TABLE_ADAPTER_CANDIDATE'
  | 'INTEGRATE_ORM_MANUAL_REVIEW';

export type SqliteIntegrationDriver = 'node:sqlite' | 'better-sqlite3' | 'sqlite3' | 'sqlite';

export type SqliteIntegrationAdoptionPath = {
  kind: SqliteIntegrationAdoptionPathKind;
  sourceOfTruth: 'existing-sqlite';
  asyncDbSurface: 'operations' | 'read-model' | 'table-adapter' | 'app-owned-sql';
  storageMigration: 'not-recommended' | 'optional-later';
  reason: string;
};

export type SqliteIntegrationSuggestion = {
  code: SqliteIntegrationSuggestionCode;
  severity: 'info' | 'warning';
  table: string | null;
  message: string;
  hint: string;
  details: Record<string, unknown>;
};

export type SqliteIntegrationColumn = {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKeyPosition: number;
};

export type SqliteIntegrationIndex = {
  name: string;
  unique: boolean;
  origin: string;
  columns: string[];
};

export type SqliteIntegrationForeignKey = {
  table: string;
  from: string;
  to: string;
  onUpdate: string;
  onDelete: string;
};

export type SqliteIntegrationTable = {
  name: string;
  type: string;
  columns: SqliteIntegrationColumn[];
  primaryKey: string[];
  indexes: SqliteIntegrationIndex[];
  foreignKeys: SqliteIntegrationForeignKey[];
  rowCount: number | null;
  classification: string;
};

export type SqliteIntegrationSourceMatch = {
  kind: string;
  file: string;
  line: number;
  snippet: string;
  confidence: IntegrationConfidence;
};

export type SqliteIntegrationRecommendation = {
  kind: IntegrationRecommendationKind;
  table: string | null;
  confidence: IntegrationConfidence;
  message: string;
  nextStep: string;
  adoptionPath?: SqliteIntegrationAdoptionPath;
  details: Record<string, unknown>;
};

export type SqliteIntegrationImportKeyStrategy =
  | { kind: 'single-primary-key'; field: string }
  | { kind: 'compound-generated-id'; fields: string[]; idField: string }
  | { kind: 'key-value-document'; keyField: string; valueField: string }
  | { kind: 'append-only'; idField?: string };

export type SqliteIntegrationImportResource = {
  resource: string;
  table: string;
  kind: 'collection' | 'document';
  importKind: 'collection' | 'document' | 'append-only';
  primaryKey: string[];
  idField?: string;
  writePolicy?: 'append-only';
  fields: Record<string, {
    type: string;
    required?: boolean;
  }>;
  columns: Record<string, string>;
  keyStrategy: SqliteIntegrationImportKeyStrategy;
  warnings: string[];
};

export type SqliteIntegrationImportPlan = {
  version: 1;
  kind: 'sqlite.importPlan';
  source: {
    sqliteFile: string;
    driver: SqliteIntegrationDriver | null;
  };
  target: {
    stateFile: string;
  };
  resources: SqliteIntegrationImportResource[];
  warnings: string[];
};

export type SqliteIntegrationReport = {
  version: 1;
  kind: 'db.integrationReport';
  generatedAt: string;
  target: {
    path: string;
    kind: 'file' | 'directory';
  };
  sqlite: {
    path: string;
    drivers: {
      detected: SqliteIntegrationDriver[];
      recommended: SqliteIntegrationDriver | null;
      ormDetected: string[];
    };
    tables: SqliteIntegrationTable[];
  };
  source: {
    filesScanned: number;
    filesWithMatches: number;
    matches: SqliteIntegrationSourceMatch[];
  };
  recommendations: SqliteIntegrationRecommendation[];
  suggestions: SqliteIntegrationSuggestion[];
  importPlan?: SqliteIntegrationImportPlan;
  suggestedFiles: Array<{
    path: string;
    purpose: string;
  }>;
  agentInstructions: string[];
};

export type InspectSqliteIntegrationOptions = {
  cwd?: string;
  target?: string;
  sqliteFile: string;
  targetState?: string;
  generatedAt?: string;
  ignorePaths?: string[];
};

const IGNORED_DIRS = new Set([
  '.cache',
  '.db',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.tmp',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const IGNORED_FILES = new Set([
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const SCANNABLE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.sql',
  '.ts',
  '.tsx',
]);

export async function inspectSqliteIntegration(options: InspectSqliteIntegrationOptions): Promise<SqliteIntegrationReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const targetInput = options.target ?? '.';
  const targetPath = path.resolve(cwd, targetInput);
  const sqlitePath = path.isAbsolute(options.sqliteFile)
    ? options.sqliteFile
    : path.resolve(cwd, options.sqliteFile);
  const targetStats = await stat(targetPath);
  const targetKind = targetStats.isDirectory() ? 'directory' : 'file';
  const ignoredPaths = new Set([
    path.resolve(sqlitePath),
    ...(options.ignorePaths ?? []).map((filePath) => path.resolve(cwd, filePath)),
  ]);
  const database = openReadOnlySqlite(sqlitePath);

  try {
    const tables = inspectTables(database);
    const source = await scanSourceUsage(cwd, targetPath, targetKind, ignoredPaths);
    const drivers = detectSqliteDrivers(source.matches);
    const recommendations = buildRecommendations(tables, source.matches);
    const importPlan = options.targetState
      ? buildImportPlan(cwd, sqlitePath, path.resolve(cwd, options.targetState), tables, drivers)
      : undefined;
    const suggestions = buildSuggestions(tables, source.matches, recommendations, importPlan);
    const suggestedFiles = buildSuggestedFiles(recommendations, importPlan);
    return {
      version: 1,
      kind: 'db.integrationReport',
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      target: {
        path: relativeProjectPath(cwd, targetPath),
        kind: targetKind,
      },
      sqlite: {
        path: relativeProjectPath(cwd, sqlitePath),
        drivers,
        tables,
      },
      source,
      recommendations,
      suggestions,
      ...(importPlan ? { importPlan } : {}),
      suggestedFiles,
      agentInstructions: buildAgentInstructions(recommendations, suggestedFiles, importPlan),
    };
  } finally {
    database.close();
  }
}

export async function writeIntegrationReport(filePath: string, report: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function renderSqliteImporter(report: SqliteIntegrationReport | { importPlan?: SqliteIntegrationImportPlan }): string {
  const importPlan = report.importPlan;
  if (!importPlan) {
    throw new Error('SQLite importer generation requires an integration report with importPlan. Run async-db integrate inspect --target-state <file> first.');
  }
  return `#!/usr/bin/env node
import { openDb } from '@async/db';
import { sqliteStore } from '@async/db/sqlite';
import { defineSqliteImportPlan, runSqliteImportPlan } from '@async/db/sqlite/compat';

const plan = defineSqliteImportPlan(${JSON.stringify(importPlan, null, 2)});
const apply = process.argv.includes('--apply');

const targetDb = apply
  ? await openDb({
      stores: {
        default: 'sqlite',
        sqlite: sqliteStore({ file: plan.target.stateFile }),
      },
    })
  : null;

try {
  const result = await runSqliteImportPlan(plan, {
    apply,
    targetDb,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!apply) {
    console.log('Dry run only. Re-run with --apply to write Async DB state.');
  }
} finally {
  await targetDb?.close();
}
`;
}

export function normalizeIntegrationReportForCheck(report: SqliteIntegrationReport): unknown {
  return {
    ...report,
    generatedAt: '<generated>',
  };
}

function openReadOnlySqlite(filePath: string): SqliteDatabase {
  const { DatabaseSync } = importNodeSqliteSync();
  try {
    return new DatabaseSync(filePath, { open: true, readOnly: true });
  } catch (error) {
    const runtimeError = error as Error;
    throw new Error(`Unable to open SQLite database "${filePath}": ${runtimeError.message}`);
  }
}

function importNodeSqliteSync(): { DatabaseSync: DatabaseSyncConstructor } {
  try {
    return suppressNodeSqliteExperimentalWarning(
      () => require('node:sqlite') as { DatabaseSync: DatabaseSyncConstructor },
    );
  } catch (error) {
    const runtimeError = error as Error;
    throw new Error(`SQLite integration inspection requires Node.js with node:sqlite support. ${runtimeError.message}`);
  }
}

function inspectTables(database: SqliteDatabase): SqliteIntegrationTable[] {
  const rows = database.prepare(`
    SELECT name, type
    FROM sqlite_schema
    WHERE type IN ('table', 'view')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  return rows.map((row) => {
    const name = String(row.name);
    const type = String(row.type);
    const columns = inspectColumns(database, name);
    const indexes = inspectIndexes(database, name);
    const foreignKeys = inspectForeignKeys(database, name);
    const primaryKey = columns
      .filter((column) => column.primaryKeyPosition > 0)
      .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
      .map((column) => column.name);
    return {
      name,
      type,
      columns,
      primaryKey,
      indexes,
      foreignKeys,
      rowCount: type === 'table' ? tableRowCount(database, name) : null,
      classification: classifyTable({ name, type, columns, primaryKey, foreignKeys }),
    };
  });
}

function inspectColumns(database: SqliteDatabase, table: string): SqliteIntegrationColumn[] {
  return database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((row) => ({
    name: String(row.name),
    type: String(row.type || '').toUpperCase(),
    notNull: Number(row.notnull || 0) === 1,
    defaultValue: row.dflt_value == null ? null : String(row.dflt_value),
    primaryKeyPosition: Number(row.pk || 0),
  }));
}

function inspectIndexes(database: SqliteDatabase, table: string): SqliteIntegrationIndex[] {
  return database.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all().map((row) => {
    const name = String(row.name);
    return {
      name,
      unique: Number(row.unique || 0) === 1,
      origin: String(row.origin || ''),
      columns: database.prepare(`PRAGMA index_info(${quoteIdentifier(name)})`).all().map((entry) => String(entry.name)),
    };
  });
}

function inspectForeignKeys(database: SqliteDatabase, table: string): SqliteIntegrationForeignKey[] {
  return database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all().map((row) => ({
    table: String(row.table),
    from: String(row.from),
    to: String(row.to),
    onUpdate: String(row.on_update || ''),
    onDelete: String(row.on_delete || ''),
  }));
}

function tableRowCount(database: SqliteDatabase, table: string): number | null {
  try {
    return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get()?.count ?? 0);
  } catch {
    return null;
  }
}

function classifyTable(input: {
  name: string;
  type: string;
  columns: SqliteIntegrationColumn[];
  primaryKey: string[];
  foreignKeys: SqliteIntegrationForeignKey[];
}): string {
  const normalizedName = input.name.toLowerCase();
  const columnNames = new Set(input.columns.map((column) => column.name.toLowerCase()));
  if (input.type === 'view') return 'view';
  if (input.primaryKey.length > 1) return 'compound-primary-key';
  if (
    input.foreignKeys.length >= 2
    && input.columns.length <= input.foreignKeys.length + 3
    && (input.primaryKey.length > 1 || normalizedName.includes('_'))
  ) {
    return 'join-table';
  }
  if (
    normalizedName.includes('event')
    || normalizedName.includes('log')
    || columnNames.has('created_at')
    || columnNames.has('timestamp')
    || columnNames.has('at')
  ) {
    return 'event-log';
  }
  if (
    normalizedName.includes('setting')
    || normalizedName.includes('config')
    || (input.columns.length <= 4 && columnNames.has('key') && (columnNames.has('value') || columnNames.has('json')))
  ) {
    return 'document-settings';
  }
  if (input.primaryKey.length === 1) return 'single-primary-key';
  return 'no-primary-key';
}

async function scanSourceUsage(
  cwd: string,
  targetPath: string,
  targetKind: 'file' | 'directory',
  ignoredPaths: Set<string>,
): Promise<SqliteIntegrationReport['source']> {
  const files = targetKind === 'file'
    ? [targetPath]
    : await collectFiles(targetPath);
  const matches: SqliteIntegrationSourceMatch[] = [];
  let filesScanned = 0;
  const filesWithMatches = new Set<string>();

  for (const filePath of files.sort(comparePaths)) {
    if (ignoredPaths.has(path.resolve(filePath)) || !isScannableFile(filePath)) {
      continue;
    }
    filesScanned += 1;
    const relativePath = relativeProjectPath(cwd, filePath);
    const fileMatches = scanFileContent(await readFile(filePath, 'utf8'), relativePath);
    if (fileMatches.length > 0) {
      filesWithMatches.add(relativePath);
      matches.push(...fileMatches);
    }
  }

  return {
    filesScanned,
    filesWithMatches: filesWithMatches.size,
    matches,
  };
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        files.push(...await collectFiles(path.join(directory, entry.name)));
      }
      continue;
    }
    if (entry.isFile() && !IGNORED_FILES.has(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function isScannableFile(filePath: string): boolean {
  return SCANNABLE_EXTENSIONS.has(path.extname(filePath));
}

function scanFileContent(content: string, file: string): SqliteIntegrationSourceMatch[] {
  const matches: SqliteIntegrationSourceMatch[] = [];
  if (/(^|\/)src\/db\.(?:cjs|cts|js|mjs|mts|ts)$/i.test(file)) {
    matches.push({
      kind: 'db-facade-file',
      file,
      line: 1,
      snippet: file,
      confidence: 'medium',
    });
  }
  if (/(^|\/)(migrations?|prisma|drizzle)(\/|$)/i.test(file)) {
    matches.push({
      kind: 'schema-or-migration-file',
      file,
      line: 1,
      snippet: file,
      confidence: 'medium',
    });
  }
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    matches.push(...scanLine(line, file, index + 1));
  });
  return dedupeMatches(matches);
}

function scanLine(line: string, file: string, lineNumber: number): SqliteIntegrationSourceMatch[] {
  const matches: SqliteIntegrationSourceMatch[] = [];
  const add = (kind: string, confidence: IntegrationConfidence = 'high') => {
    matches.push({
      kind,
      file,
      line: lineNumber,
      snippet: line.trim().replace(/\s+/g, ' ').slice(0, 160),
      confidence,
    });
  };

  if (hasPackageImport(line, 'node:sqlite')) add('node-sqlite-import');
  if (hasPackageImport(line, 'better-sqlite3')) add('better-sqlite3-import');
  if (hasPackageImport(line, 'sqlite3')) add('sqlite3-import');
  if (hasPackageImport(line, 'sqlite')) add('sqlite-import');
  if (hasPackageImport(line, 'sql.js')) add('sql-js-import');
  if (hasPackageImport(line, 'drizzle-orm') || hasPackageImport(line, 'drizzle-orm/sqlite-core')) add('drizzle-import', 'medium');
  if (hasPackageImport(line, 'kysely')) add('kysely-import', 'medium');
  if (hasPackageImport(line, '@prisma/client') || /\bPrismaClient\b/.test(line)) add('prisma-usage', 'medium');
  if (/\bnew\s+DatabaseSync\s*\(/.test(line) || /\bnew\s+Database\s*\(/.test(line)) add('sqlite-open-call');
  if (/\b(?:db|database)\.prepare\s*\(/.test(line)) add('prepared-statement');
  if (/\b(?:db|database)\.(?:exec|run|all|get)\s*\(/.test(line)) add('sqlite-query-call', 'medium');
  if (/\bCREATE\s+TABLE\b/i.test(line)) add('create-table-sql');
  if (/\bALTER\s+TABLE\b/i.test(line)) add('alter-table-sql');
  if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(line)) add('create-index-sql');
  if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(line)) add('sqlite-write-sql', 'medium');
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,120}\bFROM\b/i.test(line)) add('raw-sql', 'medium');

  return matches;
}

function buildRecommendations(
  tables: SqliteIntegrationTable[],
  sourceMatches: SqliteIntegrationSourceMatch[],
): SqliteIntegrationRecommendation[] {
  const recommendations = tables.map((table) => recommendationForTable(table));
  if (sourceMatches.some((match) => match.kind === 'drizzle-import' || match.kind === 'kysely-import' || match.kind === 'prisma-usage')) {
    recommendations.push({
      kind: 'manual-review',
      table: null,
      confidence: 'medium',
      message: 'A higher-level SQL toolkit was detected in source.',
      nextStep: 'Wrap the existing ORM/query-builder facade with Async DB operations; do not bypass its schema or migrations.',
      adoptionPath: adoptionPath('app-owned-sql', 'app-owned-sql', 'not-recommended', 'ORM/query-builder ownership should stay app-owned until an explicit adapter is designed.'),
      details: {
        matchedKinds: [...new Set(sourceMatches.map((match) => match.kind).filter((kind) => ['drizzle-import', 'kysely-import', 'prisma-usage'].includes(kind)))],
      },
    });
  }
  return recommendations;
}

function recommendationForTable(table: SqliteIntegrationTable): SqliteIntegrationRecommendation {
  if (table.type === 'view') {
    return {
      kind: 'read-model',
      table: table.name,
      confidence: 'high',
      message: `SQLite view "${table.name}" is a good read-model candidate.`,
      nextStep: `Expose "${table.name}" as dashboard/read-only data before attempting writes through @async/db.`,
      adoptionPath: adoptionPath('read-model', 'read-model', 'not-recommended', 'SQLite views should remain read-only and app-owned.'),
      details: { classification: table.classification },
    };
  }

  switch (table.classification) {
    case 'single-primary-key':
      return {
        kind: 'direct-resource',
        table: table.name,
        confidence: 'high',
        message: `Table "${table.name}" has a single primary key and maps cleanly to an @async/db collection shape.`,
        nextStep: `Add db/${resourceFileName(table.name)}.schema.jsonc and map it with a table-backed adapter over the existing SQLite table before considering any storage migration.`,
        adoptionPath: adoptionPath('table-backed-adapter', 'table-adapter', 'optional-later', 'A single primary key can be mapped to row-level Async DB collection methods without relocating the SQLite file.'),
        details: { primaryKey: table.primaryKey },
      };
    case 'document-settings':
      return {
        kind: 'direct-resource',
        table: table.name,
        confidence: 'medium',
        message: `Table "${table.name}" looks like settings or singleton document state.`,
        nextStep: `Wrap the existing key/value access first; model it as an @async/db document or small collection only after preserving caller behavior.`,
        adoptionPath: adoptionPath('operation-wrapper', 'operations', 'optional-later', 'Settings tables often carry app-specific key/value semantics that should be preserved behind operations first.'),
        details: { classification: table.classification },
      };
    case 'event-log':
      return {
        kind: 'read-model',
        table: table.name,
        confidence: 'high',
        message: `Table "${table.name}" looks like an event/log table.`,
        nextStep: `Keep writes app-owned and expose @async/db read-model/dashboard resources for timeline and aggregate views.`,
        adoptionPath: adoptionPath('read-model', 'read-model', 'not-recommended', 'Event and log tables are usually append-heavy data-plane tables, so Async DB should read them before owning writes.'),
        details: { classification: table.classification },
      };
    case 'compound-primary-key':
    case 'join-table':
      return {
        kind: 'custom-store',
        table: table.name,
        confidence: 'high',
        message: `Table "${table.name}" needs more than the default collection mapping.`,
        nextStep: `Keep this table app-owned and expose Async DB operations that accept the real key shape, such as ${compoundKeyExample(table.primaryKey)}.`,
        adoptionPath: adoptionPath('app-owned-sql', 'operations', 'not-recommended', 'Compound and join-table keys should not receive surrogate ids during integration.'),
        details: { classification: table.classification, primaryKey: table.primaryKey, keyExample: compoundKeyExample(table.primaryKey) },
      };
    case 'no-primary-key':
    default:
      return {
        kind: 'app-owned-sql',
        table: table.name,
        confidence: 'medium',
        message: `Table "${table.name}" does not expose a clear primary-key resource shape.`,
        nextStep: `Keep direct SQL ownership until the app defines a stable id, read model, or custom store boundary.`,
        adoptionPath: adoptionPath('app-owned-sql', 'app-owned-sql', 'not-recommended', 'Tables without primary keys cannot safely use collection-style writes without an app-defined identity.'),
        details: { classification: table.classification },
      };
  }
}

function adoptionPath(
  kind: SqliteIntegrationAdoptionPathKind,
  asyncDbSurface: SqliteIntegrationAdoptionPath['asyncDbSurface'],
  storageMigration: SqliteIntegrationAdoptionPath['storageMigration'],
  reason: string,
): SqliteIntegrationAdoptionPath {
  return {
    kind,
    sourceOfTruth: 'existing-sqlite',
    asyncDbSurface,
    storageMigration,
    reason,
  };
}

function detectSqliteDrivers(matches: SqliteIntegrationSourceMatch[]): SqliteIntegrationReport['sqlite']['drivers'] {
  const detected = new Set<SqliteIntegrationDriver>();
  const ormDetected = new Set<string>();
  for (const match of matches) {
    if (match.kind === 'node-sqlite-import') detected.add('node:sqlite');
    if (match.kind === 'better-sqlite3-import') detected.add('better-sqlite3');
    if (match.kind === 'sqlite3-import') detected.add('sqlite3');
    if (match.kind === 'sqlite-import') detected.add('sqlite');
    if (match.kind === 'drizzle-import') ormDetected.add('drizzle');
    if (match.kind === 'kysely-import') ormDetected.add('kysely');
    if (match.kind === 'prisma-usage') ormDetected.add('prisma');
  }
  const ordered: SqliteIntegrationDriver[] = ['node:sqlite', 'better-sqlite3', 'sqlite3', 'sqlite'];
  const detectedList = ordered.filter((driver) => detected.has(driver));
  return {
    detected: detectedList,
    recommended: detectedList[0] ?? 'node:sqlite',
    ormDetected: [...ormDetected].sort(),
  };
}

function buildImportPlan(
  cwd: string,
  sqlitePath: string,
  targetStatePath: string,
  tables: SqliteIntegrationTable[],
  drivers: SqliteIntegrationReport['sqlite']['drivers'],
): SqliteIntegrationImportPlan {
  const resources = tables
    .filter((table) => table.type === 'table')
    .map((table) => importResourceForTable(table));
  const warnings = [
    'Import mode copies legacy SQLite rows into Async DB-owned state only when the generated importer is run with --apply.',
    'Review generated schemas and parity tests before deleting or ignoring the legacy SQLite file.',
  ];
  return {
    version: 1,
    kind: 'sqlite.importPlan',
    source: {
      sqliteFile: relativeProjectPath(cwd, sqlitePath),
      driver: drivers.recommended,
    },
    target: {
      stateFile: relativeProjectPath(cwd, targetStatePath),
    },
    resources,
    warnings,
  };
}

function importResourceForTable(table: SqliteIntegrationTable): SqliteIntegrationImportResource {
  const resource = camelCase(table.name);
  const base = {
    resource,
    table: table.name,
    primaryKey: table.primaryKey,
    fields: fieldsForImportTable(table),
    columns: Object.fromEntries(table.columns.map((column) => [column.name, column.name])),
    warnings: [] as string[],
  };

  if (table.classification === 'document-settings') {
    const keyField = table.columns.find((column) => column.name.toLowerCase() === 'key')?.name ?? table.primaryKey[0] ?? 'key';
    const valueField = table.columns.find((column) => ['value', 'json'].includes(column.name.toLowerCase()))?.name ?? 'value';
    return {
      ...base,
      kind: 'document',
      importKind: 'document',
      keyStrategy: { kind: 'key-value-document', keyField, valueField },
    };
  }

  if (table.classification === 'event-log') {
    const idField = table.primaryKey[0] ?? table.columns.find((column) => column.name.toLowerCase() === 'id')?.name;
    return {
      ...base,
      kind: 'collection',
      importKind: 'append-only',
      idField,
      writePolicy: 'append-only',
      keyStrategy: { kind: 'append-only', idField },
    };
  }

  if (table.primaryKey.length > 1) {
    return {
      ...base,
      kind: 'collection',
      importKind: 'collection',
      idField: 'id',
      fields: {
        id: { type: 'string', required: true },
        ...base.fields,
      },
      keyStrategy: { kind: 'compound-generated-id', fields: table.primaryKey, idField: 'id' },
      warnings: [
        `Compound key (${table.primaryKey.join(', ')}) is preserved as domain identity; import mode adds a deterministic Async DB collection id.`,
      ],
    };
  }

  if (table.primaryKey.length === 1) {
    return {
      ...base,
      kind: 'collection',
      importKind: 'collection',
      idField: table.primaryKey[0],
      keyStrategy: { kind: 'single-primary-key', field: table.primaryKey[0] },
    };
  }

  return {
    ...base,
    kind: 'collection',
    importKind: 'collection',
    idField: 'id',
    fields: {
      id: { type: 'string', required: true },
      ...base.fields,
    },
    keyStrategy: { kind: 'single-primary-key', field: 'id' },
    warnings: [
      'No primary key was detected; review this generated id strategy before applying an import.',
    ],
  };
}

function fieldsForImportTable(table: SqliteIntegrationTable): SqliteIntegrationImportResource['fields'] {
  return Object.fromEntries(table.columns.map((column) => [
    column.name,
    {
      type: sqliteTypeForImport(column.type),
      ...(column.notNull || column.primaryKeyPosition > 0 ? { required: true } : {}),
    },
  ]));
}

function sqliteTypeForImport(type: string): string {
  const normalized = type.toUpperCase();
  if (normalized.includes('INT') || normalized.includes('REAL') || normalized.includes('FLOA') || normalized.includes('DOUB') || normalized.includes('NUM')) {
    return 'number';
  }
  if (normalized.includes('BOOL')) {
    return 'boolean';
  }
  return 'string';
}

function buildSuggestions(
  tables: SqliteIntegrationTable[],
  sourceMatches: SqliteIntegrationSourceMatch[],
  recommendations: SqliteIntegrationRecommendation[],
  importPlan?: SqliteIntegrationImportPlan,
): SqliteIntegrationSuggestion[] {
  const suggestions: SqliteIntegrationSuggestion[] = [
    {
      code: 'INTEGRATE_KEEP_EXISTING_SQLITE_SOURCE',
      severity: 'info',
      table: null,
      message: 'Existing SQLite should remain the write source of truth during initial Async DB adoption.',
      hint: 'Start by adding Async DB contracts, operations, table adapters, and read models over the existing SQLite file; move storage only as an explicit later migration.',
      details: {
        sqliteTables: tables.length,
      },
    },
  ];

  const lowLevelDriverKinds = ['node-sqlite-import', 'better-sqlite3-import', 'sqlite3-import', 'sqlite-import'];

  if (sourceMatches.some((match) => [...lowLevelDriverKinds, 'sqlite-open-call', 'prepared-statement', 'sqlite-query-call', 'sqlite-write-sql'].includes(match.kind))) {
    suggestions.push({
      code: 'INTEGRATE_WRAP_EXISTING_DB_FACADE',
      severity: 'warning',
      table: null,
      message: 'Synchronous SQLite usage or an existing DB facade was detected.',
      hint: 'Keep the current SQLite module underneath an async Async DB operation wrapper instead of replacing call sites with a new store in one step.',
      details: {
        matchedKinds: uniqueKinds(sourceMatches, [...lowLevelDriverKinds, 'sqlite-open-call', 'prepared-statement', 'sqlite-query-call', 'sqlite-write-sql', 'db-facade-file']),
      },
    });
  }

  if (sourceMatches.some((match) => lowLevelDriverKinds.includes(match.kind))) {
    suggestions.push({
      code: 'INTEGRATE_USE_SQLITE_COMPAT_DRIVER',
      severity: 'info',
      table: null,
      message: 'Low-level SQLite driver imports were detected.',
      hint: 'Use @async/db/sqlite/compat to inject existing node:sqlite, better-sqlite3, sqlite3, or sqlite handles into Async DB wrappers/importers.',
      details: {
        matchedKinds: uniqueKinds(sourceMatches, lowLevelDriverKinds),
      },
    });
  }

  if (sourceMatches.some((match) => ['raw-sql', 'prepared-statement', 'sqlite-query-call'].includes(match.kind))) {
    suggestions.push({
      code: 'INTEGRATE_QUERY_AGGREGATION_API',
      severity: 'info',
      table: null,
      message: 'SQLite query calls were detected that may include filtered reads or aggregations.',
      hint: 'Move common dashboard reads to Async DB collection find/count/aggregate helpers or registered operations before reintroducing raw SQL.',
      details: {
        matchedKinds: uniqueKinds(sourceMatches, ['raw-sql', 'prepared-statement', 'sqlite-query-call']),
      },
    });
  }

  if (importPlan) {
    suggestions.push({
      code: 'INTEGRATE_IMPORT_TO_ASYNC_DB_STATE',
      severity: 'warning',
      table: null,
      message: `Explicit import mode will copy legacy SQLite into Async DB-owned state at ${importPlan.target.stateFile}.`,
      hint: 'Review the generated import plan, run the importer in dry-run mode first, then pass --apply only after parity tests pass.',
      details: {
        targetState: importPlan.target.stateFile,
        resources: importPlan.resources.map((resource) => resource.resource),
      },
    });
  }

  if (sourceMatches.some((match) => match.kind === 'db-facade-file')) {
    suggestions.push({
      code: 'INTEGRATE_WRAP_EXISTING_DB_FACADE',
      severity: 'info',
      table: null,
      message: 'A likely src/db facade was found.',
      hint: 'Preserve that facade and expose selected methods through Async DB operations before changing the database implementation.',
      details: {
        files: [...new Set(sourceMatches.filter((match) => match.kind === 'db-facade-file').map((match) => match.file))],
      },
    });
  }

  for (const recommendation of recommendations) {
    if (!recommendation.table) continue;
    if (recommendation.adoptionPath?.kind === 'table-backed-adapter') {
      suggestions.push({
        code: 'INTEGRATE_SIMPLE_TABLE_ADAPTER_CANDIDATE',
        severity: 'info',
        table: recommendation.table,
        message: `Table "${recommendation.table}" can be mapped with a table-backed adapter.`,
        hint: 'Keep the SQLite file in place and use row-level adapter methods for reads and writes; do not move it into .db/state.',
        details: recommendation.details,
      });
    }
    if (recommendation.adoptionPath?.kind === 'read-model') {
      suggestions.push({
        code: 'INTEGRATE_READ_MODEL_FIRST',
        severity: 'info',
        table: recommendation.table,
        message: `Table "${recommendation.table}" should start as a read model.`,
        hint: 'Expose dashboards, views, event logs, and aggregates as read-only Async DB surfaces before attempting write ownership.',
        details: recommendation.details,
      });
    }
    if (importPlan?.resources.some((resource) => resource.table === recommendation.table && resource.importKind === 'append-only')) {
      suggestions.push({
        code: 'INTEGRATE_APPEND_ONLY_EVENT_LOG',
        severity: 'info',
        table: recommendation.table,
        message: `Table "${recommendation.table}" should import as an append-only resource.`,
        hint: 'Use collection.append(record) for event writes and block update/delete behavior after import.',
        details: recommendation.details,
      });
    }
    if (recommendation.details.primaryKey && Array.isArray(recommendation.details.primaryKey) && recommendation.details.primaryKey.length > 1) {
      suggestions.push({
        code: 'INTEGRATE_COMPOUND_KEY_USE_OPERATIONS',
        severity: 'warning',
        table: recommendation.table,
        message: `Table "${recommendation.table}" has a compound primary key.`,
        hint: `Do not add a surrogate id by default. Expose Async DB operations that accept the real key shape, such as ${compoundKeyExample(recommendation.details.primaryKey)}.`,
        details: recommendation.details,
      });
    }
  }

  if (sourceMatches.some((match) => ['drizzle-import', 'kysely-import', 'prisma-usage'].includes(match.kind))) {
    suggestions.push({
      code: 'INTEGRATE_ORM_MANUAL_REVIEW',
      severity: 'warning',
      table: null,
      message: 'An ORM or query builder owns part of the SQLite access layer.',
      hint: 'Wrap ORM-backed functions with Async DB operations; do not generate direct table writes that bypass ORM schema, hooks, or migrations.',
      details: {
        matchedKinds: uniqueKinds(sourceMatches, ['drizzle-import', 'kysely-import', 'prisma-usage']),
      },
    });
  }

  return dedupeSuggestions(suggestions);
}

function buildSuggestedFiles(
  recommendations: SqliteIntegrationRecommendation[],
  importPlan?: SqliteIntegrationImportPlan,
): SqliteIntegrationReport['suggestedFiles'] {
  const files = new Map<string, string>();
  files.set('db.config.mjs', 'Configure @async/db resources, outputs, and optional stores.');
  files.set('src/generated/db.viewer.json', 'Optional committed viewer manifest for dashboard builders and AI agents.');
  files.set('src/generated/db.schema.json', 'Optional committed schema manifest for form/admin UI generation.');
  for (const recommendation of recommendations) {
    if (!recommendation.table) continue;
    if (recommendation.kind === 'direct-resource') {
      files.set(`db/${resourceFileName(recommendation.table)}.schema.jsonc`, `Schema contract for SQLite table "${recommendation.table}".`);
      if (recommendation.adoptionPath?.kind === 'table-backed-adapter') {
        files.set(`src/db/${camelCase(recommendation.table)}TableAdapter.ts`, `Table-backed adapter that maps "${recommendation.table}" without moving the SQLite file.`);
      }
    }
    if (recommendation.kind === 'read-model') {
      files.set(`src/db/${camelCase(recommendation.table)}ReadModel.ts`, `Read-only adapter for dashboard/query views based on "${recommendation.table}".`);
    }
    if (recommendation.kind === 'custom-store') {
      files.set(`src/db/${camelCase(recommendation.table)}Operations.ts`, `Operation wrapper that preserves the existing SQL identity for "${recommendation.table}".`);
    }
  }
  if (importPlan) {
    files.set('src/generated/db.integration.json', 'Committed integration report with explicit SQLite import plan.');
    files.set('scripts/import-legacy-sqlite.js', `Generated dry-run importer from ${importPlan.source.sqliteFile} to ${importPlan.target.stateFile}.`);
  }
  return [...files.entries()].map(([filePath, purpose]) => ({ path: filePath, purpose }));
}

function buildAgentInstructions(
  recommendations: SqliteIntegrationRecommendation[],
  suggestedFiles: SqliteIntegrationReport['suggestedFiles'],
  importPlan?: SqliteIntegrationImportPlan,
): string[] {
  const direct = recommendations.filter((entry) => entry.kind === 'direct-resource' && entry.table).map((entry) => entry.table);
  const readModels = recommendations.filter((entry) => entry.kind === 'read-model' && entry.table).map((entry) => entry.table);
  const custom = recommendations.filter((entry) => ['custom-store', 'app-owned-sql'].includes(entry.kind) && entry.table).map((entry) => entry.table);
  const instructions = [
    'Keep the existing SQLite file as the write source of truth during initial adoption.',
    'Start with operation wrappers and read-only integration; do not replace existing SQLite writes until tests prove parity.',
    'Add db.config.mjs and committed schema/viewer manifest outputs before building custom dashboard UI.',
  ];
  if (direct.length > 0) {
    instructions.push(`Create @async/db schemas for direct-resource tables: ${direct.join(', ')}.`);
  }
  if (readModels.length > 0) {
    instructions.push(`Expose read-model/dashboard resources first for: ${readModels.join(', ')}.`);
  }
  if (custom.length > 0) {
    instructions.push(`Keep app-owned SQL and expose operation wrappers for: ${custom.join(', ')}.`);
  }
  instructions.push(`Review suggested files: ${suggestedFiles.map((file) => file.path).join(', ')}.`);
  if (importPlan) {
    instructions.push(`Generate and dry-run a legacy SQLite importer before applying ${importPlan.target.stateFile}.`);
  }
  instructions.push('Run async-db doctor --production after adding schemas and outputs.');
  return instructions;
}

function uniqueKinds(matches: SqliteIntegrationSourceMatch[], kinds: string[]): string[] {
  return [...new Set(matches.map((match) => match.kind).filter((kind) => kinds.includes(kind)))];
}

function dedupeSuggestions(suggestions: SqliteIntegrationSuggestion[]): SqliteIntegrationSuggestion[] {
  const seen = new Set<string>();
  const deduped: SqliteIntegrationSuggestion[] = [];
  for (const suggestion of suggestions) {
    const key = `${suggestion.code}\0${suggestion.table ?? ''}\0${suggestion.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(suggestion);
    }
  }
  return deduped;
}

function compoundKeyExample(primaryKey: unknown): string {
  const fields = Array.isArray(primaryKey) ? primaryKey.map(String) : [];
  const entries = fields.length > 0 ? fields : ['name', 'version'];
  return `{ ${entries.map((field) => `${field}: ...`).join(', ')} }`;
}

function hasPackageImport(line: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:from\\s+|import\\s*\\(|require\\s*\\()["']${escaped}["']`).test(line);
}

function dedupeMatches(matches: SqliteIntegrationSourceMatch[]): SqliteIntegrationSourceMatch[] {
  const seen = new Set<string>();
  const deduped: SqliteIntegrationSourceMatch[] = [];
  for (const match of matches) {
    const key = `${match.kind}\0${match.file}\0${match.line}\0${match.snippet}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(match);
    }
  }
  return deduped;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function resourceFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'resource';
}

function camelCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0 ? lower : lower[0].toUpperCase() + lower.slice(1);
    })
    .join('') || 'sqlite';
}

function relativeProjectPath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);
  return relative === '' ? '.' : relative.split(path.sep).join('/');
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right);
}
