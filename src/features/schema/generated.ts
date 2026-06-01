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
  description?: unknown;
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
    description: resource.description,
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
    },
  };
}
