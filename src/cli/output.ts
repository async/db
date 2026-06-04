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
  async-db operations build [--out <file>] [--refs-out <file>]
  async-db operations contract [--out <file>] [--check]
  async-db contracts infer --from-tags [--out <file>]
  async-db contracts infer --from-usage [target] [--out <file>]
  async-db contracts check [--json]
  async-db contracts refs [--out <file>]
  async-db usage scan [target] [--json] [--out <file>] [--check <file>] [--production]
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

Options:
  --out <file>        Write schema manifest, inferred schema, or bundled schema output to this path
  --schema-out <file> Write unbundled schema output to this path
  --seed-out <file>   Write unbundled seed output to this path
  --schema-dir <dir>  Write aggregate unbundled schema files under this directory
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
