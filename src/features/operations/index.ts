import { createHash } from 'node:crypto';
import path from 'node:path';
import { dbError } from '../../errors.js';
import { parseJsonc } from '../../jsonc.js';
import { resolveFrom, writeText } from '../../fs-utils.js';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';
import {
  canonicalOperation,
  normalizeOperationTemplate,
  stableStringify,
  type OperationTemplate,
  type RegisteredOperation,
} from '../../shared/operations.js';
import { operationMapFromEntries } from './maps.js';

type OperationConfig = {
  cwd?: string;
  fs?: DbFileSystem;
  operations?: {
    sourceDir?: string;
    outFile?: string | null;
    refsOutFile?: string | null;
  };
};

type BuildOperationOptions = {
  outFile?: string | null;
  refsOutFile?: string | null;
  generatedAt?: string;
  operations?: OperationTemplate[];
  write?: boolean;
  createDirectory?: boolean;
};

export type OperationRef = {
  name: string;
  ref: string;
};

export type OperationManifest = {
  version: 1;
  kind: 'db.operations';
  generatedAt: string;
  operations: Record<string, RegisteredOperation>;
};

export type OperationRefsManifest = {
  version: 1;
  kind: 'db.operationRefs';
  generatedAt: string;
  operations: Record<string, OperationRef>;
};

export type OperationContract = {
  version: 1;
  kind: 'db.operationContract';
  operations: Record<string, OperationRef>;
};

type DuplicateOperationDetails = {
  index: number;
  name?: string;
  ref?: string;
};

export function hashOperation(input: OperationTemplate): string {
  return `sha256:${createHash('sha256').update(stableStringify(canonicalOperation(input))).digest('hex')}`;
}

export async function buildOperationManifest(config: OperationConfig, options: BuildOperationOptions = {}): Promise<{
  manifest: OperationManifest;
  refs: OperationRefsManifest;
  outFiles: string[];
  refsOutFiles: string[];
}> {
  const operations = await loadOperationSources(config, {
    ...options,
    createDirectory: options.createDirectory ?? true,
  });
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const registryEntries = buildRegistryEntries(operations);
  const registry = operationMapFromEntries(registryEntries);
  const refs: OperationRefsManifest = {
    version: 1,
    kind: 'db.operationRefs',
    generatedAt,
    operations: operationMapFromEntries(registryEntries.map(([ref, operation]) => [
      operation.name ?? ref,
      {
        name: operation.name ?? ref,
        ref: operation.ref,
      },
    ])),
  };
  const manifest: OperationManifest = {
    version: 1,
    kind: 'db.operations',
    generatedAt,
    operations: registry,
  };

  const outFiles: string[] = [];
  const refsOutFiles: string[] = [];
  const shouldWrite = options.write !== false;
  const outFile = outputPath(config, optionValue(options, 'outFile', config.operations?.outFile));
  const refsOutFile = outputPath(config, optionValue(options, 'refsOutFile', config.operations?.refsOutFile));
  const fs = dbFileSystem(config);
  if (shouldWrite && outFile) {
    await writeText(outFile, `${JSON.stringify(manifest, null, 2)}\n`, fs);
    outFiles.push(outFile);
  }
  if (shouldWrite && refsOutFile) {
    await writeText(refsOutFile, `${JSON.stringify(refs, null, 2)}\n`, fs);
    refsOutFiles.push(refsOutFile);
  }

  return {
    manifest,
    refs,
    outFiles,
    refsOutFiles,
  };
}

export async function buildOperationRegistry(
  config: OperationConfig,
  options: BuildOperationOptions = {},
): Promise<Record<string, RegisteredOperation>> {
  const operations = await loadOperationSources(config, options);
  return operationMapFromEntries(buildRegistryEntries(operations));
}

export function operationRegistryFromManifest(manifest: unknown): Record<string, RegisteredOperation> {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw invalidOperationRegistry('invalid-manifest', {
      actualType: Array.isArray(manifest) ? 'array' : typeof manifest,
    });
  }

  const record = manifest as Record<string, unknown>;
  if (record.kind !== 'db.operations') {
    throw invalidOperationRegistry('invalid-manifest-kind', {
      expectedKind: 'db.operations',
      actualKind: typeof record.kind === 'string' ? record.kind : null,
    });
  }

  const operations = record.operations;
  if (!operations || typeof operations !== 'object' || Array.isArray(operations)) {
    throw invalidOperationRegistry('invalid-operations', {
      actualType: Array.isArray(operations) ? 'array' : typeof operations,
    });
  }

  return normalizeOperationRegistry(operations as Record<string, OperationTemplate>);
}

export function normalizeOperationRegistry(registry: Record<string, OperationTemplate>): Record<string, RegisteredOperation> {
  return operationMapFromEntries(
    Object.entries(registry ?? {}).map(([key, operation]) => [key, normalizeRegisteredOperation(key, operation)]),
  );
}

export function operationClientContract(refs: Partial<OperationRefsManifest> | null | undefined): OperationContract {
  return {
    version: 1,
    kind: 'db.operationContract',
    operations: operationMapFromEntries(
      Object.entries(refs?.operations ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, operationRef]) => [
          name,
          {
            name: operationRef?.name ?? name,
            ref: operationRef?.ref,
          },
        ]),
    ),
  };
}

