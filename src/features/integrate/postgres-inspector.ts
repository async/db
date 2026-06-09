import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openCompatPostgres, type PostgresCompatDriver, type PostgresCompatibleClient } from '../../postgres-compat.js';

export type PostgresIntegrationAdoptionPathKind =
  | 'operation-wrapper'
  | 'read-model'
  | 'table-backed-adapter'
  | 'app-owned-sql';

export type PostgresIntegrationSuggestionCode =
  | 'INTEGRATE_KEEP_EXISTING_POSTGRES_SOURCE'
  | 'INTEGRATE_WRAP_EXISTING_POSTGRES_FACADE'
  | 'INTEGRATE_USE_POSTGRES_COMPAT_DRIVER'
  | 'INTEGRATE_IMPORT_TO_ASYNC_DB_STATE'
  | 'INTEGRATE_IMPORT_TO_POSTGRES_STORE'
  | 'INTEGRATE_POSTGRES_OBJECT_KEY_OPERATIONS'
  | 'INTEGRATE_POSTGRES_APPEND_ONLY_EVENT_LOG'
  | 'INTEGRATE_POSTGRES_QUERY_AGGREGATION_API'
  | 'INTEGRATE_POSTGRES_READ_MODEL_FIRST'
  | 'INTEGRATE_POSTGRES_TABLE_ADAPTER_CANDIDATE'
  | 'INTEGRATE_POSTGRES_ORM_MANUAL_REVIEW'
  | 'INTEGRATE_POSTGRES_CATALOG_PARTIAL';

export type PostgresIntegrationDriver =
  | 'pg'
  | 'postgres'
  | '@neondatabase/serverless'
  | '@vercel/postgres'
  | 'pg-promise';

export type PostgresIntegrationAdoptionPath = {
  kind: PostgresIntegrationAdoptionPathKind;
  sourceOfTruth: 'existing-postgres';
  asyncDbSurface: 'operations' | 'read-model' | 'table-adapter' | 'app-owned-sql';
  storageMigration: 'not-recommended' | 'optional-later';
  reason: string;
};

export type PostgresIntegrationColumn = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  generated: boolean;
  identity: boolean;
};

export type PostgresIntegrationUniqueIndex = {
  name: string;
  columns: string[];
};

export type PostgresIntegrationForeignKey = {
  name: string;
  columns: string[];
  foreignSchema: string;
  foreignTable: string;
  foreignColumns: string[];
};

export type PostgresIntegrationTrigger = {
  name: string;
  timing: string;
  events: string[];
};

export type PostgresIntegrationRlsPolicy = {
  name: string;
  command: string;
};

export type PostgresIntegrationTableKind =
  | 'table'
  | 'view'
  | 'materialized-view'
  | 'partitioned-table';

export type PostgresIntegrationTable = {
  schema: string;
  name: string;
  kind: PostgresIntegrationTableKind;
  columns: PostgresIntegrationColumn[];
  primaryKey: string[];
  uniqueIndexes: PostgresIntegrationUniqueIndex[];
  foreignKeys: PostgresIntegrationForeignKey[];
  triggers: PostgresIntegrationTrigger[];
  rlsPolicies: PostgresIntegrationRlsPolicy[];
  estimatedRows: number | null;
  exactRows?: number | null;
  classification: string;
};

export type PostgresIntegrationSourceMatch = {
  kind: string;
  file: string;
  line: number;
  snippet: string;
  confidence: 'high' | 'medium' | 'low';
};

export type PostgresIntegrationRecommendation = {
  kind: 'direct-resource' | 'read-model' | 'custom-store' | 'app-owned-sql' | 'manual-review';
  table: string | null;
  confidence: 'high' | 'medium' | 'low';
  message: string;
  nextStep: string;
  adoptionPath?: PostgresIntegrationAdoptionPath;
  details: Record<string, unknown>;
};

export type PostgresIntegrationSuggestion = {
  code: PostgresIntegrationSuggestionCode;
  severity: 'info' | 'warning';
  table: string | null;
  message: string;
  hint: string;
  details: Record<string, unknown>;
};

export type PostgresIntegrationImportKeyStrategy =
  | { kind: 'single-primary-key'; field: string }
  | { kind: 'compound-generated-id'; fields: string[]; idField: string }
  | { kind: 'key-value-document'; keyField: string; valueField: string }
  | { kind: 'append-only'; idField?: string };

export type PostgresIntegrationImportResource = {
  resource: string;
  schema: string;
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
  keyStrategy: PostgresIntegrationImportKeyStrategy;
  estimatedRows: number | null;
  batchSize: number;
  warnings: string[];
};

export type PostgresIntegrationImportPlan = {
  version: 1;
  kind: 'postgres.importPlan';
  source: {
    connectionStringEnv: string;
    driver: PostgresIntegrationDriver | null;
    schemas: string[];
  };
  target:
    | {
      kind: 'postgres-envelope';
      connectionStringEnv: string;
      driver: PostgresIntegrationDriver | null;
      schema: string;
      table: string;
      namespace?: string;
    }
    | {
      kind: 'sqlite-state';
      stateFile: string;
    };
  resources: PostgresIntegrationImportResource[];
  batchSize: number;
  warnings: string[];
};

export type PostgresIntegrationReport = {
  version: 1;
  kind: 'db.integrationReport';
  generatedAt: string;
  target: {
    path: string;
    kind: 'file' | 'directory';
  };
  postgres: {
    mode: 'source-only' | 'catalog' | 'partial';
    connectionStringEnv: string | null;
    schemas: string[];
    drivers: {
      detected: PostgresIntegrationDriver[];
      recommended: PostgresIntegrationDriver | null;
      ormDetected: string[];
    };
    catalog: {
      schemas: string[];
      tables: PostgresIntegrationTable[];
      exactRowCounts: boolean;
    };
    errors: Array<{
      code: string;
      message: string;
    }>;
  };
  source: {
    filesScanned: number;
    filesWithMatches: number;
    matches: PostgresIntegrationSourceMatch[];
  };
  recommendations: PostgresIntegrationRecommendation[];
  suggestions: PostgresIntegrationSuggestion[];
  importPlan?: PostgresIntegrationImportPlan;
  suggestedFiles: Array<{
    path: string;
    purpose: string;
  }>;
  agentInstructions: string[];
};

