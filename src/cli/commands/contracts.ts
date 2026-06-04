import path from 'node:path';
import {
  buildContractRefsManifest,
  checkContracts,
  inferContractsFromTags,
  inferContractsFromUsage,
} from '../../operations.js';
import { writeText } from '../../fs-utils.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printContractsHelp } from '../output.js';

type CliConfig = {
  cwd?: string;
  fs?: unknown;
  outputs?: {
    contractRefs?: string | null;
  };
  [key: string]: unknown;
};

export async function runContracts(config: CliConfig, args: string[]): Promise<void> {
  if (isHelpRequested(args)) {
    printContractsHelp();
    return;
  }

  if (args[0] === 'infer') {
    await runContractsInfer(config, args.slice(1));
    return;
  }

  if (args[0] === 'check') {
    await runContractsCheck(config, args.slice(1));
    return;
  }

  if (args[0] === 'refs') {
    await runContractsRefs(config, args.slice(1));
    return;
  }

  throw new Error('Unknown contracts command. Use async-db contracts infer, async-db contracts check, or async-db contracts refs.');
}

async function runContractsInfer(config: CliConfig, args: string[]): Promise<void> {
  const outFile = valueAfter(args, '--out');
  const manifest = args.includes('--from-usage')
    ? await inferContractsFromUsage(config as never, {
      target: inferUsageTarget(args),
    })
    : args.includes('--from-tags')
      ? await inferContractsFromTags(config as never)
      : null;

  if (!manifest) {
    throw new Error('Contract inference needs --from-tags or --from-usage.');
  }

  await printOrWriteJson(config, outFile, manifest);
}

async function runContractsCheck(config: CliConfig, args: string[]): Promise<void> {
  const result = await checkContracts(config as never);
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('Contract check passed');
  } else {
    console.log(`Contract check found ${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}`);
    for (const finding of result.findings) {
      console.log(`${finding.severity}: ${finding.code}: ${finding.message}`);
      if (finding.hint) {
        console.log(`  hint: ${finding.hint}`);
      }
    }
  }

  if (!result.ok) {
    const error = new Error('Contract check failed') as Error & { code?: string };
    error.code = 'CONTRACT_CHECK_FAILED';
    throw error;
  }
}

async function runContractsRefs(config: CliConfig, args: string[]): Promise<void> {
  const outFile = valueAfter(args, '--out') ?? config.outputs?.contractRefs ?? null;
  const result = await buildContractRefsManifest(config as never, {
    outFile,
  });
  if (result.outFiles.length === 0) {
    console.log(JSON.stringify(result.manifest, null, 2));
    return;
  }
  for (const filePath of result.outFiles) {
    console.log(`Generated ${relativeOutputPath(config, filePath)}`);
  }
}

async function printOrWriteJson(config: CliConfig, outFile: string | undefined, value: unknown): Promise<void> {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (!outFile) {
    console.log(content.trimEnd());
    return;
  }
  const resolved = resolveOutputPath(config, outFile);
  await writeText(resolved, content, config.fs as never);
  console.log(`Generated ${relativeOutputPath(config, resolved)}`);
}

function inferUsageTarget(args: string[]): string | undefined {
  return args.find((arg, index) => (
    !arg.startsWith('-')
    && args[index - 1] !== '--out'
  ));
}

function resolveOutputPath(config: CliConfig, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(config.cwd ?? process.cwd(), filePath);
}

function relativeOutputPath(config: CliConfig, filePath: string): string {
  return path.relative(config.cwd ?? process.cwd(), filePath).split(path.sep).join('/');
}
