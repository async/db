import { runDbDoctor } from '../../doctor.js';
import { isHelpRequested } from '../args.js';
import { printDoctorHelp, printDoctorResult } from '../output.js';

type CliConfig = Record<string, unknown>;

type DoctorResult = {
  summary: {
    error: number;
    warn: number;
  };
  findings: Array<{
    severity: string;
    code: string;
    message: string;
    hint?: string;
  }>;
  usage?: unknown;
};

export async function runDoctor(config: CliConfig, args: string[]): Promise<void> {
  if (isHelpRequested(args)) {
    printDoctorHelp();
    return;
  }

  const result = await runDbDoctor(doctorConfig(config, args)) as DoctorResult;

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printDoctorResult(result);
  }

  if (result.summary.error > 0 || (args.includes('--strict') && result.summary.warn > 0)) {
    process.exitCode = 1;
  }
}

function doctorConfig(config: CliConfig, args: string[]): CliConfig {
  if (!args.includes('--production') && !args.includes('--usage')) {
    return config;
  }

  return {
    ...config,
    doctor: {
      ...(config.doctor && typeof config.doctor === 'object' ? config.doctor : {}),
      ...(args.includes('--production') ? { production: true } : {}),
      ...(args.includes('--usage') ? {
        usage: {
          enabled: true,
          target: usageTarget(args),
        },
      } : {}),
    },
  };
}

function usageTarget(args: string[]): string | undefined {
  const index = args.indexOf('--usage');
  const value = index === -1 ? undefined : args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}