export type DbPostgresIntegrationReport = PostgresIntegrationReport;
export type DbPostgresIntegrationTable = PostgresIntegrationTable;
export type DbPostgresIntegrationSuggestion = PostgresIntegrationSuggestion;
export type DbPostgresIntegrationImportPlan = PostgresIntegrationImportPlan;
export type DbPostgresIntegrationImportResource = PostgresIntegrationImportResource;
export type DbPostgresIntegrationImportKeyStrategy = PostgresIntegrationImportKeyStrategy;
export type DbPostgresIntegrationAdoptionPath = PostgresIntegrationAdoptionPath;

export type InspectPostgresIntegrationOptions = {
  cwd?: string;
  target?: string;
  postgresUrlEnv?: string;
  schemas?: string[];
  targetState?: string;
  targetPostgresTable?: string;
  exactRowCounts?: boolean;
  allowPartial?: boolean;
  generatedAt?: string;
  ignorePaths?: string[];
  client?: PostgresCompatibleClient;
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
  '.prisma',
  '.sql',
  '.ts',
  '.tsx',
]);

export async function inspectPostgresIntegration(options: InspectPostgresIntegrationOptions): Promise<PostgresIntegrationReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const targetInput = options.target ?? '.';
  const targetPath = path.resolve(cwd, targetInput);
  const targetStats = await stat(targetPath);
  const targetKind = targetStats.isDirectory() ? 'directory' : 'file';
  const schemas = options.schemas && options.schemas.length > 0 ? options.schemas : ['public'];
  const ignoredPaths = new Set([
    ...(options.ignorePaths ?? []).map((filePath) => path.resolve(cwd, filePath)),
  ]);
  const source = await scanSourceUsage(cwd, targetPath, targetKind, ignoredPaths);
  const drivers = detectPostgresDrivers(source.matches);
  const catalogResult = await loadCatalog({
    client: options.client,
    postgresUrlEnv: options.postgresUrlEnv,
    schemas,
    exactRowCounts: options.exactRowCounts === true,
    allowPartial: options.allowPartial === true,
  });
  const recommendations = buildRecommendations(catalogResult.tables, source.matches);
  const importPlan = options.targetState || options.targetPostgresTable
    ? buildImportPlan({
      cwd,
      tables: catalogResult.tables,
      drivers,
      schemas,
      connectionStringEnv: options.postgresUrlEnv ?? 'DATABASE_URL',
      targetState: options.targetState ? path.resolve(cwd, options.targetState) : undefined,
      targetPostgresTable: options.targetPostgresTable,
    })
    : undefined;
  const suggestions = buildSuggestions(catalogResult.tables, source.matches, recommendations, catalogResult.mode, catalogResult.errors, importPlan);
  const suggestedFiles = buildSuggestedFiles(recommendations, importPlan);

  return {
    version: 1,
    kind: 'db.integrationReport',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    target: {
      path: relativeProjectPath(cwd, targetPath),
      kind: targetKind,
    },
    postgres: {
      mode: catalogResult.mode,
      connectionStringEnv: options.postgresUrlEnv ?? null,
      schemas,
      drivers,
      catalog: {
        schemas: catalogResult.schemas,
        tables: catalogResult.tables,
        exactRowCounts: options.exactRowCounts === true,
      },
      errors: catalogResult.errors,
    },
    source,
    recommendations,
    suggestions,
    ...(importPlan ? { importPlan } : {}),
    suggestedFiles,
    agentInstructions: buildAgentInstructions(recommendations, suggestedFiles, importPlan),
  };
}

export async function writePostgresIntegrationReport(filePath: string, report: PostgresIntegrationReport): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function renderPostgresImporter(report: PostgresIntegrationReport | { importPlan?: PostgresIntegrationImportPlan }): string {
  const importPlan = report.importPlan;
  if (!importPlan) {
    throw new Error('Postgres importer generation requires an integration report with importPlan. Run async-db integrate inspect --postgres --postgres-url-env <ENV> --target-postgres-table <schema.table> or --target-state <file> first.');
  }
  return `#!/usr/bin/env node
import { definePostgresImportPlan, runPostgresImportPlan } from '@async/db/postgres/compat';

const plan = definePostgresImportPlan(${JSON.stringify(importPlan, null, 2)});
const apply = process.argv.includes('--apply');

const result = await runPostgresImportPlan(plan, { apply });
console.log(JSON.stringify(result, null, 2));
if (!apply) {
  console.log('Dry run only. Re-run with --apply to write Async DB state.');
}
`;
}

export function normalizePostgresIntegrationReportForCheck(report: PostgresIntegrationReport): unknown {
  return {
    ...report,
    generatedAt: '<generated>',
  };
}

async function loadCatalog(options: {
  client?: PostgresCompatibleClient;
  postgresUrlEnv?: string;
  schemas: string[];
  exactRowCounts: boolean;
  allowPartial: boolean;
}): Promise<{
  mode: 'source-only' | 'catalog' | 'partial';
  schemas: string[];
  tables: PostgresIntegrationTable[];
  errors: Array<{ code: string; message: string }>;
}> {
  if (!options.client && !options.postgresUrlEnv) {
    return {
      mode: 'source-only',
      schemas: [],
      tables: [],
      errors: [],
    };
  }

  let client = options.client;
  let closeClient = false;
  try {
    if (!client) {
      if (!process.env[options.postgresUrlEnv as string]) {
        throw new Error(`Postgres connection string env ${options.postgresUrlEnv} is not set.`);
      }
      client = await openCompatPostgres({
        driver: 'pg',
        connectionStringEnv: options.postgresUrlEnv,
        readOnly: true,
      });
      closeClient = true;
    }

    const catalog = await inspectCatalog(client, options.schemas, options.exactRowCounts);
    return {
      mode: 'catalog',
      schemas: catalog.schemas,
      tables: catalog.tables,
      errors: [],
    };
  } catch (error) {
    if (!options.allowPartial) {
      throw new Error(`Postgres catalog inspection failed: ${redactConnectionStrings((error as Error).message)}`);
    }
    return {
      mode: 'partial',
      schemas: [],
      tables: [],
      errors: [{
        code: 'POSTGRES_CATALOG_PARTIAL',
        message: redactConnectionStrings((error as Error).message),
      }],
    };
  } finally {
    if (closeClient && client) {
      const close = client.end ?? client.close;
      if (typeof close === 'function') {
        await close.call(client);
      }
    }
  }
}

