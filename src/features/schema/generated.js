import { defaultGeneratedSchemaMetadataContributors, generatedSchemaMetadata } from './metadata.js';

export function makeGeneratedSchema(resources, diagnostics = []) {
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

function serializeResource(resource) {
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
