import path from 'node:path';
import { loadConfig } from '../../config.js';
import { jsonDbError, listChoices } from '../../errors.js';
import { resolveResource, resourceAliasCollisionGroups } from '../../names.js';
import { loadProjectSchema } from '../../schema.js';
import { syncJsonFixtureDb } from '../../sync.js';
import { createRuntime } from '../storage/runtime.js';
import { JsonDbCollection } from './collection.js';
import { JsonDbDocument } from './document.js';

export async function openJsonFixtureDb(options = {}) {
  const config = await loadConfig(options);
  const syncOnOpen = options.syncOnOpen ?? true;
  const project = syncOnOpen
    ? await syncJsonFixtureDb(config, { allowErrors: options.allowSourceErrors === true })
    : await loadProjectSchema(config);
  const db = new JsonFixtureDb(config, project.resources, project.diagnostics);
  if (syncOnOpen) {
    await db.runtime.hydrate();
  }

  return db;
}

export class JsonFixtureDb {
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
    return new JsonDbCollection(this, resource);
  }

  document(name) {
    const resource = this.requireResource(name, 'document');
    return new JsonDbDocument(this, resource);
  }

  requireResource(name, kind) {
    const { resource, candidates } = resolveResource(this.resources, name);
    if (!resource) {
      throw jsonDbError(
        'DB_UNKNOWN_RESOURCE',
        `Unknown jsondb resource "${name}".`,
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
      throw jsonDbError(
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
  throw jsonDbError(
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