async function inspectCatalog(
  client: PostgresCompatibleClient,
  schemas: string[],
  exactRowCounts: boolean,
): Promise<{ schemas: string[]; tables: PostgresIntegrationTable[] }> {
  const tableRows = await queryRows(client, `
    SELECT table_schema, table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = ANY($1)
    ORDER BY table_schema, table_name
  `, [schemas]);
  const materializedRows = await queryRows(client, `
    SELECT schemaname AS table_schema, matviewname AS table_name, 'MATERIALIZED VIEW' AS table_type
    FROM pg_catalog.pg_matviews
    WHERE schemaname = ANY($1)
    ORDER BY schemaname, matviewname
  `, [schemas]).catch(() => []);
  const tables = [...tableRows, ...materializedRows].map((row) => ({
    schema: String(row.table_schema),
    name: String(row.table_name),
    kind: tableKind(String(row.table_type)),
  }));
  const columns = await columnsByTable(client, schemas);
  const primaryKeys = await primaryKeysByTable(client, schemas);
  const uniqueIndexes = await uniqueIndexesByTable(client, schemas);
  const foreignKeys = await foreignKeysByTable(client, schemas);
  const triggers = await triggersByTable(client, schemas);
  const rlsPolicies = await rlsPoliciesByTable(client, schemas);
  const estimates = await estimatedRowsByTable(client, schemas);

  const inspected: PostgresIntegrationTable[] = [];
  for (const table of tables) {
    const key = tableKey(table.schema, table.name);
    const exactRows = exactRowCounts && table.kind === 'table'
      ? await exactRowCount(client, table.schema, table.name)
      : undefined;
    const tableInfo = {
      schema: table.schema,
      name: table.name,
      kind: table.kind,
      columns: columns.get(key) ?? [],
      primaryKey: primaryKeys.get(key) ?? [],
      uniqueIndexes: uniqueIndexes.get(key) ?? [],
      foreignKeys: foreignKeys.get(key) ?? [],
      triggers: triggers.get(key) ?? [],
      rlsPolicies: rlsPolicies.get(key) ?? [],
      estimatedRows: estimates.get(key) ?? null,
      ...(exactRows === undefined ? {} : { exactRows }),
      classification: '',
    };
    inspected.push({
      ...tableInfo,
      classification: classifyTable(tableInfo),
    });
  }

  return {
    schemas: [...new Set(inspected.map((table) => table.schema))],
    tables: inspected,
  };
}

async function queryRows(client: PostgresCompatibleClient, sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  return (await client.query(sql, params)).rows ?? [];
}

async function columnsByTable(client: PostgresCompatibleClient, schemas: string[]): Promise<Map<string, PostgresIntegrationColumn[]>> {
  const rows = await queryRows(client, `
    SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable,
      column_default, is_generated, identity_generation
    FROM information_schema.columns
    WHERE table_schema = ANY($1)
    ORDER BY table_schema, table_name, ordinal_position
  `, [schemas]);
  const byTable = new Map<string, PostgresIntegrationColumn[]>();
  for (const row of rows) {
    const key = tableKey(String(row.table_schema), String(row.table_name));
    const entries = byTable.get(key) ?? [];
    entries.push({
      name: String(row.column_name),
      type: String(row.data_type || row.udt_name || ''),
      nullable: String(row.is_nullable).toUpperCase() !== 'NO',
      defaultValue: row.column_default == null ? null : String(row.column_default),
      generated: String(row.is_generated || '').toUpperCase() === 'ALWAYS',
      identity: Boolean(row.identity_generation),
    });
    byTable.set(key, entries);
  }
  return byTable;
}

async function primaryKeysByTable(client: PostgresCompatibleClient, schemas: string[]): Promise<Map<string, string[]>> {
  const rows = await queryRows(client, `
    SELECT tc.table_schema, tc.table_name, kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = ANY($1)
    ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
  `, [schemas]);
  const byTable = new Map<string, string[]>();
  for (const row of rows) {
    const key = tableKey(String(row.table_schema), String(row.table_name));
    byTable.set(key, [...(byTable.get(key) ?? []), String(row.column_name)]);
  }
  return byTable;
}

async function uniqueIndexesByTable(client: PostgresCompatibleClient, schemas: string[]): Promise<Map<string, PostgresIntegrationUniqueIndex[]>> {
  const rows = await queryRows(client, `
    SELECT schemaname AS table_schema, tablename AS table_name, indexname AS index_name, indexdef
    FROM pg_catalog.pg_indexes
    WHERE schemaname = ANY($1)
    ORDER BY schemaname, tablename, indexname
  `, [schemas]).catch(() => []);
  const byTable = new Map<string, PostgresIntegrationUniqueIndex[]>();
  for (const row of rows) {
    const indexdef = String(row.indexdef ?? '');
    if (!/\bUNIQUE\b/i.test(indexdef)) {
      continue;
    }
    const key = tableKey(String(row.table_schema), String(row.table_name));
    const columns = /\(([^)]+)\)/.exec(indexdef)?.[1]
      ?.split(',')
      .map((column) => column.trim().replace(/^"|"$/g, '')) ?? [];
    byTable.set(key, [...(byTable.get(key) ?? []), {
      name: String(row.index_name),
      columns,
    }]);
  }
  return byTable;
}

