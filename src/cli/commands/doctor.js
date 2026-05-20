import { runDbDoctor } from '../../doctor.js';
import { isHelpRequested } from '../args.js';
import { printDoctorHelp, printDoctorResult } from '../output.js';

export async function runDoctor(config, args) {
  if (isHelpRequested(args)) {
    printDoctorHelp();
    return;
  }

  const result = await runDbDoctor(config);

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printDoctorResult(result);
  }

  if (result.summary.error > 0 || (args.includes('--strict') && result.summary.warn > 0)) {
    process.exitCode = 1;
  }
}
