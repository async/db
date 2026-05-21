import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { dbError } from '../../errors.js';
import { parseJsonc } from '../../jsonc.js';
import { resolveFrom, writeText } from '../../fs-utils.js';
import { canonicalOperation, normalizeOperationTemplate, stableStringify } from '../../shared/operations.js';
import { operationMapFromEntries } from './maps.js';

export function hashOperation(input) {
  return `sha256:${createHash('sha256').update(stableStringify(canonicalOperation(input))).digest('hex')}`;
}

export async function buildOperationManifest(config, options = {}) {
  const operations = await loadOperationSources(config, options);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const registryEntries = buildRegistryEntries(operations);
  const registry = operationMapFromEntries(registryEntries);
  const refs = {
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
  const manifest = {
    version: 1,
    kind: 'db.operations',
    generatedAt,
    operations: registry,
  };

  const outFiles = [];
  const refsOutFiles = [];
  const shouldWrite = options.write !== false;
  const outFile = outputPath(config, optionValue(options, 'outFile', config.operations?.outFile));
  const refsOutFile = outputPath(config, optionValue(options, 'refsOutFile', config.operations?.refsOutFile));
  if (shouldWrite && outFile) {
    await writeText(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
    outFiles.push(outFile);
  }
  if (shouldWrite && refsOutFile) {
    await writeText(refsOutFile, `${JSON.stringify(refs, null, 2)}\n`);
    refsOutFiles.push(refsOutFile);
  }

  return {
    manifest,
    refs,
    outFiles,
    refsOutFiles,
  };
}

export function operationClientContract(refs) {
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

function buildRegistryEntries(operations) {
  const seenNames = new Map();
  const seenRefs = new Map();
  return operations.map((operation, index) => {
    const normalized = normalizeOperationTemplate(operation);
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

function duplicateOperationName(name, previous, current) {
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

function duplicateOperationRef(ref, previous, current) {
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

async function loadOperationSources(config, options) {
  if (Array.isArray(options.operations)) {
    return options.operations;
  }

  const sourceDir = config.operations?.sourceDir;
  if (!sourceDir) {
    return [];
  }

  try {
    await mkdir(sourceDir, { recursive: true });
  } catch {
    return [];
  }

  const files = await listOperationFiles(sourceDir);
  const operations = [];
  for (const filePath of files) {
    const text = await readFile(filePath, 'utf8');
    const extension = path.extname(filePath);
    if (extension === '.json' || extension === '.jsonc') {
      const parsed = parseJsonc(text, filePath);
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

async function listOperationFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listOperationFiles(filePath));
    } else if (/\.(jsonc?|rest|txt)$/i.test(entry.name)) {
      files.push(filePath);
    }
  }
  return files.sort();
}

function operationNameFromFile(filePath) {
  const basename = path.basename(filePath).replace(/\.(jsonc?|rest|txt)$/i, '');
  return basename.replace(/(^|[-_])([a-z0-9])/gi, (_match, _separator, char) => char.toUpperCase());
}

function optionValue(options, key, fallback) {
  return Object.hasOwn(options, key) && options[key] !== undefined ? options[key] : fallback;
}

function outputPath(config, value) {
  if (!value) {
    return null;
  }
  return resolveFrom(config.cwd, value);
}