async function foreignKeysByTable(client: PostgresCompatibleClient, schemas: string[]): Promise<Map<string, PostgresIntegrationForeignKey[]>> {
  const rows = await queryRows(client, `
    SELECT tc.constraint_name, tc.table_schema, tc.table_name,
      kcu.column_name, ccu.table_schema AS foreign_table_schema,
      ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = ANY($1)
    ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position
  `, [schemas]).catch(() => []);
  const grouped = new Map<string, PostgresIntegrationForeignKey>();
  for (const row of rows) {
    const key = `${tableKey(String(row.table_schema), String(row.table_name))}:${String(row.constraint_name)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.columns.push(String(row.column_name));
      existing.foreignColumns.push(String(row.foreign_column_name));
      continue;
    }
    grouped.set(key, {
      name: String(row.constraint_name),
      columns: [String(row.column_name)],
      foreignSchema: String(row.foreign_table_schema),
      foreignTable: String(row.foreign_table_name),
      foreignColumns: [String(row.foreign_column_name)],
    });
  }
  const byTable = new Map<string, PostgresIntegrationForeignKey[]>();
  for (const [key, value] of grouped) {
    const table = key.split(':')[0];
    byTable.set(table, [...(byTable.get(table) ?? []), value]);
  }
  return byTable;
}

async function triggersByTable(client: PostgresCompatibleClient, schemas: string[]): Promise<Map<string, PostgresIntegrationTrigger[]>> {
  const rows = await queryRows(client, `
    SELECT event_object_schema AS table_schema, event_object_table AS table_name,
      trigger_name, action_timing, event_manipulation
    FROM information_schema.triggers
    WHERE event_object_schema = ANY($1)
    ORDER BY event_object_schema, event_object_table, trigger_name
  `, [schemas]).catch(() => []);
  const grouped = new Map<string, PostgresIntegrationTrigger>();
  for (const row of rows) {
    const key = `${tableKey(String(row.table_schema), String(row.table_name))}:${String(row.trigger_name)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.events.push(String(row.event_manipulation));
    } else {
      grouped.set(key, {
        name: String(row.trigger_name),
        timing: String(row.action_timing),
        events: [String(row.event_manipulation)],
      });
    }
  }
  const byTable = new Map<string, PostgresIntegrationTrigger[]>();
  for (const [key, value] of grouped) {
    const table = key.split(':')[0];
    byTable.set(table, [...(byTable.get(table) ?? []), value]);
  }
  return byTable;
}

async function rlsPoliciesByTable(client: PostgresCompatibleClient, schemas: string[]): Promise<Map<string, PostgresIntegrationRlsPolicy[]>> {
  const rows = await queryRows(client, `
    SELECT schemaname AS table_schema, tablename AS table_name, policyname, cmd
    FROM pg_catalog.pg_policies
    WHERE schemaname = ANY($1)
    ORDER BY schemaname, tablename, policyname
  `, [schemas]).catch(() => []);
  const byTable = new Map<string, PostgresIntegrationRlsPolicy[]>();
  for (const row of rows) {
    const key = tableKey(String(row.table_schema), String(row.table_name));
    byTable.set(key, [...(byTable.get(key) ?? []), {
      name: String(row.policyname),
      command: String(row.cmd),
    }]);
  }
  return byTable;
}

async function estimatedRowsByTable(client: PostgresCompatibleClient, schemas: string[]): Promise<Map<string, number>> {
  const rows = await queryRows(client, `
    SELECT n.nspname AS table_schema, c.relname AS table_name, c.reltuples::bigint AS estimated_rows
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1)
  `, [schemas]).catch(() => []);
  const byTable = new Map<string, number>();
  for (const row of rows) {
    byTable.set(tableKey(String(row.table_schema), String(row.table_name)), Number(row.estimated_rows));
  }
  return byTable;
}

async function exactRowCount(client: PostgresCompatibleClient, schema: string, table: string): Promise<number | null> {
  try {
    const rows = await queryRows(client, `SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`);
    return Number(rows[0]?.count ?? 0);
  } catch {
    return null;
  }
}

function tableKind(type: string): PostgresIntegrationTableKind {
  const normalized = type.toUpperCase();
  if (normalized.includes('MATERIALIZED')) return 'materialized-view';
  if (normalized.includes('VIEW')) return 'view';
  if (normalized.includes('PARTITIONED')) return 'partitioned-table';
  return 'table';
}

