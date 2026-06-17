import {
  defaultGeneratedSchemaMetadataContributors,
  generatedSchemaMetadata,
  type SchemaDiagnostic,
  type SchemaResource,
} from './metadata.js';

type GeneratedSchemaResource = {
  kind?: string;
  typeName: string;
  routePath: string;
  idField?: string;
  identity?: unknown;
  description?: unknown;
  writePolicy?: unknown;
  log?: unknown;
  fields?: unknown;
  relations?: unknown;
  seed?: unknown;
  source: {
    typeSource?: unknown;
    dataPath?: unknown;
    dataFormat?: unknown;
    dataHash?: unknown;
    schemaPath?: unknown;
    generatedIds?: unknown;
    definition?: unknown;
  };
};

export function makeGeneratedSchema(resources: SchemaResource[], diagnostics: SchemaDiagnostic[] = []) {
  const metadata = generatedSchemaMetadata(resources, diagnostics, defaultGeneratedSchemaMetadataContributors());

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    resources: Object.fromEntries(resources.map((resource) => [resource.name, serializeResource(resource)])),
    relations: resources.flatMap((resource) => resource.relations ?? []),
    ...metadata,
    diagnostics,
  };
}

function serializeResource(resource: SchemaResource): GeneratedSchemaResource {
  return {
    kind: resource.kind,
    typeName: resource.typeName,
    routePath: resource.routePath,
    idField: resource.kind === 'collection' ? resource.idField : undefined,
    identity: resource.kind === 'collection' ? resource.identity : undefined,
    description: resource.description,
    writePolicy: resource.writePolicy,
    log: resource.log,
    fields: Object.keys(resource.fields ?? {}).length > 0 ? resource.fields : undefined,
    relations: resource.relations,
    seed: resource.seed,
    source: {
      typeSource: resource.typeSource,
      dataPath: resource.dataPath,
      dataFormat: resource.dataFormat,
      dataHash: resource.dataHash,
      schemaPath: resource.schemaPath,
      generatedIds: resource.generatedIds,
      definition: safeResourceSource(resource.source),
    },
  };
}

function safeResourceSource(source: unknown): unknown {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return undefined;
  }
  const record = source as Record<string, unknown>;
  if (record.kind === 'git-files') {
    return {
      kind: 'git-files',
      shape: record.shape,
      remote: record.remote,
      patterns: Array.isArray(record.patterns) ? [...record.patterns] : undefined,
      read: record.read,
      bodyField: record.bodyField,
      idField: record.idField,
      allowJsoncWrites: record.allowJsoncWrites === true ? true : undefined,
    };
  }
  if (record.kind === 'files') {
    return {
      kind: 'files',
      patterns: Array.isArray(record.patterns) ? [...record.patterns] : undefined,
      read: record.read,
      components: Array.isArray(record.components) ? [...record.components] : undefined,
    };
  }
  return undefined;
}
