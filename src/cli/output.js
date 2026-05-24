export function printDiagnostic(diagnostic) {
  const prefix = diagnostic.severity === 'error' ? 'error' : 'warn';
  console.error(`${prefix}: ${diagnostic.message}`);
}

export function printDoctorResult(result) {
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

export function printHelp() {
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
  async-db viewer manifest [--out <file>]
  async-db doctor [--strict] [--json]
  async-db check [--strict] [--json]
  async-db create <collection> <json>
  async-db serve [--host <host>] [--port <port>]
  async-db generate hono [--out <dir>] [--api <targets>] [--app <shape>]

Options:
  --cwd <dir>       Project directory
  --config <file>   Config file path
`);
}

export function printOperationsHelp() {
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

export function printTypesHelp() {
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

export function printSchemaHelp() {
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

export function printDoctorHelp() {
  console.log(`async-db doctor

Usage:
  async-db doctor [--strict] [--json]
  async-db check [--strict] [--json]

Options:
  --strict       Exit with an error when warnings are present
  --json         Print machine-readable findings
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printViewerHelp() {
  console.log(`async-db viewer

Usage:
  async-db viewer manifest [--out <file>]

Options:
  --out <file>   Write generated viewer manifest output to this path
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printServeHelp() {
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

export function printGenerateHelp(usage) {
  console.log(`async-db generate

Usage:
  ${usage}

Options:
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}
