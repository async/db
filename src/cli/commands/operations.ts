import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOperationManifest, operationClientContract } from '../../operations.js';
import { resolveFrom, writeText } from '../../fs-utils.js';
import { valueAfter } from '../args.js';

type CliConfig = {
  cwd?: string;
  outputs?: {
    operationRefs?: string | null;
  };
  operations?: {
    refsOutFile?: string | null;
  };
  [key: string]: unknown;
};

type ContractTargetOptions = {
  check?: boolean;
};

export async function runOperations(config: CliConfig, args: string[]): Promise<void> {
  if (args[0] === 'contract') {
    await runOperationContract(config, args);
    return;
  }

  if (args[0] !== 'build') {
    throw new Error('Unknown operations command. Use async-db operations build or async-db operations contract.');
  }

  const result = await buildOperationManifest(config, {
    outFile: valueAfter(args, '--out'),
    refsOutFile: valueAfter(args, '--refs-out'),
  });

  if (result.outFiles.length === 0 && result.refsOutFiles.length === 0) {
    console.log(JSON.stringify(result.manifest, null, 2));
    return;
  }

  for (const filePath of [...result.outFiles, ...result.refsOutFiles]) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
}

async function runOperationContract(config: CliConfig, args: string[]): Promise<void> {
  const result = await buildOperationManifest(config, {
    write: false,
  });
  const contract = operationClientContract(result.refs);
  const content = contractContent(contract);
  const check = args.includes('--check');
  const target = contractTarget(config, args, { check });

  if (check) {
    if (!target) {
      throw new Error('Operation contract check needs --out <file> or outputs.operationRefs in db.config.mjs.');
    }
    const expected = operationClientContract(JSON.parse(await readFile(target, 'utf8')));
    const expectedContent = contractContent(expected);
    if (expectedContent !== content) {
      const relative = path.relative(config.cwd, target);
      throw new Error(`Operation client contract changed for ${relative}. Review the exposed operation names and refs, then regenerate or approve the committed contract.`);
    }
    console.log(`Operation client contract matches ${path.relative(config.cwd, target)}`);
    return;
  }

  if (target) {
    await writeText(target, content);
    console.log(`Generated ${path.relative(config.cwd, target)}`);
    return;
  }

  console.log(content.trimEnd());
}

function contractTarget(config: CliConfig, args: string[], options: ContractTargetOptions = {}): string | null {
  const explicitTarget = valueAfter(args, '--out');
  const target = explicitTarget ?? (options.check ? config.outputs?.operationRefs ?? config.operations?.refsOutFile : null);
  return target ? resolveFrom(config.cwd, target) : null;
}

function contractContent(contract: unknown): string {
  return `${JSON.stringify(contract, null, 2)}\n`;
}