function classifyTable(input: {
  kind: PostgresIntegrationTableKind;
  name: string;
  columns: PostgresIntegrationColumn[];
  primaryKey: string[];
  foreignKeys: PostgresIntegrationForeignKey[];
  triggers: PostgresIntegrationTrigger[];
  rlsPolicies: PostgresIntegrationRlsPolicy[];
}): string {
  const normalizedName = input.name.toLowerCase();
  const columnNames = new Set(input.columns.map((column) => column.name.toLowerCase()));
  const primaryColumns = input.columns.filter((column) => input.primaryKey.includes(column.name));
  if (input.kind === 'view' || input.kind === 'materialized-view') return input.kind;
  if (input.kind === 'partitioned-table') return 'partitioned-table';
  if (input.rlsPolicies.length > 0) return 'rls-protected';
  if (input.triggers.length > 0) return 'trigger-dependent';
  if (primaryColumns.some((column) => column.generated || column.identity)) return 'generated-primary-key';
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
    || normalizedName.includes('audit')
    || columnNames.has('created_at')
    || columnNames.has('timestamp')
    || columnNames.has('occurred_at')
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
): Promise<PostgresIntegrationReport['source']> {
  const files = targetKind === 'file'
    ? [targetPath]
    : await collectFiles(targetPath);
  const matches: PostgresIntegrationSourceMatch[] = [];
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

function scanFileContent(content: string, file: string): PostgresIntegrationSourceMatch[] {
  const matches: PostgresIntegrationSourceMatch[] = [];
  if (/(^|\/)src\/db\.(?:cjs|cts|js|mjs|mts|ts)$/i.test(file)) {
    matches.push({
      kind: 'db-facade-file',
      file,
      line: 1,
      snippet: file,
      confidence: 'medium',
    });
  }
  if (isPostgresMigrationPath(file)) {
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

function isPostgresMigrationPath(file: string): boolean {
  return /(^|\/)(prisma\/schema\.prisma|prisma\/migrations|drizzle\.config\.[cm]?[jt]s|drizzle\/|knexfile\.[cm]?[jt]s|migrations?\/|sequelize\/|typeorm\/)/i.test(file)
    || /\.sql$/i.test(file);
}

function scanLine(line: string, file: string, lineNumber: number): PostgresIntegrationSourceMatch[] {
  const matches: PostgresIntegrationSourceMatch[] = [];
  const add = (kind: string, confidence: 'high' | 'medium' | 'low' = 'high') => {
    matches.push({
      kind,
      file,
      line: lineNumber,
      snippet: line.trim().replace(/\s+/g, ' ').slice(0, 160),
      confidence,
    });
  };

  if (hasPackageImport(line, 'pg')) add('pg-import');
  if (hasPackageImport(line, 'postgres')) add('postgres-js-import');
  if (hasPackageImport(line, '@neondatabase/serverless')) add('neon-serverless-import');
  if (hasPackageImport(line, '@vercel/postgres')) add('vercel-postgres-import');
  if (hasPackageImport(line, 'pg-promise')) add('pg-promise-import');
  if (hasPackageImport(line, '@prisma/client') || /\bPrismaClient\b/.test(line)) add('prisma-usage', 'medium');
  if (hasPackageImport(line, 'drizzle-orm') || hasPackageImport(line, 'drizzle-orm/pg-core')) add('drizzle-import', 'medium');
  if (hasPackageImport(line, 'kysely')) add('kysely-import', 'medium');
  if (hasPackageImport(line, 'knex')) add('knex-import', 'medium');
  if (hasPackageImport(line, 'sequelize')) add('sequelize-import', 'medium');
  if (hasPackageImport(line, 'typeorm')) add('typeorm-import', 'medium');
  if (hasPackageImport(line, '@mikro-orm/core') || hasPackageImport(line, '@mikro-orm/postgresql')) add('mikro-orm-import', 'medium');
  if (hasPackageImport(line, 'objection')) add('objection-import', 'medium');
  if (hasPackageImport(line, 'slonik')) add('slonik-import', 'medium');
  if (hasPackageImport(line, '@supabase/supabase-js')) add('supabase-import', 'medium');
  if (/\bnew\s+(?:Pool|Client)\s*\(/.test(line)) add('postgres-open-call');
  if (/\b(?:pool|client|db|sql)\.query\s*\(/.test(line)) add('postgres-query-call', 'medium');
  if (/\bCREATE\s+TABLE\b/i.test(line)) add('create-table-sql');
  if (/\bALTER\s+TABLE\b/i.test(line)) add('alter-table-sql');
  if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(line)) add('create-index-sql');
  if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(line)) add('postgres-write-sql', 'medium');
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,120}\bFROM\b/i.test(line)) add('raw-sql', 'medium');

  return matches;
}

function detectPostgresDrivers(matches: PostgresIntegrationSourceMatch[]): PostgresIntegrationReport['postgres']['drivers'] {
  const detected = new Set<PostgresIntegrationDriver>();
  const ormDetected = new Set<string>();
  for (const match of matches) {
    if (match.kind === 'pg-import') detected.add('pg');
    if (match.kind === 'postgres-js-import') detected.add('postgres');
    if (match.kind === 'neon-serverless-import') detected.add('@neondatabase/serverless');
    if (match.kind === 'vercel-postgres-import') detected.add('@vercel/postgres');
    if (match.kind === 'pg-promise-import') detected.add('pg-promise');
    if (match.kind === 'prisma-usage') ormDetected.add('prisma');
    if (match.kind === 'drizzle-import') ormDetected.add('drizzle');
    if (match.kind === 'kysely-import') ormDetected.add('kysely');
    if (match.kind === 'knex-import') ormDetected.add('knex');
    if (match.kind === 'sequelize-import') ormDetected.add('sequelize');
    if (match.kind === 'typeorm-import') ormDetected.add('typeorm');
    if (match.kind === 'mikro-orm-import') ormDetected.add('mikro-orm');
    if (match.kind === 'objection-import') ormDetected.add('objection');
    if (match.kind === 'slonik-import') ormDetected.add('slonik');
    if (match.kind === 'supabase-import') ormDetected.add('supabase');
  }
  const ordered: PostgresIntegrationDriver[] = ['pg', 'postgres', '@neondatabase/serverless', '@vercel/postgres', 'pg-promise'];
  const detectedList = ordered.filter((driver) => detected.has(driver));
  return {
    detected: detectedList,
    recommended: detectedList[0] ?? 'pg',
    ormDetected: [...ormDetected].sort(),
  };
}

function buildRecommendations(
  tables: PostgresIntegrationTable[],
  sourceMatches: PostgresIntegrationSourceMatch[],
): PostgresIntegrationRecommendation[] {
  const recommendations = tables.map((table) => recommendationForTable(table));
  if (sourceMatches.some((match) => ORM_KINDS.includes(match.kind))) {
    recommendations.push({
      kind: 'manual-review',
      table: null,
      confidence: 'medium',
      message: 'A higher-level Postgres toolkit was detected in source.',
      nextStep: 'Wrap the existing ORM/query-builder facade with Async DB operations; do not bypass its migrations, hooks, transactions, or RLS assumptions.',
      adoptionPath: adoptionPath('app-owned-sql', 'app-owned-sql', 'not-recommended', 'ORM/query-builder ownership should stay app-owned until an explicit adapter is designed.'),
      details: {
        matchedKinds: uniqueKinds(sourceMatches, ORM_KINDS),
      },
    });
  }
  if (sourceMatches.some((match) => match.kind === 'db-facade-file')) {
    recommendations.push({
      kind: 'manual-review',
      table: null,
      confidence: 'medium',
      message: 'A likely DB facade was detected.',
      nextStep: 'Keep the facade and expose selected methods through Async DB operations before changing the Postgres implementation.',
      adoptionPath: adoptionPath('operation-wrapper', 'operations', 'optional-later', 'Existing facades are the safest first boundary for async operation wrappers.'),
      details: {
        files: [...new Set(sourceMatches.filter((match) => match.kind === 'db-facade-file').map((match) => match.file))],
      },
    });
  }
  return recommendations;
}

function recommendationForTable(table: PostgresIntegrationTable): PostgresIntegrationRecommendation {
  const label = qualifiedTable(table);
  if (table.kind === 'view' || table.kind === 'materialized-view') {
    return {
      kind: 'read-model',
      table: label,
      confidence: 'high',
      message: `Postgres ${table.kind} "${label}" is a good read-model candidate.`,
      nextStep: `Expose "${label}" as dashboard/read-only data before attempting writes through @async/db.`,
      adoptionPath: adoptionPath('read-model', 'read-model', 'not-recommended', 'Postgres views and materialized views should remain read-only and app-owned.'),
      details: { classification: table.classification },
    };
  }

  switch (table.classification) {
    case 'single-primary-key':
      return {
        kind: 'direct-resource',
        table: label,
        confidence: 'high',
        message: `Table "${label}" has a single non-generated primary key and can be mapped to an @async/db collection shape.`,
        nextStep: `Add db/${resourceFileName(table.name)}.schema.jsonc and map it with openPostgresDb({ tables }) over the existing Postgres table before considering storage migration.`,
        adoptionPath: adoptionPath('table-backed-adapter', 'table-adapter', 'optional-later', 'A single non-generated primary key can be mapped to row-level Async DB collection methods without rewriting the table.'),
        details: { primaryKey: table.primaryKey, classification: table.classification },
      };
    case 'document-settings':
      return {
        kind: 'direct-resource',
        table: label,
        confidence: 'medium',
        message: `Table "${label}" looks like settings or singleton document state.`,
        nextStep: 'Wrap the existing key/value access first; model it as an @async/db document or small collection only after preserving caller behavior.',
        adoptionPath: adoptionPath('operation-wrapper', 'operations', 'optional-later', 'Settings tables often carry app-specific key/value semantics that should be preserved behind operations first.'),
        details: { classification: table.classification },
      };
    case 'event-log':
      return {
        kind: 'read-model',
        table: label,
        confidence: 'high',
        message: `Table "${label}" looks like an event/log table.`,
        nextStep: 'Keep writes app-owned and expose @async/db read-model/dashboard resources for timeline and aggregate views.',
        adoptionPath: adoptionPath('read-model', 'read-model', 'not-recommended', 'Event and log tables are usually append-heavy data-plane tables, so Async DB should read them before owning writes.'),
        details: { classification: table.classification },
      };
    case 'compound-primary-key':
    case 'join-table':
      return {
        kind: 'custom-store',
        table: label,
        confidence: 'high',
        message: `Table "${label}" needs more than the default collection mapping.`,
        nextStep: `Keep this table app-owned and expose Async DB operations that accept the real key shape, such as ${compoundKeyExample(table.primaryKey)}.`,
        adoptionPath: adoptionPath('app-owned-sql', 'operations', 'not-recommended', 'Compound and join-table keys should not receive surrogate ids during wrapper-first integration.'),
        details: { classification: table.classification, primaryKey: table.primaryKey, keyExample: compoundKeyExample(table.primaryKey) },
      };
    case 'rls-protected':
    case 'trigger-dependent':
    case 'generated-primary-key':
    case 'partitioned-table':
    case 'no-primary-key':
    default:
      return {
        kind: 'app-owned-sql',
        table: label,
        confidence: 'medium',
        message: `Table "${label}" should remain app-owned SQL during initial Async DB adoption.`,
        nextStep: 'Wrap existing access through Async DB operations; do not generate direct writes that bypass RLS, triggers, generated columns, partitions, or app-defined identity.',
        adoptionPath: adoptionPath('app-owned-sql', 'app-owned-sql', 'not-recommended', 'This table has database behavior that cannot be safely preserved by generic collection writes.'),
        details: {
          classification: table.classification,
          primaryKey: table.primaryKey,
          triggers: table.triggers.map((trigger) => trigger.name),
          rlsPolicies: table.rlsPolicies.map((policy) => policy.name),
        },
      };
  }
}

function adoptionPath(
  kind: PostgresIntegrationAdoptionPathKind,
  asyncDbSurface: PostgresIntegrationAdoptionPath['asyncDbSurface'],
  storageMigration: PostgresIntegrationAdoptionPath['storageMigration'],
  reason: string,
): PostgresIntegrationAdoptionPath {
  return {
    kind,
    sourceOfTruth: 'existing-postgres',
    asyncDbSurface,
    storageMigration,
    reason,
  };
}

function buildImportPlan(input: {
  cwd: string;
  tables: PostgresIntegrationTable[];
  drivers: PostgresIntegrationReport['postgres']['drivers'];
  schemas: string[];
  connectionStringEnv: string;
  targetState?: string;
  targetPostgresTable?: string;
}): PostgresIntegrationImportPlan {
  const target = input.targetState
    ? {
      kind: 'sqlite-state' as const,
      stateFile: relativeProjectPath(input.cwd, input.targetState),
    }
    : {
      kind: 'postgres-envelope' as const,
      connectionStringEnv: input.connectionStringEnv,
      driver: input.drivers.recommended,
      ...parsePostgresTargetTable(input.targetPostgresTable ?? 'public._async_db_resources'),
    };
  const resources = input.tables
    .filter((table) => table.kind === 'table' || table.kind === 'partitioned-table')
    .map((table) => importResourceForTable(table));
  const warnings = [
    'Import mode copies legacy Postgres rows into Async DB-owned state only when the generated importer is run with --apply.',
    'Review generated schemas, table classifications, RLS, triggers, and parity tests before retiring the existing Postgres write path.',
  ];
  if (resources.some((resource) => (resource.estimatedRows ?? 0) > 100_000)) {
    warnings.push('One or more tables look large. Keep the generated importer batched and run it against a tested backup first.');
  }
  return {
    version: 1,
    kind: 'postgres.importPlan',
    source: {
      connectionStringEnv: input.connectionStringEnv,
      driver: input.drivers.recommended,
      schemas: input.schemas,
    },
    target,
    resources,
    batchSize: 500,
    warnings,
  };
}

function importResourceForTable(table: PostgresIntegrationTable): PostgresIntegrationImportResource {
  const resource = camelCase(table.name);
  const base = {
    resource,
    schema: table.schema,
    table: table.name,
    primaryKey: table.primaryKey,
    fields: fieldsForImportTable(table),
    columns: Object.fromEntries(table.columns.map((column) => [column.name, column.name])),
    estimatedRows: table.estimatedRows,
    batchSize: 500,
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

function fieldsForImportTable(table: PostgresIntegrationTable): PostgresIntegrationImportResource['fields'] {
  return Object.fromEntries(table.columns.map((column) => [
    column.name,
    {
      type: postgresTypeForImport(column.type),
      ...(!column.nullable || table.primaryKey.includes(column.name) ? { required: true } : {}),
    },
  ]));
}

function postgresTypeForImport(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes('int') || normalized.includes('numeric') || normalized.includes('real') || normalized.includes('double')) {
    return 'number';
  }
  if (normalized.includes('bool')) {
    return 'boolean';
  }
  if (normalized.includes('json')) {
    return 'object';
  }
  if (normalized.includes('timestamp') || normalized.includes('date')) {
    return 'datetime';
  }
  return 'string';
}

function buildSuggestions(
  tables: PostgresIntegrationTable[],
  sourceMatches: PostgresIntegrationSourceMatch[],
  recommendations: PostgresIntegrationRecommendation[],
  mode: PostgresIntegrationReport['postgres']['mode'],
  catalogErrors: PostgresIntegrationReport['postgres']['errors'],
  importPlan?: PostgresIntegrationImportPlan,
): PostgresIntegrationSuggestion[] {
  const suggestions: PostgresIntegrationSuggestion[] = [
    {
      code: 'INTEGRATE_KEEP_EXISTING_POSTGRES_SOURCE',
      severity: 'info',
      table: null,
      message: 'Existing Postgres should remain the write source of truth during initial Async DB adoption.',
      hint: 'Start by adding Async DB contracts, operations, table adapters, and read models over the existing Postgres database; move storage only as an explicit later migration.',
      details: {
        postgresTables: tables.length,
        mode,
      },
    },
  ];

  if (mode === 'partial') {
    suggestions.push({
      code: 'INTEGRATE_POSTGRES_CATALOG_PARTIAL',
      severity: 'warning',
      table: null,
      message: 'Postgres catalog inspection was partial.',
      hint: 'Fix the read-only catalog connection or pass --allow-partial only when source-only guidance is acceptable.',
      details: {
        errors: catalogErrors,
      },
    });
  }

  const lowLevelKinds = ['pg-import', 'postgres-js-import', 'neon-serverless-import', 'vercel-postgres-import', 'pg-promise-import'];

  if (sourceMatches.some((match) => [...lowLevelKinds, 'postgres-open-call', 'postgres-query-call', 'postgres-write-sql'].includes(match.kind))) {
    suggestions.push({
      code: 'INTEGRATE_WRAP_EXISTING_POSTGRES_FACADE',
      severity: 'warning',
      table: null,
      message: 'Direct Postgres usage or an existing DB facade was detected.',
      hint: 'Keep the current Postgres module underneath an async Async DB operation wrapper instead of replacing call sites with a new store in one step.',
      details: {
        matchedKinds: uniqueKinds(sourceMatches, [...lowLevelKinds, 'postgres-open-call', 'postgres-query-call', 'postgres-write-sql', 'db-facade-file']),
      },
    });
  }

  if (sourceMatches.some((match) => lowLevelKinds.includes(match.kind))) {
    suggestions.push({
      code: 'INTEGRATE_USE_POSTGRES_COMPAT_DRIVER',
      severity: 'info',
      table: null,
      message: 'Low-level Postgres driver imports were detected.',
      hint: 'Use @async/db/postgres/compat to inject existing pg, postgres.js, Neon, Vercel Postgres, or pg-promise clients into Async DB wrappers/importers.',
      details: {
        matchedKinds: uniqueKinds(sourceMatches, lowLevelKinds),
      },
    });
  }

  if (sourceMatches.some((match) => ['raw-sql', 'postgres-query-call'].includes(match.kind))) {
    suggestions.push({
      code: 'INTEGRATE_POSTGRES_QUERY_AGGREGATION_API',
      severity: 'info',
      table: null,
      message: 'Postgres query calls were detected that may include filtered reads or aggregations.',
      hint: 'Move common dashboard reads to Async DB collection find/count/aggregate helpers or registered operations before reintroducing raw SQL.',
      details: {
        matchedKinds: uniqueKinds(sourceMatches, ['raw-sql', 'postgres-query-call']),
      },
    });
  }

  if (importPlan) {
    suggestions.push({
      code: importPlan.target.kind === 'sqlite-state'
        ? 'INTEGRATE_IMPORT_TO_ASYNC_DB_STATE'
        : 'INTEGRATE_IMPORT_TO_POSTGRES_STORE',
      severity: 'warning',
      table: null,
      message: importPlan.target.kind === 'sqlite-state'
        ? `Explicit import mode will copy Postgres rows into Async DB-owned local state at ${importPlan.target.stateFile}.`
        : `Explicit import mode will copy Postgres rows into Async DB-owned Postgres table ${importPlan.target.schema}.${importPlan.target.table}.`,
      hint: 'Review the generated import plan, run the importer in dry-run mode first, then pass --apply only after parity tests pass.',
      details: {
        target: importPlan.target,
        resources: importPlan.resources.map((resource) => resource.resource),
      },
    });
  }

  for (const recommendation of recommendations) {
    if (!recommendation.table) continue;
    if (recommendation.adoptionPath?.kind === 'table-backed-adapter') {
      suggestions.push({
        code: 'INTEGRATE_POSTGRES_TABLE_ADAPTER_CANDIDATE',
        severity: 'info',
        table: recommendation.table,
        message: `Table "${recommendation.table}" can be mapped with a table-backed adapter.`,
        hint: 'Keep the Postgres database in place and use row-level adapter methods for reads and writes; do not move it into Async DB-owned storage.',
        details: recommendation.details,
      });
    }
    if (recommendation.adoptionPath?.kind === 'read-model') {
      suggestions.push({
        code: 'INTEGRATE_POSTGRES_READ_MODEL_FIRST',
        severity: 'info',
        table: recommendation.table,
        message: `Table "${recommendation.table}" should start as a read model.`,
        hint: 'Expose dashboards, views, event logs, and aggregates as read-only Async DB surfaces before attempting write ownership.',
        details: recommendation.details,
      });
    }
    if (importPlan?.resources.some((resource) => qualifiedResourceTable(resource) === recommendation.table && resource.importKind === 'append-only')) {
      suggestions.push({
        code: 'INTEGRATE_POSTGRES_APPEND_ONLY_EVENT_LOG',
        severity: 'info',
        table: recommendation.table,
        message: `Table "${recommendation.table}" should import as an append-only resource.`,
        hint: 'Use collection.append(record) for event writes and block update/delete behavior after import.',
        details: recommendation.details,
      });
    }
    if (recommendation.details.primaryKey && Array.isArray(recommendation.details.primaryKey) && recommendation.details.primaryKey.length > 1) {
      suggestions.push({
        code: 'INTEGRATE_POSTGRES_OBJECT_KEY_OPERATIONS',
        severity: 'warning',
        table: recommendation.table,
        message: `Table "${recommendation.table}" has a compound primary key.`,
        hint: `Do not add a surrogate id by default. Expose Async DB operations that accept the real key shape, such as ${compoundKeyExample(recommendation.details.primaryKey)}.`,
        details: recommendation.details,
      });
    }
  }

  if (sourceMatches.some((match) => ORM_KINDS.includes(match.kind))) {
    suggestions.push({
      code: 'INTEGRATE_POSTGRES_ORM_MANUAL_REVIEW',
      severity: 'warning',
      table: null,
      message: 'An ORM or query builder owns part of the Postgres access layer.',
      hint: 'Wrap ORM-backed functions with Async DB operations; do not generate direct table writes that bypass ORM schema, hooks, transactions, or RLS assumptions.',
      details: {
        matchedKinds: uniqueKinds(sourceMatches, ORM_KINDS),
      },
    });
  }

  return dedupeSuggestions(suggestions);
}

function buildSuggestedFiles(
  recommendations: PostgresIntegrationRecommendation[],
  importPlan?: PostgresIntegrationImportPlan,
): PostgresIntegrationReport['suggestedFiles'] {
  const files = new Map<string, string>();
  files.set('db.config.js', 'Configure @async/db resources, outputs, and optional stores.');
  files.set('src/generated/db.viewer.json', 'Optional committed viewer manifest for dashboard builders and AI agents.');
  files.set('src/generated/db.schema.json', 'Optional committed schema manifest for form/admin UI generation.');
  for (const recommendation of recommendations) {
    if (!recommendation.table) continue;
    const tableName = recommendation.table.split('.').pop() ?? recommendation.table;
    if (recommendation.kind === 'direct-resource') {
      files.set(`db/${resourceFileName(tableName)}.schema.jsonc`, `Schema contract for Postgres table "${recommendation.table}".`);
      if (recommendation.adoptionPath?.kind === 'table-backed-adapter') {
        files.set(`src/db/${camelCase(tableName)}TableAdapter.ts`, `Table-backed adapter that maps "${recommendation.table}" without rewriting Postgres schema.`);
      }
    }
    if (recommendation.kind === 'read-model') {
      files.set(`src/db/${camelCase(tableName)}ReadModel.ts`, `Read-only adapter for dashboard/query views based on "${recommendation.table}".`);
    }
    if (recommendation.kind === 'custom-store') {
      files.set(`src/db/${camelCase(tableName)}Operations.ts`, `Operation wrapper that preserves the existing Postgres identity for "${recommendation.table}".`);
    }
  }
  if (importPlan) {
    files.set('src/generated/db.integration.json', 'Committed integration report with explicit Postgres import plan.');
    files.set('scripts/import-legacy-postgres.js', 'Generated dry-run importer from existing Postgres into Async DB-owned state.');
  }
  return [...files.entries()].map(([filePath, purpose]) => ({ path: filePath, purpose }));
}

function buildAgentInstructions(
  recommendations: PostgresIntegrationRecommendation[],
  suggestedFiles: PostgresIntegrationReport['suggestedFiles'],
  importPlan?: PostgresIntegrationImportPlan,
): string[] {
  const direct = recommendations.filter((entry) => entry.kind === 'direct-resource' && entry.table).map((entry) => entry.table);
  const readModels = recommendations.filter((entry) => entry.kind === 'read-model' && entry.table).map((entry) => entry.table);
  const custom = recommendations.filter((entry) => ['custom-store', 'app-owned-sql'].includes(entry.kind) && entry.table).map((entry) => entry.table);
  const instructions = [
    'Keep the existing Postgres database as the write source of truth during initial adoption.',
    'Start with operation wrappers and read-only integration; do not replace existing Postgres writes until tests prove parity.',
    'Add db.config.js and committed schema/viewer manifest outputs before building custom dashboard UI.',
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
    instructions.push('Generate and dry-run a legacy Postgres importer before applying it.');
  }
  instructions.push('Run async-db doctor --production after adding schemas and outputs.');
  return instructions;
}

function parsePostgresTargetTable(value: string): { schema: string; table: string } {
  const parts = value.split('.').filter(Boolean);
  if (parts.length >= 2) {
    return {
      schema: parts.slice(0, -1).join('.'),
      table: parts[parts.length - 1],
    };
  }
  return {
    schema: 'public',
    table: value,
  };
}

const ORM_KINDS = [
  'prisma-usage',
  'drizzle-import',
  'kysely-import',
  'knex-import',
  'sequelize-import',
  'typeorm-import',
  'mikro-orm-import',
  'objection-import',
  'slonik-import',
  'supabase-import',
];

function uniqueKinds(matches: PostgresIntegrationSourceMatch[], kinds: string[]): string[] {
  return [...new Set(matches.map((match) => match.kind).filter((kind) => kinds.includes(kind)))];
}

function dedupeSuggestions(suggestions: PostgresIntegrationSuggestion[]): PostgresIntegrationSuggestion[] {
  const seen = new Set<string>();
  const deduped: PostgresIntegrationSuggestion[] = [];
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
  const entries = fields.length > 0 ? fields : ['tenantId', 'slug'];
  return `{ ${entries.map((field) => `${field}: ...`).join(', ')} }`;
}

function hasPackageImport(line: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:from\\s+|import\\s*\\(|require\\s*\\()["']${escaped}["']`).test(line);
}

function dedupeMatches(matches: PostgresIntegrationSourceMatch[]): PostgresIntegrationSourceMatch[] {
  const seen = new Set<string>();
  const deduped: PostgresIntegrationSourceMatch[] = [];
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

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function qualifiedTable(table: { schema: string; name: string }): string {
  return `${table.schema}.${table.name}`;
}

function qualifiedResourceTable(resource: { schema: string; table: string }): string {
  return `${resource.schema}.${resource.table}`;
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
    .join('') || 'postgres';
}

function relativeProjectPath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);
  return relative === '' ? '.' : relative.split(path.sep).join('/');
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right);
}

function redactConnectionStrings(value: string): string {
  return value.replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, 'postgres://<redacted>');
}
