import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

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
  details: Record<string, unknown>;
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
    tables: SqliteIntegrationTable[];
  };
  source: {
    filesScanned: number;
    filesWithMatches: number;
    matches: SqliteIntegrationSourceMatch[];
  };
  recommendations: SqliteIntegrationRecommendation[];
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
    const recommendations = buildRecommendations(tables, source.matches);
    const suggestedFiles = buildSuggestedFiles(recommendations);
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
        tables,
      },
      source,
      recommendations,
      suggestedFiles,
      agentInstructions: buildAgentInstructions(recommendations, suggestedFiles),
    };
  } finally {
    database.close();
  }
}

export async function writeIntegrationReport(filePath: string, report: SqliteIntegrationReport): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
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
    return require('node:sqlite') as { DatabaseSync: DatabaseSyncConstructor };
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
      nextStep: 'Review the ORM/query-builder schema before deciding whether @async/db should wrap resources, expose a read model, or leave this store app-owned.',
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
        nextStep: `Add db/${resourceFileName(table.name)}.schema.jsonc and consider sqliteStore only after preserving existing app write behavior.`,
        details: { primaryKey: table.primaryKey },
      };
    case 'document-settings':
      return {
        kind: 'direct-resource',
        table: table.name,
        confidence: 'medium',
        message: `Table "${table.name}" looks like settings or singleton document state.`,
        nextStep: `Model it as an @async/db document or a small collection depending on whether callers address rows by key.`,
        details: { classification: table.classification },
      };
    case 'event-log':
      return {
        kind: 'read-model',
        table: table.name,
        confidence: 'high',
        message: `Table "${table.name}" looks like an event/log table.`,
        nextStep: `Keep writes app-owned and expose @async/db read-model/dashboard resources for timeline and aggregate views.`,
        details: { classification: table.classification },
      };
    case 'compound-primary-key':
    case 'join-table':
      return {
        kind: 'custom-store',
        table: table.name,
        confidence: 'high',
        message: `Table "${table.name}" needs more than the default collection mapping.`,
        nextStep: `Keep this table app-owned or build a custom store/read model; default @async/db SQLite collections currently prefer one id field.`,
        details: { classification: table.classification, primaryKey: table.primaryKey },
      };
    case 'no-primary-key':
    default:
      return {
        kind: 'app-owned-sql',
        table: table.name,
        confidence: 'medium',
        message: `Table "${table.name}" does not expose a clear primary-key resource shape.`,
        nextStep: `Keep direct SQL ownership until the app defines a stable id, read model, or custom store boundary.`,
        details: { classification: table.classification },
      };
  }
}

function buildSuggestedFiles(recommendations: SqliteIntegrationRecommendation[]): SqliteIntegrationReport['suggestedFiles'] {
  const files = new Map<string, string>();
  files.set('db.config.mjs', 'Configure @async/db resources, outputs, and optional stores.');
  files.set('src/generated/db.viewer.json', 'Optional committed viewer manifest for dashboard builders and AI agents.');
  files.set('src/generated/db.schema.json', 'Optional committed schema manifest for form/admin UI generation.');
  for (const recommendation of recommendations) {
    if (!recommendation.table) continue;
    if (recommendation.kind === 'direct-resource') {
      files.set(`db/${resourceFileName(recommendation.table)}.schema.jsonc`, `Schema contract for SQLite table "${recommendation.table}".`);
    }
    if (recommendation.kind === 'read-model') {
      files.set(`src/db/${camelCase(recommendation.table)}ReadModel.ts`, `Read-only adapter for dashboard/query views based on "${recommendation.table}".`);
    }
    if (recommendation.kind === 'custom-store') {
      files.set(`src/db/${camelCase(recommendation.table)}Store.ts`, `Custom store or adapter boundary for "${recommendation.table}".`);
    }
  }
  return [...files.entries()].map(([filePath, purpose]) => ({ path: filePath, purpose }));
}

function buildAgentInstructions(
  recommendations: SqliteIntegrationRecommendation[],
  suggestedFiles: SqliteIntegrationReport['suggestedFiles'],
): string[] {
  const direct = recommendations.filter((entry) => entry.kind === 'direct-resource' && entry.table).map((entry) => entry.table);
  const readModels = recommendations.filter((entry) => entry.kind === 'read-model' && entry.table).map((entry) => entry.table);
  const custom = recommendations.filter((entry) => ['custom-store', 'app-owned-sql'].includes(entry.kind) && entry.table).map((entry) => entry.table);
  const instructions = [
    'Start with read-only integration; do not replace existing SQLite writes until tests prove parity.',
    'Add db.config.mjs and committed schema/viewer manifest outputs before building custom dashboard UI.',
  ];
  if (direct.length > 0) {
    instructions.push(`Create @async/db schemas for direct-resource tables: ${direct.join(', ')}.`);
  }
  if (readModels.length > 0) {
    instructions.push(`Expose read-model/dashboard resources first for: ${readModels.join(', ')}.`);
  }
  if (custom.length > 0) {
    instructions.push(`Keep app-owned SQL or design custom stores for: ${custom.join(', ')}.`);
  }
  instructions.push(`Review suggested files: ${suggestedFiles.map((file) => file.path).join(', ')}.`);
  instructions.push('Run async-db doctor --production after adding schemas and outputs.');
  return instructions;
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
