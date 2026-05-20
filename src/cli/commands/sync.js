import { syncDb } from '../../sync.js';
import { printDiagnostic } from '../output.js';

export async function runSync(config) {
  const result = await syncDb(config);
  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }
  for (const line of result.logs) {
    console.log(line);
  }
}