function buildRegistryEntries(operations: OperationTemplate[]): Array<[string, RegisteredOperation]> {
  const seenNames = new Map<string, DuplicateOperationDetails>();
  const seenRefs = new Map<string, DuplicateOperationDetails>();
  return operations.map((operation, index) => {
    const normalized = normalizeRegisteredOperation('', operation);
    const ref = normalized.ref ?? hashOperation(normalized);
    const name = normalized.name ?? ref;
    const previousName = seenNames.get(name);
    if (previousName) {
      throw duplicateOperationName(name, previousName, { index, ref });
    }
    const previousRef = seenRefs.get(ref);
    if (previousRef) {
      throw duplicateOperationRef(ref, previousRef, { index, name });
    }
    seenNames.set(name, { index, ref });
    seenRefs.set(ref, { index, name });
    return [ref, {
      ...normalized,
      name,
      ref,
    }];
  });
}

export function normalizeRegisteredOperation(key: string, operation: OperationTemplate): RegisteredOperation {
  const normalized = normalizeOperationTemplate(operation);
  const source = operation && typeof operation === 'object' && !Array.isArray(operation) ? operation : {};

  if (normalized.kind !== 'graphql' && !normalized.path) {
    throw invalidOperationRegistry('invalid-operation-template', {
      reason: 'missing-executable-template',
      key,
      name: source.name ?? normalized.name ?? null,
      ref: source.ref ?? normalized.ref ?? null,
    });
  }

  if (source.name || normalized.name || key) {
    normalized.name = String(source.name ?? normalized.name ?? key);
  }
  if (source.ref || normalized.ref || key) {
    normalized.ref = String(source.ref ?? normalized.ref ?? key);
  }

  if (!normalized.ref) {
    normalized.ref = hashOperation(normalized);
  }
  if (!normalized.name) {
    normalized.name = normalized.ref;
  }

  return normalized as RegisteredOperation;
}

function invalidOperationRegistry(reason: string, details: Record<string, unknown> = {}): Error {
  return dbError(
    'OPERATION_INVALID_REGISTRY',
    'Registered operation registry must be a db.operations server manifest with executable operation templates.',
    {
      status: 400,
      hint: 'Run async-db operations build to generate the server registry, and use outputs.operationRefs only for client-safe refs.',
      details: {
        reason,
        ...details,
      },
    },
  );
}

function duplicateOperationName(
  name: string,
  previous: DuplicateOperationDetails,
  current: DuplicateOperationDetails,
): Error {
  return dbError(
    'OPERATION_DUPLICATE_NAME',
    `Registered operation name "${name}" is used more than once.`,
    {
      status: 400,
      hint: 'Give each registered operation a unique name so generated client refs map to one callable operation.',
      details: {
        name,
        firstIndex: previous.index,
        duplicateIndex: current.index,
        firstRef: previous.ref,
        duplicateRef: current.ref,
      },
    },
  );
}

function duplicateOperationRef(
  ref: string,
  previous: DuplicateOperationDetails,
  current: DuplicateOperationDetails,
): Error {
  return dbError(
    'OPERATION_DUPLICATE_REF',
    `Registered operation ref "${ref}" is used more than once.`,
    {
      status: 400,
      hint: 'Give each registered operation a unique ref so generated client refs map to one callable operation.',
      details: {
        ref,
        firstIndex: previous.index,
        duplicateIndex: current.index,
        firstName: previous.name,
        duplicateName: current.name,
      },
    },
  );
}

export async function loadOperationSources(
  config: OperationConfig,
  options: BuildOperationOptions = {},
): Promise<OperationTemplate[]> {
  if (Array.isArray(options.operations)) {
    return options.operations;
  }

  const sourceDir = config.operations?.sourceDir;
  if (!sourceDir) {
    return [];
  }

  const fs = dbFileSystem(config);
  if (options.createDirectory === true) {
    try {
      await fs.mkdir(sourceDir, { recursive: true });
    } catch {
      return [];
    }
  }

  let files: string[] = [];
  try {
    files = await listOperationFiles(sourceDir, fs);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return [];
    }
    throw error;
  }

  const operations: OperationTemplate[] = [];
  for (const filePath of files) {
    const text = await fs.readFile(filePath, 'utf8') as string;
    const extension = path.extname(filePath);
    if (extension === '.json' || extension === '.jsonc') {
      const parsed = parseJsonc(text, filePath) as OperationTemplate | OperationTemplate[];
      operations.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      continue;
    }

    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const template = lines.find((line) => !line.startsWith('#'));
    if (template) {
      operations.push({
        name: operationNameFromFile(filePath),
        ...normalizeOperationTemplate(template),
      });
    }
  }
  return operations;
}

async function listOperationFiles(directory: string, fs: DbFileSystem): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listOperationFiles(filePath, fs));
    } else if (/\.(jsonc?|rest|txt)$/i.test(entry.name)) {
      files.push(filePath);
    }
  }
  return files.sort();
}

function operationNameFromFile(filePath: string): string {
  const basename = path.basename(filePath).replace(/\.(jsonc?|rest|txt)$/i, '');
  return basename.replace(/(^|[-_])([a-z0-9])/gi, (_match, _separator, char) => char.toUpperCase());
}

function optionValue<T>(options: Record<string, unknown>, key: string, fallback: T): T | unknown {
  return Object.hasOwn(options, key) && options[key] !== undefined ? options[key] : fallback;
}

function outputPath(config: OperationConfig, value: unknown): string | null {
  if (!value) {
    return null;
  }
  return resolveFrom(config.cwd, String(value));
}
