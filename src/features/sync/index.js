import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProjectSchema, makeGeneratedSchema } from '../../schema.js';
import { generateSchemaManifest } from '../../schema-manifest.js';
import { generateTypes } from '../../types.js';
import { readJsonState, writeJsonState } from '../runtime/state.js';
import { createRuntime } from '../storage/runtime.js';
import { writeSourceMetadata } from '../storage/source.js';
import { writeText } from '../../fs-utils.js';
import { ensureRuntimeDirs } from './runtime-dirs.js';
import { writeGeneratedIdsToSources } from './source-writes.js';

export { applyDefaultsToRecord, applyDefaultsToSeed } from './defaults.js';

export async function syncJsonFixtureDb(config, options = {}) {
  const project = await loadProjectSchema(config);
  const logs = [];
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const fatalErrors = errors.filter((diagnostic) => diagnostic.code === 'RESOURCE_ALIAS_COLLISION');

  for (const resource of project.resources) {
    logs.push(`Loaded ${path.relative(config.cwd, resource.schemaPath ?? resource.dataPath)}`);
  }

  if (fatalErrors.length > 0 || (errors.length > 0 && options.allowErrors !== true)) {
    const error = new Error(errors.map((diagnostic) => diagnostic.message).join('\n'));
    error.diagnostics = project.diagnostics;
    throw error;
  }

  await writeGeneratedIdsToSources(config, project.resources, logs);

  await ensureRuntimeDirs(config);
  const schemaOutFile = path.join(config.stateDir, 'schema.generated.json');
  project.schema = await preserveGeneratedAt(schemaOutFile, makeGeneratedSchema(project.resources, project.diagnostics));

  await writeText(schemaOutFile, `${JSON.stringify(project.schema, null, 2)}\n`);
  logs.push(`Generated ${path.relative(config.cwd, schemaOutFile)}`);

  if (config.types?.enabled !== false) {
    const result = await generateTypes(config, { project });
    for (const outFile of result.outFiles) {
      logs.push(`Generated ${path.relative(config.cwd, outFile)}`);
    }
  }

  if (config.schemaOutFile) {
    const result = await generateSchemaManifest(config, { project });
    for (const outFile of result.outFiles) {
      logs.push(`Generated ${path.relative(config.cwd, outFile)}`);
    }
  }

  const sourceMetadataPath = path.join(config.stateDir, 'state', '.sources.json');
  const sourceMetadata = await readJsonState(sourceMetadataPath, { resources: {} });
  sourceMetadata.resources ??= {};

  const runtime = createRuntime(config, project.resources);
  await runtime.hydrate();
  await writeSourceMetadata(config, project.resources, sourceMetadata);
  await writeJsonState(sourceMetadataPath, sourceMetadata);

  logs.push('Synced runtime store');

  return {
    ...project,
    logs,
  };
}

async function preserveGeneratedAt(schemaOutFile, schema) {
  let previous;
  try {
    previous = JSON.parse(await readFile(schemaOutFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      return schema;
    }
    throw error;
  }

  if (isObject(previous) && typeof previous.generatedAt === 'string' && sameGeneratedSchema(previous, schema)) {
    schema.generatedAt = previous.generatedAt;
  }

  return schema;
}

function sameGeneratedSchema(left, right) {
  return JSON.stringify({ ...left, generatedAt: null }) === JSON.stringify({ ...right, generatedAt: null });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
