import { buildResource } from './resource.js';
import { duplicateResourceDiagnostics, listSourceFiles, readSourceFile, trackResourceSource } from './sources.js';
import { makeGeneratedSchema } from './generated.js';
import { resourceAliasCollisionGroups } from '../../names.js';
import { validateProjectRelations } from './relations.js';
import { validateResourceSeed } from './validation.js';

export async function loadProjectSchema(config) {
  const files = await listSourceFiles(config.sourceDir);
  const dataFiles = new Map();
  const schemaFiles = new Map();
  const resourceSources = new Map();
  const diagnostics = [];

  for (const filename of files) {
    const result = await readSourceFile(config, filename);
    diagnostics.push(...result.diagnostics);

    for (const source of result.sources) {
      trackResourceSource(resourceSources, source.name, source.file, source.kind);
      if (source.kind === 'schema') {
        schemaFiles.set(source.name, source);
      } else {
        dataFiles.set(source.name, source);
      }
    }
  }

  const resourceNames = [...new Set([...dataFiles.keys(), ...schemaFiles.keys()])].sort();
  const resources = [];
  diagnostics.push(...duplicateResourceDiagnostics(resourceSources));

  for (const name of resourceNames) {
    const dataSource = dataFiles.get(name);
    const schemaSource = schemaFiles.get(name);
    const rawData = dataSource?.data;
    const rawSchema = schemaSource?.schema;

    if (rawData === undefined && rawSchema === undefined) {
      continue;
    }

    if (rawData !== undefined && rawSchema && Object.prototype.hasOwnProperty.call(rawSchema, 'seed')) {
      diagnostics.push(mixedModeSchemaSeedDiagnostic(name, dataSource, schemaSource));
    }

    const resource = buildResource({
      name,
      dataPath: dataSource?.sourceFile,
      dataFormat: dataSource?.format,
      dataHash: dataSource?.hash,
      schemaPath: schemaSource?.sourceFile,
      schemaSource: schemaSource?.format,
      rawData,
      rawSchema,
      config,
    });

    diagnostics.push(...validateResourceSeed(resource, config));
    resources.push(resource);
  }

  diagnostics.push(...validateProjectRelations(resources));
  diagnostics.push(...resourceAliasCollisionDiagnostics(resources));

  return {
    resources,
    diagnostics,
    schema: makeGeneratedSchema(resources, diagnostics),
  };
}

function mixedModeSchemaSeedDiagnostic(resource, dataSource, schemaSource) {
  return {
    code: 'SCHEMA_SEED_IGNORED_IN_MIXED_MODE',
    severity: 'warn',
    resource,
    file: schemaSource.file,
    message: `${schemaSource.file} includes seed records, but ${dataSource.file} provides seed data for "${resource}".`,
    hint: `Remove "seed" from ${schemaSource.file}, or run async-db schema unbundle ${resource} to keep seed data in a separate fixture.`,
    details: {
      resource,
      schemaFile: schemaSource.file,
      dataFile: dataSource.file,
    },
  };
}

function resourceAliasCollisionDiagnostics(resources) {
  return resourceAliasCollisionGroups(resources).map((collision) => ({
    code: 'RESOURCE_ALIAS_COLLISION',
    severity: 'error',
    message: `Resource aliases are ambiguous for "${collision.alias}": ${collision.resources.map((resource) => `"${resource}"`).join(' and ')} both resolve through ${collision.aliases.map((alias) => `"${alias}"`).join(', ')}.`,
    hint: 'Rename one fixture or customize resource names so every camelCase and kebab-case alias maps to one resource.',
    details: {
      alias: collision.alias,
      aliases: collision.aliases,
      resources: collision.resources,
      candidates: collision.candidates,
    },
  }));
}
