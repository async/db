import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseJsonc } from '../../jsonc.js';
import { camelCase, pascalCase } from '../../names.js';

type SourceKind =
  | 'prisma'
  | 'drizzle'
  | 'sql'
  | 'json-schema'
  | 'openapi'
  | 'validator'
  | 'orm'
  | 'migration-file';

export type SchemaMigrationField = {
  type: string;
  required?: boolean;
  nullable?: boolean;
  description?: string;
  default?: unknown;
  unique?: boolean;
  values?: unknown[];
  items?: SchemaMigrationField;
  fields?: Record<string, SchemaMigrationField>;
  additionalProperties?: boolean;
  readOnly?: boolean;
  derived?: {
    source: 'database' | 'external' | string;
    kind: string;
    owner?: string;
    details?: Record<string, unknown>;
  };
  relation?: {
    name?: string;
    to: string;
    toField?: string;
    cardinality?: 'one' | 'many';
  };
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  [key: string]: unknown;
};

export type SchemaMigrationResource = {
  name: string;
  kind: 'collection' | 'document';
  idField?: string;
  fields: Record<string, SchemaMigrationField>;
  source: {
    kind: SourceKind;
    file: string;
    exportName?: string;
    modelName?: string;
  };
  output: {
    format: 'jsonc' | 'schema-module';
    file: string;
    requiresExecutable: boolean;
  };
  warnings: string[];
};

export type SchemaMigrationSuggestion = {
  code: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  hint?: string;
  file?: string;
  resource?: string;
  details?: Record<string, unknown>;
};

export type SchemaMigrationSourceMatch = {
  kind: SourceKind | 'package' | 'raw-sql';
  file: string;
  line?: number;
  package?: string;
  symbol?: string;
  message: string;
};

export type SchemaMigrationOutputPlan = {
  schemaDir: string;
  format: 'mixed' | 'jsonc';
  resources: Array<{
    name: string;
    file: string;
    format: 'jsonc' | 'schema-module';
    requiresExecutable: boolean;
  }>;
};

export type SchemaMigrationReport = {
  kind: 'db.schemaMigrationReport';
  version: 1;
  generatedAt: string;
  target: {
    path: string;
  };
  source: {
    filesScanned: number;
    filesWithMatches: number;
    matches: SchemaMigrationSourceMatch[];
  };
  resources: SchemaMigrationResource[];
  suggestions: SchemaMigrationSuggestion[];
  outputPlan: SchemaMigrationOutputPlan;
};

export type InspectSchemaMigrationOptions = {
  cwd: string;
  target?: string;
  schemaDir?: string;
  format?: 'mixed' | 'jsonc';
  generatedAt?: string;
  ignorePaths?: string[];
};

export type GenerateSchemaMigrationOptions = {
  cwd: string;
  plan: SchemaMigrationReport;
  schemaDir?: string;
  format?: 'mixed' | 'jsonc';
  force?: boolean;
};

export type GenerateSchemaMigrationResult = {
  files: string[];
  diagnostics: SchemaMigrationSuggestion[];
};

type SourceFile = {
  absolute: string;
  relative: string;
  text: string;
};

type ResourceDraft = Omit<SchemaMigrationResource, 'output'> & {
  requiresExecutable?: boolean;
  importName?: string;
};

const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.prisma',
  '.sql',
  '.json',
  '.jsonc',
]);

const IGNORED_DIRS = new Set([
  '.git',
  '.db',
  '.tmp',
  'coverage',
  'dist',
  'node_modules',
]);

