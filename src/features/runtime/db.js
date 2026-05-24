import path from 'node:path';
import { loadConfig } from '../../config.js';
import { dbError, listChoices } from '../../errors.js';
import { resolveResource, resourceAliasCollisionGroups } from '../../names.js';
import { loadProjectSchema } from '../../schema.js';
import { syncDb } from '../../sync.js';
import { createRuntime } from '../storage/runtime.js';
import { DbCollection } from './collection.js';
import { DbDocument } from './document.js';

export async function openDb(options = {}) {
  const rawOptions = typeof options === 'string' ? { from: options } : options;
  const loadedSchema = loadedSchemaFromOptions(rawOptions);
  const config = await loadConfig(openOptionsForConfig(rawOptions, loadedSchema));
  const syncOnOpen = rawOptions.syncOnOpen ?? true;
  const project = syncOnOpen
    ? await syncDb(config, { allowErrors: rawOptions.allowSourceErrors === true })
    : await loadProjectSchema(config, { load: config.schemaLoadMode ?? 'runtime' });
  const db = new Db(config, project.resources, project.diagnostics);
  if (syncOnOpen) {
    await db.runtime.hydrate();
  }

  return db;
}

function loadedSchemaFromOptions(options) {
  return isLoadedDbSchema(options?.schema) ? options.schema : null;
}

function openOptionsForConfig(options, loadedSchema) {
  const next = loadedSchema
    ? optionsFromLoadedSchema(options, loadedSchema)
    : { ...options };

  next.load ??= 'runtime';
  return next;
}

function optionsFromLoadedSchema(options, loadedSchema) {
  const { schema: _loadedSchema, ...overrides } = options;
  const next = {
    ...(loadedSchema.config ?? {}),
    ...overrides,
  };

  next.from ??= locatorInputForLoadedSchema(loadedSchema);
  return next;
}

function locatorInputForLoadedSchema(loadedSchema) {
  const locator = loadedSchema.locator ?? loadedSchema.config?.schemaLocator;
  if (locator?.file) {
    return locator.file;
  }

  if (locator?.mode === 'source-dir' && locator.sourceDir) {
    return locator.sourceDir;
  }

  return locator?.cwd ?? loadedSchema.config?.cwd;
}

function isLoadedDbSchema(value) {
  return value?.kind === 'DbSchema' && value?.resources instanceof Map && value?.config;
}

export class Db {
  constructor(config, resources, diagnostics = []) {
    this.config = config;
    this.resources = new Map(resources.map((resource) => [resource.name, resource]));
    assertNoResourceAliasCollisions(this.resources);
    this.diagnostics = diagnostics;
    this.schemaVersion = Date.now();
    this.runtime = createRuntime(config, resources);
    this.events = this.runtime.events;
  }

  collection(name) {
    const resource = this.requireResource(name, 'collection');
    return new DbCollection(this, resource);
  }

  document(name) {
    const resource = this.requireResource(name, 'document');
    return new DbDocument(this, resource);
  }

  requireResource(name, kind) {
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

  resourceNames() {
    return [...this.resources.keys()];
  }

  close() {
    return this.runtime.close();
  }
}

export function stateFileForDebug(db, resourceName) {
  return path.join(db.config.stateDir, 'state', `${resourceName}.json`);
}

function assertNoResourceAliasCollisions(resources) {
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
