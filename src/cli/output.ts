type CliDiagnostic = {
  severity?: string;
  message: string;
  [key: string]: unknown;
};

type DoctorFinding = {
  severity: string;
  code: string;
  message: string;
  hint?: string;
};

type DoctorResult = {
  findings: DoctorFinding[];
};

type UsageManifest = {
  summary: {
    filesScanned: number;
    filesWithMatches: number;
    matches: number;
    recommendations: number;
  };
  recommendations: Array<{
    code: string;
    message: string;
    hint: string;
  }>;
};

type SchemaMigrationOutputReport = {
  source: {
    filesScanned: number;
    filesWithMatches: number;
    matches: unknown[];
  };
  resources: Array<{
    name: string;
    output: {
      file: string;
      format: string;
      requiresExecutable: boolean;
    };
    warnings: string[];
  }>;
  suggestions: Array<{
    code: string;
    severity: string;
    message: string;
    hint?: string;
    resource?: string;
    file?: string;
  }>;
};

type SqliteOutputIntegrationReport = {
  sqlite: {
    drivers?: {
      detected: string[];
      recommended: string | null;
      ormDetected: string[];
    };
    tables: Array<{
      name: string;
      classification: string;
    }>;
  };
  source: {
    filesScanned: number;
    filesWithMatches: number;
    matches: unknown[];
  };
  recommendations: Array<{
    kind: string;
    table: string | null;
    message: string;
    nextStep: string;
    adoptionPath?: {
      kind: string;
      asyncDbSurface: string;
      storageMigration: string;
    };
  }>;
  suggestions: Array<{
    code: string;
    severity: string;
    table: string | null;
    message: string;
    hint: string;
  }>;
  importPlan?: {
    target: {
      stateFile: string;
    };
    source: {
      sqliteFile: string;
      driver: string | null;
    };
    resources: Array<{
      resource: string;
      table: string;
      importKind: string;
    }>;
    warnings: string[];
  };
  suggestedFiles: Array<{
    path: string;
    purpose: string;
  }>;
  agentInstructions: string[];
};

type PostgresOutputIntegrationReport = {
  postgres: {
    mode: 'source-only' | 'catalog' | 'partial';
    connectionStringEnv: string | null;
    schemas: string[];
    drivers?: {
      detected: string[];
      recommended: string | null;
      ormDetected: string[];
    };
    catalog: {
      tables: Array<{
        schema: string;
        name: string;
        classification: string;
      }>;
    };
    errors: Array<{
      code: string;
      message: string;
    }>;
  };
  source: {
    filesScanned: number;
    filesWithMatches: number;
    matches: unknown[];
  };
  recommendations: Array<{
    kind: string;
    table: string | null;
    message: string;
    nextStep: string;
    adoptionPath?: {
      kind: string;
      asyncDbSurface: string;
      storageMigration: string;
    };
  }>;
  suggestions: Array<{
    code: string;
    severity: string;
    table: string | null;
    message: string;
    hint: string;
  }>;
  importPlan?: {
    target:
      | {
        kind: 'sqlite-state';
        stateFile: string;
      }
      | {
        kind: 'postgres-envelope';
        schema: string;
        table: string;
      };
    source: {
      connectionStringEnv: string;
      driver: string | null;
    };
    resources: Array<{
      resource: string;
      schema: string;
      table: string;
      importKind: string;
    }>;
    warnings: string[];
  };
  suggestedFiles: Array<{
    path: string;
    purpose: string;
  }>;
  agentInstructions: string[];
};

type IntegrationReport = SqliteOutputIntegrationReport | PostgresOutputIntegrationReport;

export function printDiagnostic(diagnostic: CliDiagnostic): void {
  const prefix = diagnostic.severity === 'error' ? 'error' : 'warn';
  console.error(`${prefix}: ${diagnostic.message}`);
}

