import { loadConfig } from '../config.js';
import { defaultGeneratorRegistry } from '../features/generate/registry.js';
import { isHelpRequested, parseGlobalOptions } from './args.js';
import { runCreate } from './commands/create.js';
import { runContracts } from './commands/contracts.js';
import { runDoctor } from './commands/doctor.js';
import { runGenerate } from './commands/generate.js';
import { runIntegrate } from './commands/integrate.js';
import { runSchema } from './commands/schema.js';
import { runServe } from './commands/serve.js';
import { runSync } from './commands/sync.js';
import { runTypes } from './commands/types.js';
import { runViewer } from './commands/viewer.js';
import { runUsage } from './commands/usage.js';
import { runOperations } from './commands/operations.js';
import { printContractsHelp, printDiagnostic, printDoctorHelp, printGenerateHelp, printHelp, printIntegrateHelp, printOperationsHelp, printSchemaHelp, printServeHelp, printTypesHelp, printUsageHelp, printViewerHelp } from './output.js';

type CliError = Error & {
  diagnostics?: Array<{
    severity?: string;
    message: string;
    [key: string]: unknown;
  }>;
};

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const command = args[0] ?? 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log('0.1.0');
    return;
  }

  if (printSubcommandHelp(command, args.slice(1))) {
    return;
  }

  const config = await loadConfig(parseGlobalOptions(args));

  switch (command) {
    case 'sync':
      await runSync(config);
      break;
    case 'types':
      await runTypes(config, args.slice(1));
      break;
    case 'schema':
      await runSchema(config, args.slice(1));
      break;
    case 'doctor':
    case 'check':
      await runDoctor(config, args.slice(1));
      break;
    case 'create':
      await runCreate(config, args.slice(1));
      break;
    case 'serve':
      await runServe(config, args.slice(1));
      break;
    case 'viewer':
      await runViewer(config, args.slice(1));
      break;
    case 'usage':
      await runUsage(config, args.slice(1));
      break;
    case 'integrate':
      await runIntegrate(config, args.slice(1));
      break;
    case 'contracts':
      await runContracts(config, args.slice(1));
      break;
    case 'operations':
      await runOperations(config, args.slice(1));
      break;
    case 'generate':
      await runGenerate(config, args.slice(1));
      break;
    default:
      throw new Error(`Unknown command "${command}". Run "async-db help".`);
  }
}

function printSubcommandHelp(command: string, args: string[]): boolean {
  if (!isHelpRequested(args)) {
    return false;
  }

  switch (command) {
    case 'types':
      printTypesHelp();
      return true;
    case 'schema':
      printSchemaHelp();
      return true;
    case 'doctor':
    case 'check':
      printDoctorHelp();
      return true;
    case 'serve':
      printServeHelp();
      return true;
    case 'viewer':
      printViewerHelp();
      return true;
    case 'usage':
      printUsageHelp();
      return true;
    case 'integrate':
      printIntegrateHelp();
      return true;
    case 'contracts':
      printContractsHelp();
      return true;
    case 'operations':
      printOperationsHelp();
      return true;
    case 'generate':
      printGenerateHelp(generateHelpUsage(args));
      return true;
    default:
      return false;
  }
}

function generateHelpUsage(args: string[]): string {
  const registry = defaultGeneratorRegistry();
  const target = args.find((arg) => !arg.startsWith('-'));
  return registry.get(target)?.usage ?? registry.usage();
}

export function runCli(args: string[] = process.argv.slice(2)): void {
  main(args).catch((error) => {
    const cliError = error as CliError;
    if (cliError.diagnostics) {
      for (const diagnostic of cliError.diagnostics) {
        printDiagnostic(diagnostic);
      }
    }

    console.error(cliError.message);
    process.exitCode = 1;
  });
}