const PACKAGE_PATTERNS: Array<{ kind: SourceKind | 'package'; package: string; pattern: RegExp; message: string }> = [
  { kind: 'prisma', package: '@prisma/client', pattern: /from\s+['"]@prisma\/client['"]|require\(['"]@prisma\/client['"]\)/u, message: 'Prisma client import detected.' },
  { kind: 'drizzle', package: 'drizzle-orm', pattern: /from\s+['"]drizzle-orm(?:\/[^'"]*)?['"]|require\(['"]drizzle-orm/u, message: 'Drizzle schema/query import detected.' },
  { kind: 'orm', package: 'knex', pattern: /from\s+['"]knex['"]|require\(['"]knex['"]\)|knexfile\./u, message: 'Knex schema or migration usage detected.' },
  { kind: 'orm', package: 'sequelize', pattern: /from\s+['"]sequelize['"]|require\(['"]sequelize['"]\)/u, message: 'Sequelize model usage detected.' },
  { kind: 'orm', package: 'typeorm', pattern: /from\s+['"]typeorm['"]|require\(['"]typeorm['"]\)/u, message: 'TypeORM model usage detected.' },
  { kind: 'orm', package: '@mikro-orm/core', pattern: /from\s+['"]@mikro-orm\/core['"]|require\(['"]@mikro-orm\/core['"]\)/u, message: 'MikroORM model usage detected.' },
  { kind: 'validator', package: 'zod', pattern: /from\s+['"]zod['"]|require\(['"]zod['"]\)|\bz\.\s*object\s*\(/u, message: 'Zod validator schema usage detected.' },
  { kind: 'validator', package: 'valibot', pattern: /from\s+['"]valibot['"]|require\(['"]valibot['"]\)|\bv\.\s*object\s*\(/u, message: 'Valibot validator schema usage detected.' },
  { kind: 'validator', package: 'arktype', pattern: /from\s+['"]arktype['"]|require\(['"]arktype['"]\)|\btype\s*\(/u, message: 'ArkType validator schema usage detected.' },
  { kind: 'json-schema', package: '@sinclair/typebox', pattern: /from\s+['"]@sinclair\/typebox['"]|require\(['"]@sinclair\/typebox['"]\)|\bType\.\s*Object\s*\(/u, message: 'TypeBox JSON Schema authoring detected.' },
];

export async function inspectSchemaMigration(options: InspectSchemaMigrationOptions): Promise<SchemaMigrationReport> {
  const cwd = path.resolve(options.cwd);
  const target = path.resolve(cwd, options.target ?? '.');
  const schemaDir = normalizeRelative(cwd, path.resolve(cwd, options.schemaDir ?? './db'));
  const format = options.format ?? 'mixed';
  const ignored = new Set((options.ignorePaths ?? []).map((filePath) => normalizeRelative(cwd, path.resolve(cwd, filePath))));
  const files = await sourceFiles(cwd, target, ignored);
  const matches: SchemaMigrationSourceMatch[] = [];
  const resources = new Map<string, ResourceDraft>();
  const suggestions: SchemaMigrationSuggestion[] = [];
  const filesWithMatches = new Set<string>();

  for (const file of files) {
    const before = matches.length;
    matches.push(...detectSourceMatches(file));
    for (const resource of parseResources(file, suggestions)) {
      mergeResource(resources, resource, suggestions);
    }
    if (matches.length > before || [...resources.values()].some((resource) => resource.source.file === file.relative)) {
      filesWithMatches.add(file.relative);
    }
  }

  if (resources.size === 0) {
    suggestions.push({
      code: 'SCHEMA_MIGRATION_NO_RESOURCES',
      severity: 'warn',
      message: 'No schema declarations could be converted into Async DB schema drafts.',
      hint: 'Run schema migrate inspect against the folder that contains Prisma, Drizzle, SQL, JSON Schema, OpenAPI, or validator declarations.',
    });
  }

  for (const match of matches) {
    if (match.kind === 'orm' || match.kind === 'validator') {
      suggestions.push({
        code: match.kind === 'validator' ? 'SCHEMA_MIGRATION_REVIEW_VALIDATOR' : 'SCHEMA_MIGRATION_REVIEW_ORM',
        severity: 'info',
        file: match.file,
        message: match.message,
        hint: match.kind === 'validator'
          ? 'Generated JSONC captures field metadata; keep executable parsing behavior in .schema.mjs when it matters.'
          : 'Review generated fields before switching app code from the existing ORM or migration-owned schema.',
      });
    }
  }

  const reportResources = [...resources.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((resource) => finalizeResource(resource, schemaDir, format));

  return {
    kind: 'db.schemaMigrationReport',
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    target: {
      path: normalizeRelative(cwd, target),
    },
    source: {
      filesScanned: files.length,
      filesWithMatches: filesWithMatches.size,
      matches,
    },
    resources: reportResources,
    suggestions,
    outputPlan: {
      schemaDir,
      format,
      resources: reportResources.map((resource) => ({
        name: resource.name,
        file: resource.output.file,
        format: resource.output.format,
        requiresExecutable: resource.output.requiresExecutable,
      })),
    },
  };
}

export function normalizeSchemaMigrationReportForCheck(report: SchemaMigrationReport): SchemaMigrationReport {
  return {
    ...report,
    generatedAt: '<generated>',
  };
}

export async function writeSchemaMigrationReport(filePath: string, report: SchemaMigrationReport): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export async function generateSchemaMigrationOutputs(options: GenerateSchemaMigrationOptions): Promise<GenerateSchemaMigrationResult> {
  const cwd = path.resolve(options.cwd);
  const format = options.format ?? options.plan.outputPlan?.format ?? 'mixed';
  const schemaDir = path.resolve(cwd, options.schemaDir ?? options.plan.outputPlan?.schemaDir ?? './db');
  const files: string[] = [];
  const diagnostics: SchemaMigrationSuggestion[] = [];

  for (const resource of options.plan.resources) {
    const outputFormat = format === 'jsonc' ? 'jsonc' : resource.output.format;
    const outFile = outputFormat === 'schema-module'
      ? path.join(schemaDir, `${resource.name}.schema.mjs`)
      : path.join(schemaDir, `${resource.name}.schema.jsonc`);
    const relative = normalizeRelative(cwd, outFile);
    const exists = await fileExists(outFile);
    if (exists && options.force !== true) {
      const error = new Error(`SCHEMA_MIGRATION_OUTPUT_EXISTS: ${relative} already exists.`) as Error & { code?: string };
      error.code = 'SCHEMA_MIGRATION_OUTPUT_EXISTS';
      throw error;
    }

    if (format === 'jsonc' && resource.output.requiresExecutable) {
      diagnostics.push({
        code: 'SCHEMA_MIGRATION_EXECUTABLE_DROPPED',
        severity: 'warn',
        resource: resource.name,
        file: relative,
        message: `Generated JSONC for "${resource.name}" without executable validator or resolver behavior.`,
        hint: 'Use --format mixed when the original validator must keep running through a .schema.mjs draft.',
      });
    }

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, outputFormat === 'schema-module'
      ? renderSchemaModule(resource, cwd)
      : renderJsoncSchema(resource), 'utf8');
    files.push(relative);
  }

  return {
    files,
    diagnostics,
  };
}

function finalizeResource(resource: ResourceDraft, schemaDir: string, format: 'mixed' | 'jsonc'): SchemaMigrationResource {
  const requiresExecutable = resource.requiresExecutable === true;
  const outputFormat = format === 'mixed' && requiresExecutable ? 'schema-module' : 'jsonc';
  return {
    name: resource.name,
    kind: resource.kind,
    idField: resource.idField,
    fields: resource.fields,
    source: resource.source,
    warnings: resource.warnings,
    output: {
      format: outputFormat,
      file: path.posix.join(schemaDir, `${resource.name}.schema.${outputFormat === 'schema-module' ? 'mjs' : 'jsonc'}`),
      requiresExecutable,
    },
  };
}

async function sourceFiles(cwd: string, target: string, ignored: Set<string>): Promise<SourceFile[]> {
  const entries: SourceFile[] = [];
  const targetStat = await stat(target);
  if (targetStat.isFile()) {
    const relative = normalizeRelative(cwd, target);
    if (!ignored.has(relative) && SOURCE_EXTENSIONS.has(path.extname(target))) {
      entries.push({
        absolute: target,
        relative,
        text: await readFile(target, 'utf8'),
      });
    }
    return entries;
  }

  await walk(cwd, target, ignored, entries);
  return entries.sort((left, right) => left.relative.localeCompare(right.relative));
}

async function walk(cwd: string, dir: string, ignored: Set<string>, entries: SourceFile[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = normalizeRelative(cwd, absolute);
    if (ignored.has(relative)) {
      continue;
    }
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walk(cwd, absolute, ignored, entries);
      }
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    entries.push({
      absolute,
      relative,
      text: await readFile(absolute, 'utf8'),
    });
  }
}

function detectSourceMatches(file: SourceFile): SchemaMigrationSourceMatch[] {
  const matches: SchemaMigrationSourceMatch[] = [];
  for (const pattern of PACKAGE_PATTERNS) {
    if (pattern.pattern.test(file.text) || file.relative.includes(pattern.package)) {
      matches.push({
        kind: pattern.kind,
        file: file.relative,
        package: pattern.package,
        message: pattern.message,
      });
    }
  }

  if (/CREATE\s+TABLE|CREATE\s+(?:MATERIALIZED\s+)?VIEW/iu.test(file.text)) {
    matches.push({
      kind: 'raw-sql',
      file: file.relative,
      message: 'SQL schema declaration detected.',
    });
  }

  if (/migrations?\//u.test(file.relative) || /knexfile\.[cm]?[jt]s$/u.test(file.relative)) {
    matches.push({
      kind: 'migration-file',
      file: file.relative,
      message: 'Migration ownership file detected.',
    });
  }

  return uniqueMatches(matches);
}

function parseResources(file: SourceFile, suggestions: SchemaMigrationSuggestion[]): ResourceDraft[] {
  if (file.relative.endsWith('.prisma')) {
    return parsePrisma(file);
  }
  if (file.relative.endsWith('.sql')) {
    return parseSql(file, suggestions);
  }
  if (file.relative.endsWith('.json') || file.relative.endsWith('.jsonc')) {
    return parseSchemaJson(file, suggestions);
  }
  return [
    ...parseDrizzle(file),
    ...parseValidatorObjects(file, suggestions),
    ...parseTypeBoxObjects(file, suggestions),
  ];
}

function parsePrisma(file: SourceFile): ResourceDraft[] {
  const resources: ResourceDraft[] = [];
  const enumValues = prismaEnums(file.text);
  for (const match of file.text.matchAll(/model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/gu)) {
    const modelName = match[1];
    const fields: Record<string, SchemaMigrationField> = {};
    let idField = 'id';
    const warnings: string[] = [];
    for (const rawLine of match[2].split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) {
        continue;
      }
      const parsed = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)(\??|\[\])?(.*)$/u);
      if (!parsed) {
        warnings.push(`Skipped unsupported Prisma field line: ${line}`);
        continue;
      }
      const [, fieldName, prismaType, modifier = '', attrs = ''] = parsed;
      if (attrs.includes('@id')) {
        idField = fieldName;
      }
      const field = prismaField(prismaType, enumValues.get(prismaType), modifier, attrs);
      if (field) {
        fields[fieldName] = field;
      }
    }
    resources.push({
      name: pluralResourceName(modelName),
      kind: 'collection',
      idField,
      fields,
      source: {
        kind: 'prisma',
        file: file.relative,
        modelName,
      },
      warnings,
    });
  }
  return resources;
}

function prismaEnums(text: string): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  for (const match of text.matchAll(/enum\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/gu)) {
    enums.set(match[1], match[2].split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('//')));
  }
  return enums;
}

function prismaField(prismaType: string, enumValues: string[] | undefined, modifier: string, attrs: string): SchemaMigrationField | null {
  const isArray = modifier === '[]';
  const nullable = modifier === '?';
  const base = enumValues
    ? { type: 'enum', values: enumValues }
    : prismaScalarField(prismaType);
  if (!base) {
    return null;
  }
  const field: SchemaMigrationField = {
    ...base,
    required: !nullable && !isArray,
    ...(nullable ? { nullable: true } : {}),
  };
  if (isArray) {
    field.type = 'array';
    field.items = { ...base, required: false };
  }
  if (attrs.includes('@unique')) {
    field.unique = true;
  }
  const defaultValue = prismaDefault(attrs);
  if (defaultValue !== undefined) {
    field.default = defaultValue;
  }
  if (/@updatedAt\b/u.test(attrs)) {
    markDerived(field, 'database', 'updated-at', 'prisma');
  }
  if (/@default\s*\(\s*(?:autoincrement|dbgenerated|uuid|cuid)\s*\(/u.test(attrs) || /@default\s*\(\s*dbgenerated/u.test(attrs)) {
    markDerived(field, 'database', 'generated-default', 'prisma');
  }
  return field;
}

function prismaScalarField(type: string): SchemaMigrationField | null {
  switch (type) {
    case 'String':
      return { type: 'string' };
    case 'Int':
    case 'Float':
    case 'Decimal':
    case 'BigInt':
      return { type: 'number' };
    case 'Boolean':
      return { type: 'boolean' };
    case 'DateTime':
      return { type: 'datetime' };
    case 'Json':
      return { type: 'unknown' };
    default:
      return null;
  }
}

function prismaDefault(attrs: string): unknown {
  const match = attrs.match(/@default\s*\(\s*("[^"]*"|'[^']*'|true|false|-?\d+(?:\.\d+)?)\s*\)/u);
  if (!match) {
    return undefined;
  }
  const raw = match[1];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d/u.test(raw)) return Number(raw);
  return raw.slice(1, -1);
}

function parseSql(file: SourceFile, suggestions: SchemaMigrationSuggestion[]): ResourceDraft[] {
  const resources: ResourceDraft[] = [];
  const triggerTables = new Set<string>();
  for (const trigger of file.text.matchAll(/CREATE\s+TRIGGER[\s\S]*?\b(?:ON|UPDATE\s+ON)\s+["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/giu)) {
    triggerTables.add(trigger[1].toLowerCase());
  }
  for (const match of file.text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(["`]?[A-Za-z_][A-Za-z0-9_]*["`]?)\.)?(["`]?[A-Za-z_][A-Za-z0-9_]*["`]?)\s*\(([\s\S]*?)\);/giu)) {
    const tableName = unquoteIdentifier(match[2]);
    const fields: Record<string, SchemaMigrationField> = {};
    let idField: string | undefined;
    const warnings: string[] = [];
    for (const column of splitTopLevel(match[3])) {
      const parsed = column.trim().match(/^["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+(.+)$/u);
      if (!parsed || /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/iu.test(column.trim())) {
        continue;
      }
      const [, columnName, rest] = parsed;
      const field = sqlField(rest);
      if (/PRIMARY\s+KEY/iu.test(rest)) {
        idField = columnName;
      }
      if (triggerTables.has(tableName.toLowerCase()) && /^updated_?at$/iu.test(columnName)) {
        markDerived(field, 'database', 'trigger', 'sql');
      }
      fields[camelCase(columnName)] = field;
    }
    const tablePrimary = match[3].match(/PRIMARY\s+KEY\s*\(([^)]+)\)/iu);
    if (!idField && tablePrimary) {
      const keys = tablePrimary[1].split(',').map((entry) => camelCase(unquoteIdentifier(entry.trim())));
      if (keys.length === 1) {
        idField = keys[0];
      } else {
        warnings.push(`Compound primary key (${keys.join(', ')}) needs object-key operations or manual review.`);
      }
    }
    resources.push({
      name: camelCase(tableName),
      kind: 'collection',
      idField: idField ?? 'id',
      fields,
      source: {
        kind: 'sql',
        file: file.relative,
        modelName: tableName,
      },
      warnings,
    });
  }
  for (const view of file.text.matchAll(/CREATE\s+(MATERIALIZED\s+)?VIEW\s+(?:["`]?[A-Za-z_][A-Za-z0-9_]*["`]?\.)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/giu)) {
    suggestions.push({
      code: 'SCHEMA_MIGRATION_VIEW_REVIEW',
      severity: 'info',
      file: file.relative,
      message: `View "${view[2]}" should be reviewed as a read model.`,
      hint: 'Generate JSONC only when the selected view columns are clear; keep the database view as the source of truth.',
    });
  }
  return resources;
}

function sqlField(rest: string): SchemaMigrationField {
  const type = rest.split(/\s+/u)[0].toLowerCase();
  const field: SchemaMigrationField = {
    type: sqlType(type),
    required: /NOT\s+NULL/iu.test(rest),
  };
  if (/UNIQUE/iu.test(rest)) {
    field.unique = true;
  }
  if (/GENERATED\s+ALWAYS|IDENTITY|SERIAL/iu.test(rest)) {
    markDerived(field, 'database', /IDENTITY|SERIAL/iu.test(rest) ? 'identity' : 'generated-column', 'sql');
  }
  return field;
}

function sqlType(type: string): string {
  if (/^(text|varchar|char|uuid|citext)/u.test(type)) return 'string';
  if (/^(int|bigint|smallint|numeric|decimal|float|double|real|serial|bigserial)/u.test(type)) return 'number';
  if (/^(bool|boolean)/u.test(type)) return 'boolean';
  if (/^(timestamp|timestamptz|datetime|date)/u.test(type)) return 'datetime';
  return 'unknown';
}

function parseDrizzle(file: SourceFile): ResourceDraft[] {
  if (!/\b(?:pgTable|sqliteTable|mysqlTable)\s*\(/u.test(file.text)) {
    return [];
  }
  const resources: ResourceDraft[] = [];
  for (const call of findFunctionCalls(file.text, ['pgTable', 'sqliteTable', 'mysqlTable'])) {
    const args = splitTopLevel(call.args);
    const tableName = stringLiteralValue(args[0]);
    if (!tableName || !args[1]) {
      continue;
    }
    const fields = parseDrizzleFields(args[1]);
    const primary = Object.entries(fields).find(([, field]) => field.primaryKey === true)?.[0];
    for (const field of Object.values(fields)) {
      delete field.primaryKey;
    }
    resources.push({
      name: camelCase(tableName),
      kind: 'collection',
      idField: primary ?? 'id',
      fields,
      source: {
        kind: 'drizzle',
        file: file.relative,
        modelName: tableName,
      },
      warnings: [],
    });
  }
  return resources;
}

function parseDrizzleFields(objectText: string): Record<string, SchemaMigrationField & { primaryKey?: boolean }> {
  const body = stripObjectBraces(objectText);
  const fields: Record<string, SchemaMigrationField & { primaryKey?: boolean }> = {};
  for (const entry of splitTopLevel(body)) {
    const separator = entry.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const fieldName = unquoteIdentifier(entry.slice(0, separator).trim());
    const expr = entry.slice(separator + 1).trim();
    const field: SchemaMigrationField & { primaryKey?: boolean } = {
      type: drizzleType(expr),
      required: /\.notNull\s*\(/u.test(expr),
    };
    if (/\.primaryKey\s*\(/u.test(expr)) {
      field.primaryKey = true;
      field.required = true;
    }
    if (/\.unique\s*\(/u.test(expr)) {
      field.unique = true;
    }
    if (/\b(?:serial|bigserial)\s*\(/u.test(expr) || /\.generated/u.test(expr)) {
      markDerived(field, 'database', 'identity', 'drizzle');
    }
    if (/\.generatedAlwaysAs|\.defaultNow\s*\(\)\.\$onUpdate|updatedAt/u.test(expr)) {
      markDerived(field, 'database', 'generated-column', 'drizzle');
    }
    fields[fieldName] = field;
  }
  return fields;
}

function drizzleType(expr: string): string {
  if (/\b(?:text|varchar|char|uuid)\s*\(/u.test(expr)) return 'string';
  if (/\b(?:integer|bigint|smallint|numeric|decimal|real|double|serial|bigserial)\s*\(/u.test(expr)) return 'number';
  if (/\bboolean\s*\(/u.test(expr)) return 'boolean';
  if (/\b(?:timestamp|date|datetime)\s*\(/u.test(expr)) return 'datetime';
  return 'unknown';
}

function parseSchemaJson(file: SourceFile, suggestions: SchemaMigrationSuggestion[]): ResourceDraft[] {
  let parsed: unknown;
  try {
    parsed = parseJsonc(file.text, file.relative);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) {
    return [];
  }
  if (isOpenApi(parsed)) {
    return parseOpenApi(file, parsed, suggestions);
  }
  if (isJsonSchemaObject(parsed)) {
    const name = schemaNameFromFile(file.relative);
    return [jsonSchemaResource(file, name, parsed, 'json-schema')];
  }
  return [];
}

function parseOpenApi(file: SourceFile, parsed: Record<string, unknown>, suggestions: SchemaMigrationSuggestion[]): ResourceDraft[] {
  const schemas = isRecord(parsed.components) && isRecord(parsed.components.schemas)
    ? parsed.components.schemas
    : {};
  const resources: ResourceDraft[] = [];
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (isRecord(schema) && isJsonSchemaObject(schema)) {
      resources.push(jsonSchemaResource(file, pluralResourceName(schemaName), schema, 'openapi', schemaName));
    }
  }
  if (resources.length === 0) {
    suggestions.push({
      code: 'SCHEMA_MIGRATION_OPENAPI_NO_SCHEMAS',
      severity: 'warn',
      file: file.relative,
      message: 'OpenAPI document was detected but no object schemas were converted.',
      hint: 'Only components.schemas object declarations are converted in this pass.',
    });
  }
  return resources;
}

function jsonSchemaResource(file: SourceFile, name: string, schema: Record<string, unknown>, kind: 'json-schema' | 'openapi', exportName?: string): ResourceDraft {
  const field = jsonSchemaField(schema, true);
  return {
    name,
    kind: 'collection',
    idField: isRecord(field.fields) && 'id' in field.fields ? 'id' : undefined,
    fields: field.fields ?? {},
    source: {
      kind,
      file: file.relative,
      exportName,
    },
    warnings: [],
  };
}

function parseValidatorObjects(file: SourceFile, suggestions: SchemaMigrationSuggestion[]): ResourceDraft[] {
  if (!/\b(?:z|v)\.\s*object\s*\(/u.test(file.text)) {
    return [];
  }
  const resources: ResourceDraft[] = [];
  for (const decl of findExportedCalls(file.text, ['z.object', 'v.object'])) {
    const field = parseValidatorObject(decl.args);
    if (!field) {
      continue;
    }
    const requiresExecutable = /\.(?:refine|superRefine|transform|preprocess|pipe)\s*\(/u.test(decl.trailing);
    if (requiresExecutable) {
      suggestions.push({
        code: 'SCHEMA_MIGRATION_EXECUTABLE_VALIDATOR',
        severity: 'warn',
        file: file.relative,
        resource: pluralResourceName(decl.name),
        message: `Validator "${decl.name}" uses executable behavior that JSONC cannot represent.`,
        hint: 'Use mixed output so the generated .schema.mjs can keep a validator import for manual review.',
      });
    }
    resources.push({
      name: pluralResourceName(decl.name.replace(/Schema$/u, '')),
      kind: 'collection',
      idField: field.fields?.id ? 'id' : undefined,
      fields: field.fields ?? {},
      source: {
        kind: 'validator',
        file: file.relative,
        exportName: decl.name,
      },
      requiresExecutable,
      importName: decl.name,
      warnings: requiresExecutable ? ['Executable validator behavior requires .schema.mjs review.'] : [],
    });
  }
  return resources;
}

function parseValidatorObject(args: string): SchemaMigrationField | null {
  const body = stripObjectBraces(args);
  const fields: Record<string, SchemaMigrationField> = {};
  for (const entry of splitTopLevel(body)) {
    const separator = entry.indexOf(':');
    if (separator === -1) continue;
    const fieldName = unquoteIdentifier(entry.slice(0, separator).trim());
    const expr = entry.slice(separator + 1).trim();
    fields[fieldName] = validatorField(expr);
  }
  return { type: 'object', fields };
}

function validatorField(expr: string): SchemaMigrationField {
  const field: SchemaMigrationField = {
    type: /\bstring\s*\(/u.test(expr) ? 'string'
      : /\bnumber\s*\(/u.test(expr) ? 'number'
        : /\bboolean\s*\(/u.test(expr) ? 'boolean'
          : /\bdate\s*\(/u.test(expr) ? 'datetime'
            : 'unknown',
    required: !/\.(?:optional|nullish)\s*\(/u.test(expr),
    ...( /\.(?:nullable|nullish)\s*\(/u.test(expr) ? { nullable: true } : {}),
  };
  const min = expr.match(/\.min\s*\(\s*(\d+)/u);
  const max = expr.match(/\.max\s*\(\s*(\d+)/u);
  const regex = expr.match(/\.regex\s*\(\s*\/(.+?)\//u);
  if (min) field.minLength = Number(min[1]);
  if (max) field.maxLength = Number(max[1]);
  if (regex) field.pattern = regex[1];
  return field;
}

function parseTypeBoxObjects(file: SourceFile, suggestions: SchemaMigrationSuggestion[]): ResourceDraft[] {
  if (!/\bType\.\s*Object\s*\(/u.test(file.text)) {
    return [];
  }
  const resources: ResourceDraft[] = [];
  for (const decl of findExportedCalls(file.text, ['Type.Object'])) {
    const field = parseTypeBoxObject(decl.args);
    if (!field) {
      suggestions.push({
        code: 'SCHEMA_MIGRATION_TYPEBOX_REVIEW',
        severity: 'warn',
        file: file.relative,
        message: `TypeBox schema "${decl.name}" could not be fully converted.`,
        hint: 'Review the generated migration report and add Async DB field metadata manually.',
      });
      continue;
    }
    resources.push({
      name: pluralResourceName(decl.name.replace(/Schema$/u, '')),
      kind: 'collection',
      idField: field.fields?.id ? 'id' : undefined,
      fields: field.fields ?? {},
      source: {
        kind: 'json-schema',
        file: file.relative,
        exportName: decl.name,
      },
      warnings: [],
    });
  }
  return resources;
}

function parseTypeBoxObject(args: string): SchemaMigrationField | null {
  const body = stripObjectBraces(args);
  const fields: Record<string, SchemaMigrationField> = {};
  for (const entry of splitTopLevel(body)) {
    const separator = entry.indexOf(':');
    if (separator === -1) continue;
    const fieldName = unquoteIdentifier(entry.slice(0, separator).trim());
    const expr = entry.slice(separator + 1).trim();
    fields[fieldName] = {
      type: /Type\.\s*String\s*\(/u.test(expr) ? 'string'
        : /Type\.\s*Number\s*\(/u.test(expr) || /Type\.\s*Integer\s*\(/u.test(expr) ? 'number'
          : /Type\.\s*Boolean\s*\(/u.test(expr) ? 'boolean'
            : /Type\.\s*Array\s*\(/u.test(expr) ? 'array'
              : 'unknown',
      required: !/Type\.\s*Optional\s*\(/u.test(expr),
    };
  }
  return { type: 'object', fields };
}

function jsonSchemaField(schema: Record<string, unknown>, required = false): SchemaMigrationField {
  const typeValue = Array.isArray(schema.type) ? schema.type.find((entry) => entry !== 'null') : schema.type;
  const nullable = Array.isArray(schema.type) ? schema.type.includes('null') : schema.nullable === true;
  if (Array.isArray(schema.enum)) {
    return cleanField({
      type: 'enum',
      values: schema.enum,
      required,
      nullable,
      description: stringValue(schema.description),
      default: schema.default,
    });
  }
  if (typeValue === 'object' || isRecord(schema.properties)) {
    const requiredFields = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    return cleanField({
      type: 'object',
      required,
      nullable,
      description: stringValue(schema.description),
      additionalProperties: schema.additionalProperties === undefined ? undefined : Boolean(schema.additionalProperties),
      fields: Object.fromEntries(Object.entries(isRecord(schema.properties) ? schema.properties : {})
        .filter(([, value]) => isRecord(value))
        .map(([fieldName, value]) => [fieldName, jsonSchemaField(value as Record<string, unknown>, requiredFields.has(fieldName))])),
    });
  }
  if (typeValue === 'array') {
    return cleanField({
      type: 'array',
      required,
      nullable,
      description: stringValue(schema.description),
      items: isRecord(schema.items) ? jsonSchemaField(schema.items, false) : { type: 'unknown' },
    });
  }
  return cleanField({
    type: typeValue === 'integer' || typeValue === 'number' ? 'number'
      : typeValue === 'boolean' ? 'boolean'
        : schema.format === 'date-time' || schema.format === 'date' ? 'datetime'
          : typeValue === 'string' ? 'string'
            : 'unknown',
    required,
    nullable,
    description: stringValue(schema.description),
    default: schema.default,
    min: numberValue(schema.minimum),
    max: numberValue(schema.maximum),
    minLength: numberValue(schema.minLength),
    maxLength: numberValue(schema.maxLength),
    pattern: stringValue(schema.pattern),
  });
}

function renderJsoncSchema(resource: SchemaMigrationResource): string {
  return `${JSON.stringify({
    kind: resource.kind,
    ...(resource.kind === 'collection' ? { idField: resource.idField ?? 'id' } : {}),
    fields: resource.fields,
  }, null, 2)}\n`;
}

function renderSchemaModule(resource: SchemaMigrationResource, cwd: string): string {
  const helper = resource.kind === 'document' ? 'document' : 'collection';
  const sourceImport = resource.source.exportName
    ? `import { ${resource.source.exportName} as migratedValidator } from '${moduleSpecifier(path.join(cwd, resource.output.file), path.join(cwd, resource.source.file))}';\n`
    : '';
  const fields = Object.entries(resource.fields).map(([fieldName, field]) => `    ${propertyName(fieldName)}: ${fieldExpression(field)},`).join('\n');
  return [
    `import { collection, document, field } from '@async/db/schema';`,
    sourceImport.trimEnd(),
    '',
    `export default ${helper}({`,
    resource.kind === 'collection' ? `  idField: ${JSON.stringify(resource.idField ?? 'id')},` : '',
    sourceImport ? `  validator: migratedValidator,` : '',
    `  fields: {`,
    fields,
    `  },`,
    `});`,
    '',
  ].filter((line, index, lines) => line || lines[index - 1] !== '').join('\n');
}

function fieldExpression(field: SchemaMigrationField): string {
  const base = baseFieldExpression(field);
  if (field.derived) {
    return `field.derived(${base}, ${JSON.stringify(field.derived)})`;
  }
  return base;
}

function baseFieldExpression(field: SchemaMigrationField): string {
  const options = fieldOptions(field);
  switch (field.type) {
    case 'string':
      return renderFieldCall('field.string', options);
    case 'datetime':
      return renderFieldCall('field.datetime', options);
    case 'number':
      return renderFieldCall('field.number', options);
    case 'boolean':
      return renderFieldCall('field.boolean', options);
    case 'enum':
      return renderFieldCall('field.enum', options, [JSON.stringify(field.values ?? [])]);
    case 'array':
      return renderFieldCall('field.array', options, [baseFieldExpression(field.items ?? { type: 'unknown' })]);
    case 'object':
      return renderObjectExpression(field, options);
    case 'unknown':
    default:
      return renderFieldCall('field.json', options);
  }
}

function renderObjectExpression(field: SchemaMigrationField, options: Record<string, unknown>): string {
  const entries = Object.entries(field.fields ?? {});
  if (entries.length === 0) {
    return renderFieldCall('field.object', options);
  }
  return [
    'field.object({',
    ...entries.map(([fieldName, child]) => `      ${propertyName(fieldName)}: ${fieldExpression(child)},`),
    `    }${Object.keys(options).length ? `, ${JSON.stringify(options)}` : ''})`,
  ].join('\n');
}

function fieldOptions(field: SchemaMigrationField): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const key of ['required', 'nullable', 'description', 'default', 'unique', 'min', 'max', 'minLength', 'maxLength', 'pattern', 'additionalProperties', 'relation'] as const) {
    if (field[key] !== undefined) {
      options[key] = field[key];
    }
  }
  if (field.readOnly === true && !field.derived) {
    options.readOnly = true;
  }
  return options;
}

function renderFieldCall(callee: string, options: Record<string, unknown>, args: string[] = []): string {
  const rendered = [...args];
  if (Object.keys(options).length > 0) {
    rendered.push(JSON.stringify(options));
  }
  return `${callee}(${rendered.join(', ')})`;
}

function mergeResource(resources: Map<string, ResourceDraft>, resource: ResourceDraft, suggestions: SchemaMigrationSuggestion[]): void {
  const existing = resources.get(resource.name);
  if (!existing) {
    resources.set(resource.name, resource);
    return;
  }
  suggestions.push({
    code: 'SCHEMA_MIGRATION_DUPLICATE_RESOURCE',
    severity: 'warn',
    resource: resource.name,
    file: resource.source.file,
    message: `Multiple schema declarations map to "${resource.name}".`,
    hint: `Keeping the first declaration from ${existing.source.file}; review the duplicate before generating final schemas.`,
  });
}

function markDerived(field: SchemaMigrationField, source: string, kind: string, owner: string): void {
  field.readOnly = true;
  field.required = false;
  field.derived = { source, kind, owner };
}

function cleanField(field: SchemaMigrationField): SchemaMigrationField {
  return Object.fromEntries(Object.entries(field).filter(([, value]) => value !== undefined)) as SchemaMigrationField;
}

function findFunctionCalls(text: string, names: string[]): Array<{ name: string; args: string; start: number; end: number }> {
  const calls: Array<{ name: string; args: string; start: number; end: number }> = [];
  for (const name of names) {
    const pattern = new RegExp(`${escapeRegExp(name)}\\s*\\(`, 'gu');
    for (const match of text.matchAll(pattern)) {
      const open = (match.index ?? 0) + match[0].lastIndexOf('(');
      const close = matchingParen(text, open);
      if (close !== -1) {
        calls.push({ name, args: text.slice(open + 1, close), start: match.index ?? 0, end: close + 1 });
      }
    }
  }
  return calls.sort((left, right) => left.start - right.start);
}

function findExportedCalls(text: string, callNames: string[]): Array<{ name: string; args: string; trailing: string }> {
  const declarations: Array<{ name: string; args: string; trailing: string }> = [];
  const exportPattern = /export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/gu;
  for (const match of text.matchAll(exportPattern)) {
    const name = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const remainder = text.slice(start);
    for (const callName of callNames) {
      const callIndex = remainder.search(new RegExp(`${escapeRegExp(callName)}\\s*\\(`, 'u'));
      if (callIndex === -1 || callIndex > 80) {
        continue;
      }
      const open = start + callIndex + remainder.slice(callIndex).indexOf('(');
      const close = matchingParen(text, open);
      if (close !== -1) {
        declarations.push({
          name,
          args: text.slice(open + 1, close),
          trailing: text.slice(close + 1, Math.min(text.length, close + 240)),
        });
      }
    }
  }
  return declarations;
}

function matchingParen(text: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    const prev = text[index - 1];
    if (quote) {
      if (char === quote && prev !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const prev = value[index - 1];
    if (quote) {
      if (char === quote && prev !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === '}' || char === ']') {
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function stripObjectBraces(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stringLiteralValue(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  const match = trimmed.match(/^['"`]([^'"`]+)['"`]$/u);
  return match?.[1] ?? null;
}

function unquoteIdentifier(value: string): string {
  return value.trim().replace(/^["'`]|["'`]$/gu, '');
}

function isOpenApi(value: Record<string, unknown>): boolean {
  return typeof value.openapi === 'string' || typeof value.swagger === 'string';
}

function isJsonSchemaObject(value: Record<string, unknown>): boolean {
  return value.type === 'object' || isRecord(value.properties) || typeof value.$schema === 'string';
}

function schemaNameFromFile(filePath: string): string {
  return pluralResourceName(path.basename(filePath).replace(/(?:\.schema)?\.jsonc?$/u, ''));
}

function pluralResourceName(value: string): string {
  const base = camelCase(value.replace(/Schema$/u, ''));
  if (!base) return 'resources';
  if (base.endsWith('s')) return base;
  if (base.endsWith('y')) return `${base.slice(0, -1)}ies`;
  return `${base}s`;
}

function normalizeRelative(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath).split(path.sep).join('/');
  return relative || '.';
}

function propertyName(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value) ? value : JSON.stringify(value);
}

function moduleSpecifier(fromFile: string, targetFile: string): string {
  let specifier = path.relative(path.dirname(fromFile), targetFile).split(path.sep).join('/');
  if (!specifier.startsWith('.')) {
    specifier = `./${specifier}`;
  }
  return specifier.replace(/\.[cm]?tsx?$/u, '.js');
}

function uniqueMatches(matches: SchemaMigrationSourceMatch[]): SchemaMigrationSourceMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.kind}:${match.package ?? ''}:${match.file}:${match.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