export function printDoctorResult(result: DoctorResult): void {
  if (result.findings.length === 0) {
    console.log('async-db doctor found no issues');
    return;
  }

  console.log(`async-db doctor found ${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}`);
  for (const finding of result.findings) {
    console.log(`${finding.severity}: ${finding.code}: ${finding.message}`);
    if (finding.hint) {
      console.log(`  hint: ${finding.hint}`);
    }
  }
}

export function printHelp(): void {
  console.log(`async-db

Usage:
  async-db sync
  async-db types [--watch] [--out <file>]
  async-db schema [resource]
  async-db schema infer [resource] [--out <file>]
  async-db schema unbundle [resource] [--schema-out <file>] [--seed-out <file>] [--empty-seed] [--force]
  async-db schema unbundle --all [--schema-dir <dir>] [--force]
  async-db schema bundle [resource] [--out <file>] [--force]
  async-db schema bundle --all [--out <file>] [--force]
  async-db schema manifest [--out <file>]
  async-db schema validate
  async-db schema migrate inspect [target] [--format mixed|jsonc] [--schema-dir <dir>] [--json] [--out <file>] [--check <file>]
  async-db schema migrate generate --plan <report.json> [--schema-dir <dir>] [--format mixed|jsonc] [--force]
  async-db operations build [--out <file>] [--refs-out <file>]
  async-db operations contract [--out <file>] [--check]
  async-db contracts infer --from-tags [--out <file>]
  async-db contracts infer --from-usage [target] [--out <file>]
  async-db contracts check [--json]
  async-db contracts refs [--out <file>]
  async-db usage scan [target] [--json] [--out <file>] [--check <file>] [--production]
  async-db integrate inspect [target] --sqlite <file> [--target-state <file>] [--json] [--out <file>] [--check <file>]
  async-db integrate inspect [target] --postgres [--postgres-url-env <env>] [--schema <schema>] [--target-postgres-table <schema.table>] [--target-state <file>] [--allow-partial] [--json] [--out <file>] [--check <file>]
  async-db integrate generate importer --plan <report.json> --out <file>
  async-db viewer manifest [--out <file>]
  async-db doctor [--strict] [--json] [--production] [--usage [target]]
  async-db check [--strict] [--json] [--production] [--usage [target]]
  async-db create <collection> <json>
  async-db serve [--host <host>] [--port <port>]
  async-db generate hono [--out <dir>] [--api <targets>] [--app <shape>]

Options:
  --cwd <dir>       Project directory
  --config <file>   Config file path
`);
}

