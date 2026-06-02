import path from 'node:path';
import { dbError } from '../../../errors.js';
import { readText, writeText } from '../../../fs-utils.js';

type CliConfig = {
  cwd?: string;
  [key: string]: unknown;
};

export type SchemaWriteOptions = {
  force?: boolean;
  existsCode?: string;
  existsHint?: string;
  command?: string;
  resource?: string;
};

export async function writeSchemaOutput(
  filePath: string,
  content: string,
  config: CliConfig,
  options: SchemaWriteOptions = {},
): Promise<boolean> {
  const result = await preflightSchemaOutput(filePath, content, config, options);
  if (!result.shouldWrite) {
    return false;
  }

  await writeText(filePath, content);
  return true;
}

export async function preflightSchemaOutput(
  filePath: string,
  content: string,
  config: CliConfig,
  options: SchemaWriteOptions = {},
): Promise<{ shouldWrite: boolean }> {
  if (options.force) {
    return { shouldWrite: true };
  }

  try {
    const existing = await readText(filePath);
    if (schemaOutputContentMatches(existing, content)) {
      return { shouldWrite: false };
    }

    const relative = path.relative(config.cwd, filePath);
    const code = options.existsCode ?? 'SCHEMA_OUTPUT_EXISTS';
    throw dbError(
      code,
      `${code}: ${relative} already exists with different content.`,
      {
        hint: options.existsHint ?? 'Review the existing file, choose a different output path, or pass --force to overwrite it.',
        details: {
          command: options.command,
          resource: options.resource,
          file: relative,
          severity: 'error',
        },
      },
    );
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  return { shouldWrite: true };
}

export function schemaOutputContentMatches(existing: string, next: string): boolean {
  if (existing === next) {
    return true;
  }

  try {
    return stableJsonStringify(JSON.parse(existing)) === stableJsonStringify(JSON.parse(next));
  } catch {
    return false;
  }
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}
