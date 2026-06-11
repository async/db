import path from 'node:path';
import { dbError, listChoices } from '../../errors.js';
import { readText, writeText } from '../../fs-utils.js';
import { resolveResource } from '../../names.js';
import { loadProjectSchema } from '../../schema.js';
import { generateSchemaManifest } from '../../schema-manifest.js';
import {
  generateSchemaMigrationOutputs,
  inspectSchemaMigration,
  normalizeSchemaMigrationReportForCheck,
  writeSchemaMigrationReport,
  type SchemaMigrationReport,
} from '../../features/schema/migration.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printDiagnostic, printSchemaHelp, printSchemaMigrationReport } from '../output.js';
import { promptForSchemaTarget } from '../schema-prompt.js';

type CliConfig = {
  cwd?: string;
  sourceDir?: string;
  schema?: {
    standardSchema?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type SchemaDiagnostic = {
  code?: string;
  severity?: string;
  message: string;
  hint?: string;
  resource?: string;
  file?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
};

type SchemaResolverGroup = {
  resolve?: unknown;
  resolveMany?: unknown;
  [key: string]: unknown;
};

type SchemaField = {
  type?: string;
  required?: boolean;
  nullable?: boolean;
  description?: unknown;
  default?: unknown;
  unique?: boolean;
  additionalProperties?: unknown;
  relation?: unknown;
  values?: unknown[];
  items?: SchemaField;
  fields?: Record<string, SchemaField>;
  computed?: boolean;
  [key: string]: unknown;
};

type SchemaResource = {
  name: string;
  kind?: string;
  idField?: string;
  fields?: Record<string, SchemaField>;
  source?: unknown;
  store?: unknown;
  parser?: unknown;
  seed?: unknown;
  schemaSeed?: unknown;
  schemaHasSeed?: boolean;
  dataPath?: string;
  schemaPath?: string;
  validators?: {
    standard?: unknown;
    [key: string]: unknown;
  };
  validatorSource?: string;
  resolvers?: {
    fields?: Record<string, SchemaResolverGroup>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type SchemaProject = {
  resources: SchemaResource[];
  diagnostics: SchemaDiagnostic[];
  schema: {
    resources: Record<string, unknown>;
    [key: string]: unknown;
  };
  rootSchema?: {
    found?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ResourceTargetOptions = {
  resourceName?: string;
};

type PromptedSchemaTarget = {
  all?: boolean;
  resourceName?: string;
};

type ImportMap = Map<string, string>;

type FieldRenderOptions = {
  rootSchemaAlias?: string;
};

type RenderSchemaModuleOptions = FieldRenderOptions & {
  config?: CliConfig;
  imports?: ImportMap;
  outFile?: string;
};

type BundleOptions = {
  force?: boolean;
};

type WriteOptions = BundleOptions & {
  existsCode?: string;
  existsHint?: string;
  command?: string;
  resource?: string;
};

type PlannedWrite = {
  kind?: string;
  filePath: string;
  content: string;
  diagnostic?: SchemaDiagnostic;
  options: WriteOptions;
};

type SchemaSource = {
  kind?: string;
  fields?: Record<string, SchemaField>;
  idField?: string;
  source?: unknown;
  store?: unknown;
  parser?: unknown;
  seed?: unknown;
};

type FilesSource = {
  kind?: string;
  patterns?: unknown[];
  read?: unknown;
  [key: string]: unknown;
};

type PackageInfo = {
  file: string;
  type: string | null;
};

export async function runSchema(config: CliConfig, args: string[]): Promise<void> {
  if (isHelpRequested(args)) {
    printSchemaHelp();
    return;
  }

  if (args[0] === 'infer') {
    await runSchemaInfer(config, args);
    return;
  }

  if (args[0] === 'migrate') {
    await runSchemaMigrate(config, args.slice(1));
    return;
  }

  const project = await loadProjectSchema(config) as SchemaProject;

  if (args[0] === 'manifest') {
    const result = await generateSchemaManifest(config, {
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
    return;
  }

  if (args[0] === 'unbundle') {
    const prompted = await promptedSchemaTarget('unbundle', project, args);
    if (hasFlag(args, '--all') || prompted?.all) {
      await runSchemaUnbundleAll(config, project, args);
      return;
    }
    await runSchemaUnbundle(config, project, args, { resourceName: prompted?.resourceName });
    return;
  }

  if (args[0] === 'bundle') {
    const prompted = await promptedSchemaTarget('bundle', project, args);
    if (hasFlag(args, '--all') || prompted?.all) {
      await runSchemaBundleAll(config, project, args);
      return;
    }
    await runSchemaBundle(config, project, args, { resourceName: prompted?.resourceName });
    return;
  }

  if (args[0] === 'validate') {
    for (const diagnostic of project.diagnostics) {
      printDiagnostic(diagnostic);
    }

    const errorCount = project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
    if (errorCount > 0) {
      process.exitCode = 1;
      return;
    }

    console.log(project.diagnostics.length === 0 ? 'Schema valid' : 'Schema valid with warnings');
    return;
  }

  if (args[0]) {
    const resourceMap = new Map<string, SchemaResource>(project.resources.map((resource) => [resource.name, resource]));
    const { resource, candidates } = resolveResource(resourceMap, args[0]) as { resource?: SchemaResource; candidates: string[] };
    if (!resource) {
      throw dbError(
        'SCHEMA_UNKNOWN_RESOURCE',
        `Unknown schema resource "${args[0]}".`,
        {
          status: 404,
          hint: `Use one of: ${listChoices(project.resources.map((resource) => resource.name))}.`,
          details: {
            resource: args[0],
            requestedResource: args[0],
            normalizedCandidates: candidates,
            availableResources: project.resources.map((resource) => resource.name),
          },
        },
      );
    }

    console.log(JSON.stringify(project.schema.resources[resource.name], null, 2));
    return;
  }

  console.log(JSON.stringify(project.schema, null, 2));
}

async function runSchemaMigrate(config: CliConfig, args: string[]): Promise<void> {
  if (args[0] === 'inspect') {
    await runSchemaMigrateInspect(config, args.slice(1));
    return;
  }

  if (args[0] === 'generate') {
    await runSchemaMigrateGenerate(config, args.slice(1));
    return;
  }

  throw dbError(
    'SCHEMA_MIGRATE_UNKNOWN_COMMAND',
    'SCHEMA_MIGRATE_UNKNOWN_COMMAND: unknown schema migrate command.',
    {
      hint: 'Use async-db schema migrate inspect <target> or async-db schema migrate generate --plan <report.json>.',
    },
  );
}

async function runSchemaMigrateInspect(config: CliConfig, args: string[]): Promise<void> {
  const cwd = path.resolve(config.cwd ?? process.cwd());
  const outFile = valueAfter(args, '--out');
  const checkFile = valueAfter(args, '--check');
  const format = schemaMigrationFormat(args);
  const report = await inspectSchemaMigration({
    cwd,
    target: positionalArgs(args)[0],
    schemaDir: valueAfter(args, '--schema-dir'),
    format,
    ignorePaths: [outFile, checkFile].filter((filePath): filePath is string => Boolean(filePath)),
  });

  if (checkFile) {
    await checkSchemaMigrationReport(cwd, checkFile, report);
    console.log(`Schema migration report matches ${relativeOutputPath(cwd, resolveOutputPath(cwd, checkFile))}`);
  }

  if (outFile) {
    const resolved = resolveOutputPath(cwd, outFile);
    await writeSchemaMigrationReport(resolved, report);
    console.log(`Generated ${relativeOutputPath(cwd, resolved)}`);
  }

  if (hasFlag(args, '--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (!outFile && !checkFile) {
    printSchemaMigrationReport(report);
  }
}

async function runSchemaMigrateGenerate(config: CliConfig, args: string[]): Promise<void> {
  const cwd = path.resolve(config.cwd ?? process.cwd());
  const planFile = valueAfter(args, '--plan');
  if (!planFile) {
    throw dbError(
      'SCHEMA_MIGRATE_GENERATE_REQUIRES_PLAN',
      'SCHEMA_MIGRATE_GENERATE_REQUIRES_PLAN: schema migrate generate requires --plan <report.json>.',
      {
        hint: 'Run async-db schema migrate inspect first and pass its --out file as --plan.',
      },
    );
  }
  const report = JSON.parse(await readText(resolveOutputPath(cwd, planFile))) as SchemaMigrationReport;
  const result = await generateSchemaMigrationOutputs({
    cwd,
    plan: report,
    schemaDir: valueAfter(args, '--schema-dir'),
    format: schemaMigrationFormat(args),
    force: hasFlag(args, '--force'),
  });

  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }
  for (const filePath of result.files) {
    console.log(`Generated ${filePath}`);
  }
}

async function checkSchemaMigrationReport(cwd: string, filePath: string, report: SchemaMigrationReport): Promise<void> {
  const resolved = resolveOutputPath(cwd, filePath);
  const current = JSON.parse(await readText(resolved)) as SchemaMigrationReport;
  if (JSON.stringify(normalizeSchemaMigrationReportForCheck(current)) === JSON.stringify(normalizeSchemaMigrationReportForCheck(report))) {
    return;
  }

  throw dbError(
    'SCHEMA_MIGRATION_REPORT_CHECK_FAILED',
    `SCHEMA_MIGRATION_REPORT_CHECK_FAILED: schema migration report check failed for ${relativeOutputPath(cwd, resolved)}.`,
    {
      hint: `Run async-db schema migrate inspect with the same flags and --out ${filePath} to update it.`,
    },
  );
}

async function runSchemaUnbundle(config: CliConfig, project: SchemaProject, args: string[], options: ResourceTargetOptions = {}): Promise<void> {
  const resourceName = options.resourceName ?? positionalArgs(args.slice(1))[0];
  if (!resourceName) {
    const example = schemaTargetExample(project);
    throw dbError(
      'SCHEMA_UNBUNDLE_REQUIRES_RESOURCE',
      `SCHEMA_UNBUNDLE_REQUIRES_RESOURCE: schema unbundle requires a resource name. Use async-db schema unbundle ${example}, or async-db schema unbundle --all.`,
      {
        hint: `Use async-db schema unbundle ${example}, or async-db schema unbundle --all.`,
      },
    );
  }

  const resource = requireSchemaResource(project, resourceName);
  const explicitSchemaOutFile = outputPath(config, valueAfter(args, '--schema-out'));
  if (!explicitSchemaOutFile && isExecutableSchemaFile(resource.schemaPath)) {
    throw dbError(
      'SCHEMA_UNBUNDLE_SCHEMA_MODULE_REQUIRES_OUT',
      `SCHEMA_UNBUNDLE_SCHEMA_MODULE_REQUIRES_OUT: schema unbundle cannot rewrite ${path.relative(config.cwd, resource.schemaPath)} in place.`,
      {
        hint: 'Use --schema-out to write a JSON/JSONC schema source, then replace the executable schema module when you are ready.',
      },
    );
  }

  const schemaOutFile = explicitSchemaOutFile ?? defaultSchemaOutFile(config, resource);
  const explicitSeedOutFile = outputPath(config, valueAfter(args, '--seed-out'));
  const force = hasFlag(args, '--force');
  const includeEmptySeed = hasFlag(args, '--empty-seed');
  const shouldWriteSeed = (explicitSeedOutFile !== undefined || !resource.dataPath)
    && (includeEmptySeed || !isEmptySeed(resource.seed, resource.kind));
  const seedOutFile = explicitSeedOutFile ?? defaultSeedOutFile(config, resource);
  const generated: string[] = [];

  if (shouldWriteSeed) {
    await writeOutput(seedOutFile, `${JSON.stringify(resource.seed, null, 2)}\n`, config, { force });
    generated.push(seedOutFile);
  }

  if (!explicitSchemaOutFile && resource.schemaPath?.endsWith('.schema.jsonc')) {
    console.error(`warn: schema unbundle rewrites ${path.relative(config.cwd, schemaOutFile)} without preserving JSONC comments.`);
  }

  await writeText(schemaOutFile, `${JSON.stringify(schemaSourceForResource(resource), null, 2)}\n`);
  generated.push(schemaOutFile);

  for (const filePath of generated) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
}

async function runSchemaBundle(config: CliConfig, project: SchemaProject, args: string[], options: ResourceTargetOptions = {}): Promise<void> {
  const resourceName = options.resourceName ?? positionalArgs(args.slice(1))[0];
  if (!resourceName) {
    const example = schemaTargetExample(project);
    throw dbError(
      'SCHEMA_BUNDLE_REQUIRES_RESOURCE',
      `SCHEMA_BUNDLE_REQUIRES_RESOURCE: schema bundle requires a resource name. Use async-db schema bundle ${example} --out artifacts/${example}.bundle.schema.json, or async-db schema bundle --all.`,
      {
        hint: `Use async-db schema bundle ${example} --out artifacts/${example}.bundle.schema.json, or async-db schema bundle --all.`,
      },
    );
  }

  const resource = requireSchemaResource(project, resourceName);
  const content = `${JSON.stringify(schemaSourceForResource(resource, { includeSeed: true }), null, 2)}\n`;
  const outFile = outputPath(config, valueAfter(args, '--out'));
  if (!outFile) {
    console.log(content.trimEnd());
    return;
  }

  const force = hasFlag(args, '--force');
  if (isInsidePath(config.sourceDir, outFile) && !force) {
    throw dbError(
      'SCHEMA_BUNDLE_LIVE_OUTPUT_REQUIRES_FORCE',
      `SCHEMA_BUNDLE_LIVE_OUTPUT_REQUIRES_FORCE: schema bundle output ${path.relative(config.cwd, outFile)} is inside the active data folder.`,
      {
        hint: 'Write bundled schema artifacts outside db/, or pass --force if you intentionally want a live bundled schema source.',
      },
    );
  }

  await writeOutput(outFile, content, config, { force });
  console.log(`Generated ${path.relative(config.cwd, outFile)}`);
}

async function runSchemaBundleAll(config: CliConfig, project: SchemaProject, args: string[]): Promise<void> {
  const outFile = outputPath(config, valueAfter(args, '--out')) ?? await defaultRootSchemaOutFile(config, project);
  const force = hasFlag(args, '--force');
  const duplicate = bundleDuplicateResourceDiagnostic(config, project);
  if (duplicate) {
    throw dbError(duplicate.code, `${duplicate.code}: ${duplicate.message}`, {
      hint: duplicate.hint,
      details: duplicate.details,
    });
  }

  if (isInsidePath(config.sourceDir, outFile) && !force) {
    const relative = path.relative(config.cwd, outFile);
    throw dbError(
      'SCHEMA_BUNDLE_LIVE_OUTPUT_REQUIRES_FORCE',
      `SCHEMA_BUNDLE_LIVE_OUTPUT_REQUIRES_FORCE: schema bundle output ${relative} is inside the active data folder.`,
      {
        hint: 'Write the root schema outside db/, or pass --force if you intentionally want a live schema source inside db/.',
        details: {
          command: 'schema bundle --all',
          file: relative,
          sourceDir: path.relative(config.cwd, config.sourceDir),
          severity: 'error',
        },
      },
    );
  }

  const result = renderRootSchemaBundle(config, project, outFile);
  const isRootOutput = isRootSchemaOutput(config, outFile);
  const plannedWrites: PlannedWrite[] = [
    ...bundleAllSeedWrites(config, project, outFile, { force }),
    {
      filePath: outFile,
      content: result.content,
      options: {
        force,
        existsCode: isRootOutput ? 'SCHEMA_BUNDLE_ROOT_EXISTS' : 'SCHEMA_BUNDLE_OUTPUT_EXISTS',
        existsHint: isRootOutput
          ? 'Review the existing root schema, choose a different --out path, or pass --force to replace it.'
          : 'Review the existing output, choose a different --out path, or pass --force to overwrite it.',
        command: 'schema bundle --all',
      },
    },
  ];
  const preflight = [];
  for (const write of plannedWrites) {
    preflight.push({
      ...write,
      result: await preflightOutput(write.filePath, write.content, config, write.options),
    });
  }

  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }
  for (const write of preflight) {
    if (!write.result.shouldWrite) {
      continue;
    }
    await writeText(write.filePath, write.content);
    if (write.diagnostic) {
      printDiagnostic(write.diagnostic);
    }
    if (write.kind === 'seed') {
      console.log(`Generated ${path.relative(config.cwd, write.filePath)}`);
    }
  }
  console.log(`Generated ${path.relative(config.cwd, outFile)}`);
}

async function runSchemaUnbundleAll(config: CliConfig, project: SchemaProject, args: string[]): Promise<void> {
  const schemaDir = outputPath(config, valueAfter(args, '--schema-dir')) ?? config.sourceDir;
  const force = hasFlag(args, '--force');
  if (!project.rootSchema?.found) {
    throw dbError(
      'SCHEMA_UNBUNDLE_ROOT_REQUIRED',
      'SCHEMA_UNBUNDLE_ROOT_REQUIRED: schema unbundle --all requires db.schema.js or db.schema.mjs.',
      {
        hint: 'Create a root schema first with async-db schema bundle --all, or unbundle a single resource by name.',
        details: {
          command: 'schema unbundle --all',
          file: 'db.schema.js|db.schema.mjs',
          severity: 'error',
        },
      },
    );
  }

  printDiagnostic({
    code: 'SCHEMA_UNBUNDLE_SEED_NOT_MOVED',
    severity: 'warn',
    message: 'SCHEMA_UNBUNDLE_SEED_NOT_MOVED: schema unbundle --all writes schema files only; seed/data files are left untouched.',
    hint: 'Use single-resource schema unbundle with --seed-out when you want to move embedded seed data.',
    details: {
      command: 'schema unbundle --all',
    },
  });

  const executableOutput = await executableSchemaOutputPlan(config, schemaDir);
  const hasExecutableOutput = project.resources.some((resource) => resourceHasExecutableSchema(resource));
  if (hasExecutableOutput && executableOutput.packageWrite) {
    const wrote = await writeOutput(
      executableOutput.packageWrite.filePath,
      executableOutput.packageWrite.content,
      config,
      executableOutput.packageWrite.options,
    );
    if (wrote) {
      console.log(`Generated ${path.relative(config.cwd, executableOutput.packageWrite.filePath)}`);
    }
  }

  const rootSchemaPath = projectRootSchemaPath(config, project);
  for (const resource of project.resources) {
    const executable = resourceHasExecutableSchema(resource);
    const outFile = resource.source
      ? path.join(schemaDir, resource.name, `index.schema.${executableOutput.extension}`)
      : path.join(schemaDir, `${resource.name}.schema.${executable ? executableOutput.extension : 'jsonc'}`);
    const content = executable
      ? renderUnbundledSchemaModule(config, project, resource, outFile, rootSchemaPath)
      : `${JSON.stringify(schemaSourceForResource(resource), null, 2)}\n`;

    if (resourceHasExecutableFunctions(resource)) {
      printDiagnostic(executableUnbundleDiagnostic(config, resource, outFile));
    }

    await writeOutput(outFile, content, config, {
      force,
      existsCode: 'SCHEMA_UNBUNDLE_OUTPUT_EXISTS',
      existsHint: 'Review the existing per-resource schema file, choose a different --schema-dir, or pass --force to overwrite it.',
      command: 'schema unbundle --all',
      resource: resource.name,
    });
    console.log(`Generated ${path.relative(config.cwd, outFile)}`);
  }
}

async function runSchemaInfer(config: CliConfig, args: string[]): Promise<void> {
  const resourceName = positionalArgs(args.slice(1))[0];
  const outFile = valueAfter(args, '--out');
  const inferredConfig = {
    ...config,
    schema: {
      ...config.schema,
      source: 'data',
    },
  };
  const project = await loadProjectSchema(inferredConfig) as SchemaProject;

  if (outFile && !resourceName) {
    throw dbError(
      'SCHEMA_INFER_OUT_REQUIRES_RESOURCE',
      'SCHEMA_INFER_OUT_REQUIRES_RESOURCE: schema infer --out requires a resource name.',
      {
        hint: 'Use async-db schema infer users --out db/users.schema.jsonc.',
      },
    );
  }

  if (resourceName) {
    const resource = requireSchemaResource(project, resourceName);
    if (outFile) {
      const outputPath = path.resolve(config.cwd, outFile);
      await writeText(outputPath, `${JSON.stringify(schemaSourceForResource(resource), null, 2)}\n`);
      console.log(`Generated ${path.relative(config.cwd, outputPath)}`);
      return;
    }

    console.log(JSON.stringify(project.schema.resources[resource.name], null, 2));
    return;
  }

  console.log(JSON.stringify(project.schema, null, 2));
}

async function promptedSchemaTarget(command: string, project: SchemaProject, args: string[]): Promise<PromptedSchemaTarget | undefined> {
  if (hasFlag(args, '--all') || positionalArgs(args.slice(1))[0]) {
    return undefined;
  }

  return promptForSchemaTarget({
    command,
    resources: project.resources.map((resource) => resource.name),
  });
}

function schemaTargetExample(project: SchemaProject): string {
  return project.resources[0]?.name ?? '<resource>';
}

function renderRootSchemaBundle(config: CliConfig, project: SchemaProject, outFile: string): { content: string; diagnostics: SchemaDiagnostic[] } {
  const imports: ImportMap = new Map();
  const diagnostics: SchemaDiagnostic[] = [];
  for (const resource of project.resources) {
    if (!isExecutableSchemaFile(resource.schemaPath) || !resourceHasExecutableFunctions(resource)) {
      continue;
    }
    ensureResourceImport(resource, imports);
    if (resourceHasStandardValidator(resource)) {
      diagnostics.push(importedValidatorDiagnostic(config, resource, outFile));
    }
    if (!resourceHasResolvers(resource)) {
      continue;
    }
    for (const [fieldName, resolver] of Object.entries(resource.resolvers?.fields ?? {})) {
      for (const resolverKind of ['resolve', 'resolveMany']) {
        if (!resolver[resolverKind]) {
          continue;
        }
        diagnostics.push(importedResolverDiagnostic(config, resource, fieldName, resolverKind, outFile));
        if (isArrowLikeFunction(resolver[resolverKind])) {
          diagnostics.push(arrowResolverDiagnostic(config, resource, fieldName, resolverKind, outFile));
        }
      }
    }
  }

  const lines = [
    '// Generated by async-db schema bundle --all.',
    '',
    `import { collection, document, field, files } from '@async/db/schema';`,
  ];
  for (const [sourceFile, alias] of imports) {
    lines.push(`import ${alias} from '${moduleSpecifier(outFile, sourceFile)}';`);
  }
  lines.push('', 'export default {');
  for (const resource of project.resources) {
    lines.push(...renderRootSchemaResource(config, resource, imports));
  }
  lines.push('};', '');

  return {
    content: lines.join('\n'),
    diagnostics,
  };
}

function renderRootSchemaResource(config: CliConfig, resource: SchemaResource, imports: ImportMap): string[] {
  const helper = resource.kind === 'document' ? 'document' : 'collection';
  const validator = resourceHasStandardValidator(resource)
    ? validatorAccess(resource, imports)
    : undefined;
  const standardSchemaFirst = shouldEmitStandardSchemaFirst(config, resource) && validator;
  const lines = [
    standardSchemaFirst
      ? `  ${propertyName(resource.name)}: ${helper}(${validator}, {`
      : `  ${propertyName(resource.name)}: ${helper}({`,
  ];
  if (resource.description) {
    lines.push(`    description: ${JSON.stringify(resource.description)},`);
  }
  if (resource.kind === 'collection') {
    lines.push(`    idField: ${JSON.stringify(resource.idField)},`);
  }
  if (resource.source) {
    lines.push(`    source: ${renderSourceExpression(rootSchemaSourceGlob(config, resource))},`);
  }
  if (validator && !standardSchemaFirst) {
    lines.push(`    validator: ${validator},`);
  }
  lines.push('    fields: {');
  for (const [fieldName, field] of Object.entries(resource.fields ?? {})) {
    lines.push(`      ${propertyName(fieldName)}: ${renderFieldExpression(field, resource, fieldName, imports)},`);
  }
  lines.push('    },');
  lines.push('  }),', '');
  return lines;
}

function rootSchemaSourceGlob(config: CliConfig, resource: SchemaResource): unknown {
  if (!isFolderMarkerResource(config, resource)) {
    return resource.source;
  }

  const source = filesSource(resource.source);
  if (source?.kind === 'files') {
    return {
      ...source,
      patterns: (source.patterns ?? []).map((source) => rebaseFolderSourceGlob(config, resource, source)),
    };
  }

  if (Array.isArray(resource.source)) {
    return resource.source.map((source) => rebaseFolderSourceGlob(config, resource, source));
  }

  return rebaseFolderSourceGlob(config, resource, resource.source);
}

function isFolderMarkerResource(config: CliConfig, resource: SchemaResource): boolean {
  if (!resource.schemaPath) {
    return false;
  }
  const relative = path.relative(config.cwd, resource.schemaPath).split(path.sep).join('/');
  return relative.endsWith('/index.schema.mjs') || relative.endsWith('/index.schema.js');
}

function rebaseFolderSourceGlob(config: CliConfig, resource: SchemaResource, source: unknown): unknown {
  if (typeof source !== 'string' || path.isAbsolute(source)) {
    return source;
  }

  const normalizedSource = source.split('\\').join('/');
  const schemaDir = path.dirname(resource.schemaPath);
  const relativeSchemaDir = path.relative(config.cwd, schemaDir).split(path.sep).join('/');
  const sourcePath = normalizedSource.replace(/^\.\//u, '');
  const rebased = path.posix.normalize(path.posix.join(relativeSchemaDir, sourcePath));
  return rebased.startsWith('.') ? rebased : `./${rebased}`;
}

function renderSourceExpression(source: unknown): string {
  const sourceObject = filesSource(source);
  const normalized = sourceObject?.kind === 'files'
    ? sourceObject
    : {
      kind: 'files',
      patterns: Array.isArray(source) ? source : [source],
      read: 'frontmatter',
    };
  const patterns = normalized.patterns ?? [];
  const patternExpression = patterns.length === 1 ? JSON.stringify(patterns[0]) : literal(patterns);
  const options: Record<string, unknown> = { read: normalized.read ?? 'frontmatter' };
  if (Array.isArray((normalized as { components?: unknown }).components)) {
    options.components = (normalized as { components?: unknown[] }).components;
  }
  return `files(${patternExpression}, ${objectLiteral(options)})`;
}

function filesSource(source: unknown): FilesSource | null {
  return source && typeof source === 'object' && !Array.isArray(source)
    ? source as FilesSource
    : null;
}

function renderFieldExpression(
  field: SchemaField,
  resource: SchemaResource,
  fieldName: string,
  imports: ImportMap,
  fieldPath = fieldName,
  options: FieldRenderOptions = {},
): string {
  const computed = field.computed === true;
  const base = renderBaseFieldExpression(field, resource, fieldPath, imports);
  if (!computed && field.derived) {
    return `field.derived(${base}, ${literal(field.derived)})`;
  }
  if (!computed) {
    return base;
  }

  const resolver = resource.resolvers?.fields?.[fieldName];
  if (!resolver) {
    return `field.computed(${base})`;
  }

  const fieldAccess = resolverFieldAccess(resource, fieldName, imports, options);
  if (!fieldAccess) {
    return `field.computed(${base})`;
  }

  if (resolver.resolve && resolver.resolveMany) {
    return [
      `field.computed(${base}, {`,
      `        resolve: function ${resolverFunctionName(resource.name, fieldName, 'resolve')}(context) {`,
      `          return ${fieldAccess}.resolve.call(this, context);`,
      '        },',
      `        resolveMany: function ${resolverFunctionName(resource.name, fieldName, 'resolveMany')}(context) {`,
      `          return ${fieldAccess}.resolveMany.call(this, context);`,
      '        },',
      '      })',
    ].join('\n');
  }

  if (resolver.resolveMany) {
    return [
      `field.computed(${base}, {`,
      `        resolveMany: function ${resolverFunctionName(resource.name, fieldName, 'resolveMany')}(context) {`,
      `          return ${fieldAccess}.resolveMany.call(this, context);`,
      '        },',
      '      })',
    ].join('\n');
  }

  return [
    `field.computed(${base}, function ${resolverFunctionName(resource.name, fieldName, 'resolve')}(context) {`,
    `        return ${fieldAccess}.resolve.call(this, context);`,
    '      })',
  ].join('\n');
}

function renderBaseFieldExpression(field: SchemaField, resource: SchemaResource, fieldPath: string, imports: ImportMap): string {
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
      return renderFieldCall('field.enum', options, [literal(field.values ?? [])]);
    case 'array':
      return renderFieldCall('field.array', options, [
        renderBaseFieldExpression(field.items ?? { type: 'unknown' }, resource, `${fieldPath}Item`, imports),
      ]);
    case 'object':
      return renderObjectFieldExpression(field, resource, fieldPath, imports, options);
    case 'unknown':
    default:
      return renderFieldCall('field.json', options);
  }
}

function renderObjectFieldExpression(field: SchemaField, resource: SchemaResource, fieldPath: string, imports: ImportMap, options: Record<string, unknown>): string {
  const fields = field.fields ?? {};
  const fieldEntries = Object.entries(fields);
  if (fieldEntries.length === 0) {
    return renderFieldCall('field.object', options);
  }

  const lines = ['field.object({'];
  for (const [childName, childField] of fieldEntries) {
    lines.push(`        ${propertyName(childName)}: ${renderBaseFieldExpression(childField, resource, `${fieldPath}${childName}`, imports)},`);
  }
  const optionText = renderOptions(options);
  lines.push(`      }${optionText ? `, ${optionText}` : ''})`);
  return lines.join('\n');
}

function fieldOptions(field: SchemaField): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (field.required === true) {
    options.required = true;
  }
  if (field.nullable === true) {
    options.nullable = true;
  }
  if (field.description !== undefined) {
    options.description = field.description;
  }
  if (field.default !== undefined) {
    options.default = field.default;
  }
  if (field.unique === true) {
    options.unique = true;
  }
  for (const key of ['min', 'max', 'minLength', 'maxLength', 'pattern']) {
    if (field[key] !== undefined) {
      options[key] = field[key];
    }
  }
  if (field.additionalProperties !== undefined) {
    options.additionalProperties = field.additionalProperties;
  }
  if (field.relation !== undefined) {
    options.relation = field.relation;
  }
  if (field.readOnly === true && field.derived === undefined) {
    options.readOnly = true;
  }
  return options;
}

function renderFieldCall(callee: string, options: Record<string, unknown>, args: string[] = []): string {
  const renderedArgs: string[] = [...args];
  const optionText = renderOptions(options);
  if (optionText) {
    renderedArgs.push(optionText);
  }
  return `${callee}(${renderedArgs.join(', ')})`;
}

function renderOptions(options: Record<string, unknown>): string {
  return Object.keys(options).length === 0 ? '' : objectLiteral(options);
}

function renderUnbundledSchemaModule(
  config: CliConfig,
  project: SchemaProject,
  resource: SchemaResource,
  outFile: string,
  rootSchemaPath = projectRootSchemaPath(config, project),
): string {
  const imports: ImportMap = new Map();
  if (resourceHasExecutableFunctions(resource)) {
    imports.set(rootSchemaPath, 'rootSchema');
  }

  return renderSchemaModule(resource, {
    config,
    imports,
    outFile,
    rootSchemaAlias: imports.get(rootSchemaPath),
  });
}

function renderSchemaModule(resource: SchemaResource, options: RenderSchemaModuleOptions = {}): string {
  const helper = resource.kind === 'document' ? 'document' : 'collection';
  const lines = [
    `import { collection, document, field, files } from '@async/db/schema';`,
  ];
  for (const [sourceFile, alias] of options.imports ?? []) {
    lines.push(`import ${alias} from '${moduleSpecifier(options.outFile, sourceFile)}';`);
  }
  const validator = resourceHasStandardValidator(resource)
    ? validatorAccess(resource, options.imports ?? new Map(), options)
    : undefined;
  const standardSchemaFirst = shouldEmitStandardSchemaFirst(options.config, resource) && validator;
  lines.push(
    '',
    standardSchemaFirst
      ? `export default ${helper}(${validator}, {`
      : `export default ${helper}({`,
  );
  if (resource.description) {
    lines.push(`  description: ${JSON.stringify(resource.description)},`);
  }
  if (resource.source) {
    lines.push(`  source: ${renderSourceExpression(resource.source)},`);
  }
  if (resource.kind === 'collection') {
    lines.push(`  idField: ${JSON.stringify(resource.idField)},`);
  }
  if (validator && !standardSchemaFirst) {
    lines.push(`  validator: ${validator},`);
  }
  lines.push('  fields: {');
  for (const [fieldName, field] of Object.entries(resource.fields ?? {})) {
    lines.push(`    ${propertyName(fieldName)}: ${renderFieldExpression(field, resource, fieldName, options.imports ?? new Map(), fieldName, {
      rootSchemaAlias: options.rootSchemaAlias,
    })},`);
  }
  lines.push('  },');
  lines.push('});', '');
  return lines.join('\n');
}

function bundleAllSeedWrites(config: CliConfig, project: SchemaProject, rootOutFile: string, options: BundleOptions = {}): PlannedWrite[] {
  return project.resources
    .filter((resource) => (
      resource.schemaHasSeed
      && !resource.dataPath
      && !isEmptySeed(resource.schemaSeed, resource.kind)
    ))
    .map((resource) => {
      const filePath = defaultSeedOutFile(config, resource);
      return {
        kind: 'seed',
        filePath,
        content: `${JSON.stringify(resource.schemaSeed, null, 2)}\n`,
        diagnostic: bundleSeedUnbundledDiagnostic(config, resource, filePath, rootOutFile),
        options: {
          force: options.force,
          existsCode: 'SCHEMA_BUNDLE_SEED_OUTPUT_EXISTS',
          existsHint: 'Review the existing seed data file, remove embedded schema seed, choose a different data file source, or pass --force to overwrite it.',
          command: 'schema bundle --all',
          resource: resource.name,
        },
      };
    });
}

function importedResolverDiagnostic(
  config: CliConfig,
  resource: SchemaResource,
  fieldName: string,
  resolverKind: string,
  rootOutFile: string,
): SchemaDiagnostic {
  const relative = path.relative(config.cwd, resource.schemaPath);
  const wrapper = resolverFunctionName(resource.name, fieldName, resolverKind);
  const rootFile = path.relative(config.cwd, rootOutFile).split(path.sep).join('/');
  return {
    code: 'SCHEMA_BUNDLE_IMPORTED_RESOLVER',
    severity: 'warn',
    resource: resource.name,
    file: relative,
    message: `SCHEMA_BUNDLE_IMPORTED_RESOLVER: ${resource.name}.${fieldName} uses a ${resolverKind} resolver from ${relative}. The root schema will import the original module and generate an inline named wrapper to preserve behavior.`,
    hint: `This is safe and non-destructive. To make ${rootFile} fully standalone, move the resolver body into ${wrapper} manually.`,
    details: {
      command: 'schema bundle --all',
      resource: resource.name,
      field: fieldName,
      resolver: resolverKind,
      wrapper,
      strategy: 'inline-wrapper-import-original-module',
    },
  };
}

function importedValidatorDiagnostic(config: CliConfig, resource: SchemaResource, rootOutFile: string): SchemaDiagnostic {
  const relative = path.relative(config.cwd, resource.schemaPath);
  const rootFile = path.relative(config.cwd, rootOutFile).split(path.sep).join('/');
  return {
    code: 'SCHEMA_BUNDLE_IMPORTED_VALIDATOR',
    severity: 'warn',
    resource: resource.name,
    file: relative,
    message: `SCHEMA_BUNDLE_IMPORTED_VALIDATOR: ${resource.name} uses a Standard Schema validator from ${relative}. The root schema will import the original module and reference its validator to preserve behavior.`,
    hint: `This is safe and non-destructive. Keep the original schema module available, or move the validator definition into ${rootFile} manually.`,
    details: {
      command: 'schema bundle --all',
      resource: resource.name,
      strategy: 'import-original-module-validator-reference',
    },
  };
}

function bundleSeedUnbundledDiagnostic(config: CliConfig, resource: SchemaResource, outFile: string, rootOutFile: string): SchemaDiagnostic {
  const relative = path.relative(config.cwd, outFile);
  const rootFile = path.relative(config.cwd, rootOutFile).split(path.sep).join('/');
  return {
    code: 'SCHEMA_BUNDLE_SEED_UNBUNDLED',
    severity: 'warn',
    resource: resource.name,
    file: relative,
    message: `SCHEMA_BUNDLE_SEED_UNBUNDLED: ${resource.name} has embedded schema seed. schema bundle --all wrote ${relative} so ${rootFile} can stay schema-only.`,
    hint: `Keep seed data in ${relative}. The generated root schema intentionally omits seed.`,
    details: {
      command: 'schema bundle --all',
      resource: resource.name,
      file: relative,
      strategy: 'split-schema-seed-before-root-bundle',
    },
  };
}

function arrowResolverDiagnostic(
  config: CliConfig,
  resource: SchemaResource,
  fieldName: string,
  resolverKind: string,
  rootOutFile: string,
): SchemaDiagnostic {
  const relative = path.relative(config.cwd, resource.schemaPath);
  const wrapper = resolverFunctionName(resource.name, fieldName, resolverKind);
  const rootFile = path.relative(config.cwd, rootOutFile).split(path.sep).join('/');
  return {
    code: 'SCHEMA_BUNDLE_ARROW_RESOLVER_WRAPPED',
    severity: 'warn',
    resource: resource.name,
    file: relative,
    message: `SCHEMA_BUNDLE_ARROW_RESOLVER_WRAPPED: ${resource.name}.${fieldName} ${resolverKind} is an arrow-like resolver. The generated wrapper preserves behavior, but the original resolver still cannot use runtime this.`,
    hint: `To use services through this, move the resolver body into ${wrapper} in ${rootFile}.`,
    details: {
      command: 'schema bundle --all',
      resource: resource.name,
      field: fieldName,
      resolver: resolverKind,
      wrapper,
    },
  };
}

function executableUnbundleDiagnostic(config: CliConfig, resource: SchemaResource, outFile: string): SchemaDiagnostic {
  const relative = path.relative(config.cwd, outFile);
  const reasons = executableSchemaFunctionReasons(resource);
  const label = reasons.includes('computed-resolver') && reasons.includes('standard-validator')
    ? 'computed resolvers and Standard Schema validators'
    : reasons.includes('standard-validator')
      ? 'Standard Schema validators'
      : 'executable resolver functions';
  return {
    code: 'SCHEMA_UNBUNDLE_EXECUTABLE_REQUIRES_MODULE',
    severity: 'warn',
    resource: resource.name,
    file: relative,
    message: `SCHEMA_UNBUNDLE_EXECUTABLE_REQUIRES_MODULE: ${resource.name} contains ${label}, so schema unbundle --all will write ${relative} instead of JSONC.`,
    hint: 'Keep the executable schema module output so behavior is preserved through imports and inline wrappers.',
    details: {
      command: 'schema unbundle --all',
      resource: resource.name,
      file: relative,
      outputFormat: path.extname(outFile).slice(1),
      reason: reasons.length === 1 ? reasons[0] : reasons,
    },
  };
}

function bundleDuplicateResourceDiagnostic(config: CliConfig, project: SchemaProject): SchemaDiagnostic | undefined {
  const duplicate = project.diagnostics.find((diagnostic) => diagnostic.code === 'DUPLICATE_RESOURCE_NAME');
  if (!duplicate) {
    return undefined;
  }

  const files = duplicate.details?.files ?? (duplicate.file ? [duplicate.file] : []);
  return {
    code: 'SCHEMA_BUNDLE_DUPLICATE_RESOURCE',
    severity: 'error',
    resource: duplicate.resource,
    files,
    message: `Multiple schema or data sources resolve to resource "${duplicate.resource}".`,
    hint: duplicate.hint ?? 'Rename one source or configure resource naming before bundling all schemas.',
    details: {
      command: 'schema bundle --all',
      resource: duplicate.resource,
      files,
      severity: 'error',
      originalCode: duplicate.code,
      cwd: config.cwd,
    },
  };
}

function resourceHasResolvers(resource: SchemaResource): boolean {
  return Object.keys(resource.resolvers?.fields ?? {}).length > 0;
}

function resourceHasStandardValidator(resource: SchemaResource): boolean {
  return Boolean(resource.validators?.standard);
}

function shouldEmitStandardSchemaFirst(config: CliConfig | undefined, resource: SchemaResource): boolean {
  return Boolean(config?.schema?.standardSchema && resourceHasStandardValidator(resource));
}

function resourceHasExecutableFunctions(resource: SchemaResource): boolean {
  return resourceHasResolvers(resource) || resourceHasStandardValidator(resource);
}

function resourceHasExecutableSchema(resource: SchemaResource): boolean {
  return Boolean(resource.source) || resourceHasExecutableFunctions(resource);
}

function executableSchemaFunctionReasons(resource: SchemaResource): string[] {
  const reasons: string[] = [];
  if (resourceHasResolvers(resource)) {
    reasons.push('computed-resolver');
  }
  if (resourceHasStandardValidator(resource)) {
    reasons.push('standard-validator');
  }
  return reasons;
}

function ensureResourceImport(resource: SchemaResource, imports: ImportMap): string {
  const alias = imports.get(resource.schemaPath) ?? importAliasForResource(resource.name, imports);
  imports.set(resource.schemaPath, alias);
  return alias;
}

function resolverFieldAccess(resource: SchemaResource, fieldName: string, imports: ImportMap, options: FieldRenderOptions = {}): string | undefined {
  if (options.rootSchemaAlias) {
    return memberExpression(memberExpression(memberExpression(options.rootSchemaAlias, resource.name), 'fields'), fieldName);
  }

  const alias = imports.get(resource.schemaPath);
  if (!alias) {
    return undefined;
  }
  return memberExpression(memberExpression(alias, 'fields'), fieldName);
}

function validatorAccess(resource: SchemaResource, imports: ImportMap, options: FieldRenderOptions = {}): string | undefined {
  const base = options.rootSchemaAlias
    ? memberExpression(options.rootSchemaAlias, resource.name)
    : imports.get(resource.schemaPath);
  if (!base) {
    return undefined;
  }
  return memberExpression(base, resource.validatorSource ?? 'validator');
}

function resolverFunctionName(resourceName: string, fieldName: string, resolverKind: string): string {
  const suffix = resolverKind === 'resolveMany' ? 'resolveMany' : 'resolver';
  let name = `${resourceName}_${fieldName}_${suffix}`.replace(/[^A-Za-z0-9_$]/g, '_');
  if (!/^[A-Za-z_$]/.test(name)) {
    name = `resource_${name}`;
  }
  return name;
}

function importAliasForResource(resourceName: string, imports: ImportMap): string {
  let alias = `${resourceName}Source`.replace(/[^A-Za-z0-9_$]/g, '_');
  if (!/^[A-Za-z_$]/.test(alias)) {
    alias = `resource_${alias}`;
  }
  const used = new Set(imports.values());
  let next = alias;
  let suffix = 2;
  while (used.has(next)) {
    next = `${alias}${suffix}`;
    suffix += 1;
  }
  return next;
}

function moduleSpecifier(fromFile: string, sourceFile: string): string {
  let relative = path.relative(path.dirname(fromFile), sourceFile).split(path.sep).join('/');
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }
  return relative;
}

async function defaultRootSchemaOutFile(config: CliConfig, project: SchemaProject): Promise<string> {
  if (typeof project.rootSchema?.file === 'string' && project.rootSchema.file) {
    return project.rootSchema.file;
  }

  return await rootPackageIsModule(config)
    ? path.join(config.cwd, 'db.schema.js')
    : path.join(config.cwd, 'db.schema.mjs');
}

function projectRootSchemaPath(config: CliConfig, project: SchemaProject): string {
  return typeof project.rootSchema?.file === 'string' && project.rootSchema.file
    ? project.rootSchema.file
    : path.join(config.cwd, 'db.schema.mjs');
}

function isRootSchemaOutput(config: CliConfig, filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return path.dirname(resolved) === path.resolve(config.cwd)
    && (path.basename(resolved) === 'db.schema.mjs' || path.basename(resolved) === 'db.schema.js');
}

function isExecutableSchemaFile(filePath: string | undefined): boolean {
  return Boolean(filePath?.endsWith('.schema.mjs') || filePath?.endsWith('.schema.js'));
}

function propertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function memberExpression(base: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${base}.${key}`
    : `${base}[${JSON.stringify(key)}]`;
}

function literal(value: unknown, indent = '      '): string {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .join(`\n${indent}`);
}

function objectLiteral(value: Record<string, unknown>): string {
  const entries = Object.entries(value);
  const inline = `{ ${entries.map(([key, entry]) => `${propertyName(key)}: ${JSON.stringify(entry)}`).join(', ')} }`;
  if (inline.length <= 100 && !inline.includes('\n')) {
    return inline;
  }

  return `{\n${entries.map(([key, entry]) => `        ${propertyName(key)}: ${literal(entry, '        ')}`).join(',\n')}\n      }`;
}

function isArrowLikeFunction(value: unknown): boolean {
  return typeof value === 'function' && value.prototype === undefined;
}

function requireSchemaResource(project: SchemaProject, name: string): SchemaResource {
  const resourceMap = new Map<string, SchemaResource>(project.resources.map((resource) => [resource.name, resource]));
  const { resource, candidates } = resolveResource(resourceMap, name) as { resource?: SchemaResource; candidates: string[] };
  if (!resource) {
    throw dbError(
      'SCHEMA_UNKNOWN_RESOURCE',
      `Unknown schema resource "${name}".`,
      {
        status: 404,
        hint: `Use one of: ${listChoices(project.resources.map((resource) => resource.name))}.`,
        details: {
          resource: name,
          requestedResource: name,
          normalizedCandidates: candidates,
          availableResources: project.resources.map((resource) => resource.name),
        },
      },
    );
  }
  return resource;
}

export function schemaSourceForResource(resource: SchemaResource, options: { includeSeed?: boolean } = {}): SchemaSource {
  const source: SchemaSource = {
    kind: resource.kind,
    fields: resource.fields,
  };

  if (resource.kind === 'collection') {
    source.idField = resource.idField;
  }

  if (resource.source) {
    source.source = resource.source;
  }

  if (resource.store) {
    source.store = resource.store;
  }

  if (resource.parser) {
    source.parser = resource.parser;
  }

  if (options.includeSeed) {
    source.seed = resource.seed;
  }

  return source;
}

function schemaMigrationFormat(args: string[]): 'mixed' | 'jsonc' {
  const format = valueAfter(args, '--format') ?? 'mixed';
  if (format === 'mixed' || format === 'jsonc') {
    return format;
  }

  throw dbError(
    'SCHEMA_MIGRATE_INVALID_FORMAT',
    `SCHEMA_MIGRATE_INVALID_FORMAT: unsupported schema migration format "${format}".`,
    {
      hint: 'Use --format mixed or --format jsonc.',
    },
  );
}

function resolveOutputPath(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
}

function relativeOutputPath(cwd: string, filePath: string): string {
  return path.relative(cwd, filePath).split(path.sep).join('/');
}

function outputPath(config: CliConfig, maybePath: string | undefined): string | undefined {
  return maybePath ? path.resolve(config.cwd, maybePath) : undefined;
}

function defaultSchemaOutFile(config: CliConfig, resource: SchemaResource): string {
  if (resource.schemaPath && !isExecutableSchemaFile(resource.schemaPath)) {
    return resource.schemaPath;
  }

  return path.join(config.sourceDir, `${resource.name}.schema.jsonc`);
}

function defaultSeedOutFile(config: CliConfig, resource: SchemaResource): string {
  return resource.dataPath ?? path.join(config.sourceDir, `${resource.name}.json`);
}

async function executableSchemaOutputPlan(
  config: CliConfig,
  schemaDir: string,
): Promise<{ extension: 'js' | 'mjs'; packageWrite?: PlannedWrite }> {
  const nearestPackage = await nearestPackageInfo(schemaDir);
  if (nearestPackage?.type === 'module') {
    return { extension: 'js' };
  }

  if (await shouldCreateFixtureModulePackageJson(config, schemaDir, nearestPackage)) {
    return {
      extension: 'js',
      packageWrite: {
        kind: 'module-package',
        filePath: path.join(config.sourceDir, 'package.json'),
        content: `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
        options: {
          existsCode: 'SCHEMA_UNBUNDLE_MODULE_PACKAGE_EXISTS',
          existsHint: 'Review the existing data folder package marker, choose a different --schema-dir, or disable schema.autoModulePackageJson.',
          command: 'schema unbundle --all',
        },
      },
    };
  }

  return { extension: 'mjs' };
}

async function rootPackageIsModule(config: CliConfig): Promise<boolean> {
  return (await nearestPackageInfo(config.cwd))?.type === 'module';
}

async function shouldCreateFixtureModulePackageJson(
  config: CliConfig,
  schemaDir: string,
  nearestPackage: PackageInfo | null,
): Promise<boolean> {
  if (config.schema?.autoModulePackageJson === false || !config.cwd || !config.sourceDir) {
    return false;
  }
  if (!isInsidePath(config.sourceDir, schemaDir)) {
    return false;
  }

  const fixturePackageFile = path.join(config.sourceDir, 'package.json');
  if (nearestPackage && (
    path.resolve(nearestPackage.file) === path.resolve(fixturePackageFile)
    || isInsidePath(config.sourceDir, nearestPackage.file)
  )) {
    return false;
  }

  return !await fileExists(fixturePackageFile);
}

async function nearestPackageInfo(directory: string): Promise<PackageInfo | null> {
  let current = path.resolve(directory);
  while (true) {
    const packageFile = path.join(current, 'package.json');
    const info = await packageInfo(packageFile);
    if (info) {
      return info;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function packageInfo(packageFile: string): Promise<PackageInfo | null> {
  try {
    const json = JSON.parse(await readText(packageFile));
    return {
      file: packageFile,
      type: typeof json?.type === 'string' ? json.type : null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    return {
      file: packageFile,
      type: null,
    };
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readText(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function writeOutput(filePath: string, content: string, config: CliConfig, options: WriteOptions = {}): Promise<boolean> {
  const result = await preflightOutput(filePath, content, config, options);
  if (!result.shouldWrite) {
    return false;
  }

  await writeText(filePath, content);
  return true;
}

async function preflightOutput(filePath: string, content: string, config: CliConfig, options: WriteOptions = {}): Promise<{ shouldWrite: boolean }> {
  if (options.force) {
    return { shouldWrite: true };
  }

  if (!options.force) {
    try {
      const existing = await readText(filePath);
      if (contentMatches(existing, content)) {
        return { shouldWrite: false };
      }

      const relative = path.relative(config.cwd, filePath);
      const code = options.existsCode ?? 'SCHEMA_OUTPUT_EXISTS';
      throw dbError(
        code,
        `${code}: ${relative} already exists with different content.`,
        {
          hint: options.existsHint ?? 'Review the existing file, choose a different output path, or pass --force to overwrite it.',
          details: {
            command: options.command,
            resource: options.resource,
            file: relative,
            severity: 'error',
          },
        },
      );
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return { shouldWrite: true };
}

function contentMatches(existing: string, next: string): boolean {
  if (existing === next) {
    return true;
  }

  try {
    return stableJsonStringify(JSON.parse(existing)) === stableJsonStringify(JSON.parse(next));
  } catch {
    return false;
  }
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function isEmptySeed(seed: unknown, kind: unknown): boolean {
  if (kind === 'collection') {
    return Array.isArray(seed) && seed.length === 0;
  }

  return seed && typeof seed === 'object' && !Array.isArray(seed) && Object.keys(seed).length === 0;
}

function isInsidePath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function positionalArgs(args: string[]): string[] {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out' || arg === '--schema-out' || arg === '--seed-out' || arg === '--schema-dir' || arg === '--cwd' || arg === '--config') {
      index += 1;
      continue;
    }
    if (arg === '--all') {
      continue;
    }
    if (!String(arg).startsWith('-')) {
      output.push(arg);
    }
  }
  return output;
}