export function printContractsHelp(): void {
  console.log(`async-db contracts

Usage:
  async-db contracts infer --from-tags [--out <file>]
  async-db contracts infer --from-usage [target] [--out <file>]
  async-db contracts check [--json]
  async-db contracts refs [--out <file>]

Options:
  --from-tags     Infer contracts from schema field tags such as public/internal/private
  --from-usage    Infer operation names from app usage scans
  --out <file>    Write inferred contracts or contract-scoped operation refs
  --json          Print machine-readable check results
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printOperationsHelp(): void {
  console.log(`async-db operations

Usage:
  async-db operations build [--out <file>] [--refs-out <file>]
  async-db operations contract [--out <file>] [--check]

Options:
  --out <file>      Build: write the full server registry. Contract: write or check the client contract
  --refs-out <file> Build only: write client-safe operation refs
  --check           Contract only: fail if the generated client contract differs from --out or outputs.operationRefs
  --cwd <dir>       Project directory
  --config <file>   Config file path
`);
}

export function printTypesHelp(): void {
  console.log(`async-db types

Usage:
  async-db types [--watch] [--out <file>]

Options:
  --watch        Regenerate types when fixture sources change
  --out <file>   Write generated types to this path
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printSchemaHelp(): void {
  console.log(`async-db schema

Usage:
  async-db schema [resource]
  async-db schema infer [resource] [--out <file>]
  async-db schema unbundle [resource] [--schema-out <file>] [--seed-out <file>] [--empty-seed] [--force]
  async-db schema unbundle --all [--schema-dir <dir>] [--force]
  async-db schema bundle [resource] [--out <file>] [--force]
  async-db schema bundle --all [--out <file>] [--force]
  async-db schema manifest [--out <file>]
  async-db schema validate
  async-db schema migrate inspect [target] [--format mixed|jsonc] [--schema-dir <dir>] [--json] [--out <file>] [--check <file>]
  async-db schema migrate generate --plan <report.json> [--schema-dir <dir>] [--format mixed|jsonc] [--force]

Options:
  --out <file>        Write schema manifest, inferred schema, or bundled schema output to this path
  --schema-out <file> Write unbundled schema output to this path
  --seed-out <file>   Write unbundled seed output to this path
  --schema-dir <dir>  Write aggregate unbundled schema files under this directory
  --plan <file>       Schema migration report for schema migrate generate
  --format <format>   Schema migration output format: mixed or jsonc
  --json              Print machine-readable schema migration report
  --check <file>      Fail if the generated schema migration report differs from this path, ignoring generatedAt
  --empty-seed        Write an empty seed fixture when unbundling schema-only resources
  --force             Allow overwriting outputs or writing bundle output inside db/
  --all               Skip the interactive target prompt and use all schemas
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printDoctorHelp(): void {
  console.log(`async-db doctor

Usage:
  async-db doctor [--strict] [--json] [--production] [--usage [target]]
  async-db check [--strict] [--json] [--production] [--usage [target]]

Options:
  --strict       Exit with an error when warnings are present
  --json         Print machine-readable findings
  --production   Include production-readiness guidance for JSON-backed resources
  --usage        Scan app usage and include endpoint exposure guidance
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printUsageHelp(): void {
  console.log(`async-db usage

Usage:
  async-db usage scan [target] [--json] [--out <file>] [--check <file>] [--production]

Options:
  --json         Print machine-readable usage manifest
  --out <file>   Write the usage manifest to this path
  --check <file> Fail if the generated manifest differs from this path, ignoring generatedAt
  --production   Include least-exposed production endpoint recommendations
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printUsageResult(manifest: UsageManifest): void {
  console.log(`async-db usage scan found ${manifest.summary.matches} match${manifest.summary.matches === 1 ? '' : 'es'} in ${manifest.summary.filesWithMatches}/${manifest.summary.filesScanned} scanned file${manifest.summary.filesScanned === 1 ? '' : 's'}`);
  for (const recommendation of manifest.recommendations) {
    console.log(`info: ${recommendation.code}: ${recommendation.message}`);
    console.log(`  hint: ${recommendation.hint}`);
  }
}

export function printSchemaMigrationReport(report: SchemaMigrationOutputReport): void {
  console.log(`async-db schema migrate inspect found ${report.resources.length} resource draft${report.resources.length === 1 ? '' : 's'} and ${report.source.matches.length} source match${report.source.matches.length === 1 ? '' : 'es'} in ${report.source.filesWithMatches}/${report.source.filesScanned} scanned file${report.source.filesScanned === 1 ? '' : 's'}`);
  console.log('Existing schema declarations remain the source of truth. Review generated Async DB schema drafts before switching app code.');
  for (const resource of report.resources) {
    console.log(`resource: ${resource.name} -> ${resource.output.file} (${resource.output.format}${resource.output.requiresExecutable ? ', executable review' : ''})`);
    for (const warning of resource.warnings) {
      console.log(`  warn: ${warning}`);
    }
  }
  for (const suggestion of report.suggestions) {
    const target = suggestion.resource ? ` ${suggestion.resource}` : suggestion.file ? ` ${suggestion.file}` : '';
    console.log(`${suggestion.severity}: ${suggestion.code}${target}: ${suggestion.message}`);
    if (suggestion.hint) {
      console.log(`  hint: ${suggestion.hint}`);
    }
  }
}

export function printIntegrateHelp(): void {
  console.log(`async-db integrate

Usage:
  async-db integrate inspect [target] --sqlite <file> [--target-state <file>] [--json] [--out <file>] [--check <file>]
  async-db integrate inspect [target] --postgres [--postgres-url-env <env>] [--schema <schema>] [--target-postgres-table <schema.table>] [--target-state <file>] [--allow-partial] [--json] [--out <file>] [--check <file>]
  async-db integrate generate importer --plan <report.json> --out <file>

Options:
  --sqlite <file>       Existing SQLite database file to inspect
  --postgres            Inspect Postgres source usage and optionally a live read-only catalog
  --postgres-url-env <env>
                        Environment variable containing the Postgres connection URL
  --schema <schema>     Postgres schema to inspect, defaulting to public; comma-separated values are accepted
  --target-postgres-table <schema.table>
                        Explicit Async DB-owned Postgres envelope table for import planning
  --target-state <file> Explicit Async DB-owned SQLite state file for import planning
  --exact-row-counts    Opt into exact Postgres row counts; default uses estimates
  --allow-partial       Emit a partial Postgres report instead of failing when catalog inspection cannot connect
  --plan <report.json>  Integration report containing importPlan
  --json                Print machine-readable integration report
  --out <file>          Write the integration report or generated importer to this path
  --check <file>        Fail if the generated report differs from this path, ignoring generatedAt
  --cwd <dir>           Project directory
  --config <file>       Config file path
`);
}

export function printIntegrationReport(report: IntegrationReport): void {
  if ('postgres' in report) {
    printPostgresIntegrationReport(report);
    return;
  }

  console.log(`async-db integrate inspect found ${report.sqlite.tables.length} SQLite table${report.sqlite.tables.length === 1 ? '' : 's'} and ${report.source.matches.length} source match${report.source.matches.length === 1 ? '' : 'es'} in ${report.source.filesWithMatches}/${report.source.filesScanned} scanned file${report.source.filesScanned === 1 ? '' : 's'}`);
  console.log('Existing SQLite remains the write source of truth. Start by wrapping current DB calls with Async DB operations/contracts; migrate storage only after parity tests pass.');
  if (report.sqlite.drivers?.detected?.length) {
    console.log(`drivers: ${report.sqlite.drivers.detected.join(', ')}; recommended compat driver: ${report.sqlite.drivers.recommended ?? 'manual'}`);
  }
  for (const recommendation of report.recommendations) {
    const target = recommendation.table ? ` ${recommendation.table}` : '';
    console.log(`info: ${recommendation.kind}${target}: ${recommendation.message}`);
    console.log(`  next: ${recommendation.nextStep}`);
    if (recommendation.adoptionPath) {
      console.log(`  path: ${recommendation.adoptionPath.kind} via ${recommendation.adoptionPath.asyncDbSurface}; storage migration ${recommendation.adoptionPath.storageMigration}`);
    }
  }
  if (report.importPlan) {
    console.log(`import plan: ${report.importPlan.source.sqliteFile} -> ${report.importPlan.target.stateFile}`);
    if (report.importPlan.source.driver) {
      console.log(`  driver: ${report.importPlan.source.driver}`);
    }
    for (const resource of report.importPlan.resources) {
      console.log(`  ${resource.table} -> ${resource.resource} (${resource.importKind})`);
    }
  }
  if (report.suggestions?.length > 0) {
    console.log('suggestions:');
    for (const suggestion of report.suggestions) {
      const target = suggestion.table ? ` ${suggestion.table}` : '';
      console.log(`  ${suggestion.severity}: ${suggestion.code}${target}: ${suggestion.message}`);
      console.log(`    hint: ${suggestion.hint}`);
    }
  }
  if (report.suggestedFiles.length > 0) {
    console.log('suggested files:');
    for (const file of report.suggestedFiles) {
      console.log(`  ${file.path}: ${file.purpose}`);
    }
  }
  if (report.agentInstructions.length > 0) {
    console.log('agent instructions:');
    for (const instruction of report.agentInstructions) {
      console.log(`  - ${instruction}`);
    }
  }
}

function printPostgresIntegrationReport(report: PostgresOutputIntegrationReport): void {
  const tables = report.postgres.catalog.tables;
  console.log(`async-db integrate inspect found ${tables.length} Postgres catalog object${tables.length === 1 ? '' : 's'} and ${report.source.matches.length} source match${report.source.matches.length === 1 ? '' : 'es'} in ${report.source.filesWithMatches}/${report.source.filesScanned} scanned file${report.source.filesScanned === 1 ? '' : 's'} (${report.postgres.mode})`);
  console.log('Existing Postgres remains the write source of truth. Start by wrapping current DB calls with Async DB operations/contracts; migrate storage only after parity tests pass.');
  if (report.postgres.connectionStringEnv) {
    console.log(`connection: ${report.postgres.connectionStringEnv} (value redacted)`);
  }
  if (report.postgres.drivers?.detected?.length) {
    console.log(`drivers: ${report.postgres.drivers.detected.join(', ')}; recommended compat driver: ${report.postgres.drivers.recommended ?? 'manual'}`);
  }
  if (report.postgres.drivers?.ormDetected?.length) {
    console.log(`orm/query builders: ${report.postgres.drivers.ormDetected.join(', ')}`);
  }
  for (const error of report.postgres.errors) {
    console.log(`warning: ${error.code}: ${error.message}`);
  }
  for (const recommendation of report.recommendations) {
    const target = recommendation.table ? ` ${recommendation.table}` : '';
    console.log(`info: ${recommendation.kind}${target}: ${recommendation.message}`);
    console.log(`  next: ${recommendation.nextStep}`);
    if (recommendation.adoptionPath) {
      console.log(`  path: ${recommendation.adoptionPath.kind} via ${recommendation.adoptionPath.asyncDbSurface}; storage migration ${recommendation.adoptionPath.storageMigration}`);
    }
  }
  if (report.importPlan) {
    const target = report.importPlan.target.kind === 'sqlite-state'
      ? report.importPlan.target.stateFile
      : `${report.importPlan.target.schema}.${report.importPlan.target.table}`;
    console.log(`import plan: ${report.importPlan.source.connectionStringEnv} -> ${target}`);
    if (report.importPlan.source.driver) {
      console.log(`  driver: ${report.importPlan.source.driver}`);
    }
    for (const resource of report.importPlan.resources) {
      console.log(`  ${resource.schema}.${resource.table} -> ${resource.resource} (${resource.importKind})`);
    }
  }
  if (report.suggestions?.length > 0) {
    console.log('suggestions:');
    for (const suggestion of report.suggestions) {
      const target = suggestion.table ? ` ${suggestion.table}` : '';
      console.log(`  ${suggestion.severity}: ${suggestion.code}${target}: ${suggestion.message}`);
      console.log(`    hint: ${suggestion.hint}`);
    }
  }
  if (report.suggestedFiles.length > 0) {
    console.log('suggested files:');
    for (const file of report.suggestedFiles) {
      console.log(`  ${file.path}: ${file.purpose}`);
    }
  }
  if (report.agentInstructions.length > 0) {
    console.log('agent instructions:');
    for (const instruction of report.agentInstructions) {
      console.log(`  - ${instruction}`);
    }
  }
}

export function printViewerHelp(): void {
  console.log(`async-db viewer

Usage:
  async-db viewer manifest [--out <file>]

Options:
  --out <file>   Write generated viewer manifest output to this path
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printServeHelp(): void {
  console.log(`async-db serve

Usage:
  async-db serve [--host <host>] [--port <port>]

Options:
  --host <host>  Host to bind, defaulting to configured server.host
  --port <port>  Port to bind, defaulting to configured server.port
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printGenerateHelp(usage: string): void {
  console.log(`async-db generate

Usage:
  ${usage}

Options:
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}
