import { syncDb } from '../../sync.js';
import { printDiagnostic } from '../output.js';

type CliConfig = Record<string, unknown>;

export async function runSync(config: CliConfig): Promise<void> {
  const result = await syncDb(config as never);
  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }
  for (const line of result.logs) {
    console.log(line);
  }
}
