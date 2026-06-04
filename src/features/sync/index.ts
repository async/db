import path from 'node:path';
import { loadProjectSchema, makeGeneratedSchema } from '../../schema.js';
import { generateSchemaManifest } from '../../schema-manifest.js';
import { generateTypes } from '../../types.js';
import { generateViewerManifest } from '../../viewer-manifest.js';
import { readJsonState, writeJsonState } from '../runtime/state.js';
import { createRuntime } from '../storage/runtime.js';
import { writeSourceMetadata } from '../storage/source.js';
import { writeText } from '../../fs-utils.js';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';
import { ensureRuntimeDirs } from './runtime-dirs.js';
import { writeGeneratedIdsToSources } from './source-writes.js';

export { applyDefaultsToRecord, applyDefaultsToSeed } from './defaults.js';

type SyncConfig = {
  cwd: string;
  stateDir: string;
  fs?: DbFileSystem;
  types?: {
    enabled?: boolean;
  };
  schemaOutFile?: string | null;
  viewerManifestOutFile?: string | null;
  [key: string]: unknown;
};

type SyncDiagnostic = {
  code?: string;
  severity?: string;
  message: string;
  [key: string]: unknown;
};

type SyncResource = {
  name: string;
  schemaPath?: string | null;
  dataPath?: string | null;
  [key: string]: unknown;
};

type SyncProject = {
  resources: SyncResource[];
  diagnostics: SyncDiagnostic[];
  schema?: Record<string, unknown>;
  [key: string]: unknown;
};

type SyncOptions = {
  allowErrors?: boolean;
};

type GeneratedSchema = Record<string, unknown> & {
  generatedAt?: string;
};

type SourceMetadata = {
  resources: Record<string, unknown>;
};

export async function syncDb(config: SyncConfig, options: SyncOptions = {}): Promise<SyncProject & { logs: string[] }> {
  const project = await loadProjectSchema(config) as SyncProject;
  const logs: string[] = [];
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const fatalErrors = errors.filter((diagnostic) => diagnostic.code === 'RESOURCE_ALIAS_COLLISION');

  for (const resource of project.resources) {
    logs.push(`Loaded ${path.relative(config.cwd, String(resource.schemaPath ?? resource.dataPath ?? ''))}`);
  }

  if (fatalErrors.length > 0 || (errors.length > 0 && options.allowErrors !== true)) {
    const error = new Error(errors.map((diagnostic) => diagnostic.message).join('\n')) as Error & {
      diagnostics?: SyncDiagnostic[];
    };
    error.diagnostics = project.diagnostics;
    throw error;
  }

  await writeGeneratedIdsToSources(config, project.resources, logs);

  await ensureRuntimeDirs(config);
  const schemaOutFile = path.join(config.stateDir, 'schema.generated.json');
  project.schema = await preserveGeneratedAt(
    config,
    schemaOutFile,
    makeGeneratedSchema(project.resources as Parameters<typeof makeGeneratedSchema>[0], project.diagnostics) as GeneratedSchema,
  );

  await writeText(schemaOutFile, `${JSON.stringify(project.schema, null, 2)}\n`, dbFileSystem(config));
  logs.push(`Generated ${path.relative(config.cwd, schemaOutFile)}`);

  if (config.types?.enabled !== false) {
    const result = await generateTypes(config, { project });
    for (const outFile of result.outFiles) {
      logs.push(`Generated ${path.relative(config.cwd, String(outFile))}`);
    }
  }

  if (config.schemaOutFile) {
    const result = await generateSchemaManifest(config, { project });
    for (const outFile of result.outFiles) {
      logs.push(`Generated ${path.relative(config.cwd, String(outFile))}`);
    }
  }

  if (config.viewerManifestOutFile) {
    const result = await generateViewerManifest(config, { project });
    for (const outFile of result.outFiles) {
      logs.push(`Generated ${path.relative(config.cwd, String(outFile))}`);
    }
  }

  const sourceMetadataPath = path.join(config.stateDir, 'state', '.sources.json');
  const sourceMetadata = await readJsonState(sourceMetadataPath, { resources: {} }, dbFileSystem(config)) as SourceMetadata;
  sourceMetadata.resources ??= {};

  const runtime = createRuntime(config, project.resources);
  await runtime.hydrate();
  await writeSourceMetadata(config, project.resources, sourceMetadata);
  await writeJsonState(sourceMetadataPath, sourceMetadata, dbFileSystem(config));

  logs.push('Synced runtime store');

  return {
    ...project,
    logs,
  };
}

async function preserveGeneratedAt(config: SyncConfig, schemaOutFile: string, schema: GeneratedSchema): Promise<GeneratedSchema> {
  let previous: unknown;
  try {
    previous = JSON.parse(await dbFileSystem(config).readFile(schemaOutFile, 'utf8') as string);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
      return schema;
    }
    throw error;
  }

  if (isObject(previous) && typeof previous.generatedAt === 'string' && sameGeneratedSchema(previous, schema)) {
    schema.generatedAt = previous.generatedAt;
  }

  return schema;
}

function sameGeneratedSchema(left: GeneratedSchema, right: GeneratedSchema): boolean {
  return JSON.stringify({ ...left, generatedAt: null }) === JSON.stringify({ ...right, generatedAt: null });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
