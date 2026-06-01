import path from 'node:path';
import { loadConfig } from '../../config.js';
import { dbError, listChoices } from '../../errors.js';
import { resolveResource, resourceAliasCollisionGroups } from '../../names.js';
import { loadProjectSchema } from '../../schema.js';
import { syncDb } from '../../sync.js';
import { createRuntime } from '../storage/runtime.js';
import { DbCollection } from './collection.js';
import { DbDocument } from './document.js';

type DbConfig = {
  cwd: string;
  stateDir: string;
  schemaLoadMode?: string;
  [key: string]: unknown;
};

type DbResource = {
  name: string;
  kind: 'collection' | 'document' | string;
  [key: string]: unknown;
};

type DbProject = {
  resources: DbResource[];
  diagnostics?: unknown[];
};

type LoadedDbSchema = {
  kind: 'DbSchema';
  resources: Map<string, DbResource>;
  config?: Partial<DbConfig> & Record<string, unknown>;
  locator?: {
    file?: string;
    mode?: string;
    sourceDir?: string;
    cwd?: string;
  };
};

type OpenDbOptions = Record<string, unknown> & {
  from?: string;
  schema?: unknown;
  syncOnOpen?: boolean;
  allowSourceErrors?: boolean;
  load?: string;
};

type RuntimeFacade = ReturnType<typeof createRuntime>;

export async function openDb(options: OpenDbOptions | string = {}): Promise<Db> {
  const rawOptions = typeof options === 'string' ? { from: options } : options;
  const loadedSchema = loadedSchemaFromOptions(rawOptions);
  const config = await loadConfig(openOptionsForConfig(rawOptions, loadedSchema) as Parameters<typeof loadConfig>[0]) as DbConfig;
  const syncOnOpen = rawOptions.syncOnOpen ?? true;
  const project = (syncOnOpen
    ? await syncDb(config, { allowErrors: rawOptions.allowSourceErrors === true })
    : await loadProjectSchema(config, { load: config.schemaLoadMode ?? 'runtime' })) as DbProject;
  const db = new Db(config, project.resources, project.diagnostics);
  if (syncOnOpen) {
    await db.runtime.hydrate();
  }

  return db;
}

function loadedSchemaFromOptions(options: OpenDbOptions): LoadedDbSchema | null {
  return isLoadedDbSchema(options?.schema) ? options.schema : null;
}

function openOptionsForConfig(options: OpenDbOptions, loadedSchema: LoadedDbSchema | null): OpenDbOptions {
  const next = loadedSchema
    ? optionsFromLoadedSchema(options, loadedSchema)
    : { ...options };

  next.load ??= 'runtime';
  return next;
}

function optionsFromLoadedSchema(options: OpenDbOptions, loadedSchema: LoadedDbSchema): OpenDbOptions {
  const { schema: _loadedSchema, ...overrides } = options;
  const next = {
    ...(loadedSchema.config ?? {}),
    ...overrides,
  };

  next.from ??= locatorInputForLoadedSchema(loadedSchema);
  return next;
}

function locatorInputForLoadedSchema(loadedSchema: LoadedDbSchema): string | undefined {
  const locator = loadedSchema.locator ?? loadedSchema.config?.schemaLocator as LoadedDbSchema['locator'] | undefined;
  if (locator?.file) {
    return locator.file;
  }

  if (locator?.mode === 'source-dir' && locator.sourceDir) {
    return locator.sourceDir;
  }

  return locator?.cwd ?? loadedSchema.config?.cwd;
}

function isLoadedDbSchema(value: unknown): value is LoadedDbSchema {
  const candidate = value as Partial<LoadedDbSchema> | null | undefined;
  return candidate?.kind === 'DbSchema' && candidate?.resources instanceof Map && Boolean(candidate?.config);
}

export class Db {
  config: DbConfig;
  resources: Map<string, DbResource>;
  diagnostics: unknown[];
  schemaVersion: number;
  runtime: RuntimeFacade;
  events: RuntimeFacade['events'];

  constructor(config: DbConfig, resources: DbResource[], diagnostics: unknown[] = []) {
    this.config = config;
    this.resources = new Map(resources.map((resource) => [resource.name, resource]));
    assertNoResourceAliasCollisions(this.resources);
    this.diagnostics = diagnostics;
    this.schemaVersion = Date.now();
    this.runtime = createRuntime(config, resources);
    this.events = this.runtime.events;
  }

  collection(name: string): DbCollection {
    const resource = this.requireResource(name, 'collection');
    return new DbCollection(this, resource);
  }

  document(name: string): DbDocument {
    const resource = this.requireResource(name, 'document');
    return new DbDocument(this, resource);
  }

  requireResource(name: string, kind: 'collection' | 'document'): DbResource {
    const { resource, candidates } = resolveResource(this.resources, name);
    if (!resource) {
      throw dbError(
        'DB_UNKNOWN_RESOURCE',
        `Unknown db resource "${name}".`,
        {
          status: 404,
          hint: `Use one of: ${listChoices(this.resourceNames())}.`,
          details: {
            resource: name,
            requestedResource: name,
            normalizedCandidates: candidates,
            availableResources: this.resourceNames(),
          },
        },
      );
    }

    if (resource.kind !== kind) {
      throw dbError(
        'DB_RESOURCE_KIND_MISMATCH',
        `Resource "${name}" is a ${resource.kind}, not a ${kind}.`,
        {
          status: 400,
          hint: resource.kind === 'collection'
            ? `Use db.collection("${name}") for this resource.`
            : `Use db.document("${name}") for this resource.`,
          details: {
            resource: name,
            expectedKind: kind,
            actualKind: resource.kind,
          },
        },
      );
    }

    return resource;
  }

  resourceNames(): string[] {
    return [...this.resources.keys()];
  }

  close(): Promise<void> {
    return this.runtime.close();
  }
}

export function stateFileForDebug(db: Db, resourceName: string): string {
  return path.join(db.config.stateDir, 'state', `${resourceName}.json`);
}

function assertNoResourceAliasCollisions(resources: Map<string, DbResource>): void {
  const collisions = resourceAliasCollisionGroups(resources);
  if (collisions.length === 0) {
    return;
  }

  const collision = collisions[0];
  throw dbError(
    'DB_RESOURCE_ALIAS_COLLISION',
    `Resource aliases are ambiguous for "${collision.alias}".`,
    {
      status: 400,
      hint: 'Rename one resource so its camelCase and kebab-case aliases are unique.',
      details: {
        alias: collision.alias,
        aliases: collision.aliases,
        resources: collision.resources,
        candidates: collision.candidates,
        collisions,
      },
    },
  );
}
