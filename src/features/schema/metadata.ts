export type SchemaField = {
  type?: string;
  required?: boolean;
  description?: string;
  [key: string]: unknown;
};

export type SchemaResource = {
  kind?: 'collection' | 'document' | string;
  name: string;
  typeName: string;
  routePath: string;
  idField?: string;
  identity?: {
    fields?: string[];
  };
  fields: Record<string, SchemaField>;
  [key: string]: unknown;
};

export type SchemaDiagnostic = {
  code?: string;
  severity?: string;
  message?: string;
  [key: string]: unknown;
};

export type GeneratedSchemaMetadataContext = {
  resources: SchemaResource[];
  diagnostics: SchemaDiagnostic[];
};

export type GeneratedSchemaMetadataContributor = (
  context: GeneratedSchemaMetadataContext,
) => Record<string, unknown> | null | undefined;

export function generatedSchemaMetadata(
  resources: SchemaResource[],
  diagnostics: SchemaDiagnostic[],
  contributors: GeneratedSchemaMetadataContributor[] = defaultGeneratedSchemaMetadataContributors(),
): Record<string, unknown> {
  return Object.assign(
    {},
    ...contributors.map((contributor) => contributor({ resources, diagnostics }) ?? {}),
  );
}

export function defaultGeneratedSchemaMetadataContributors(): GeneratedSchemaMetadataContributor[] {
  return [
    restSchemaMetadata,
    graphqlSchemaMetadata,
  ];
}

export function restSchemaMetadata({ resources }: GeneratedSchemaMetadataContext): Record<string, unknown> {
  return {
    rest: Object.fromEntries(resources.map((resource) => [resource.name, restRoutes(resource)])),
  };
}

export function graphqlSchemaMetadata({ resources }: GeneratedSchemaMetadataContext): Record<string, unknown> {
  return {
    graphql: generateGraphqlSdl(resources),
  };
}

function restRoutes(resource: SchemaResource): string[] {
  if (resource.kind === 'document') {
    return [
      `GET ${resource.routePath}`,
      `PUT ${resource.routePath}`,
      `PATCH ${resource.routePath}`,
    ];
  }

  const idField = singleIdField(resource);
  return idField
    ? [
      `GET ${resource.routePath}`,
      `GET ${resource.routePath}/:${idField}`,
      `POST ${resource.routePath}`,
      `PATCH ${resource.routePath}/:${idField}`,
      `DELETE ${resource.routePath}/:${idField}`,
    ]
    : [
      `GET ${resource.routePath}`,
      `GET ${resource.routePath}/__key?<identity>`,
      `POST ${resource.routePath}`,
      `PATCH ${resource.routePath}/__key`,
      `DELETE ${resource.routePath}/__key`,
    ];
}

function generateGraphqlSdl(resources: SchemaResource[]): string {
  const lines = ['scalar JSON', ''];

  for (const resource of resources) {
    if (resource.kind === 'collection' && !singleIdField(resource)) {
      lines.push(...graphqlKeyInput(resource), '');
    }
    lines.push(...graphqlType(resource), '');
  }

  return lines.join('\n').trimEnd();
}

function graphqlKeyInput(resource: SchemaResource): string[] {
  const lines = [`input ${resource.typeName}KeyInput {`];
  for (const field of identityFields(resource)) {
    lines.push(`  ${field}: ${graphqlFieldType(resource.fields[field] ?? { type: 'string', required: true }, true)}`);
  }
  lines.push('}');
  return lines;
}

function graphqlType(resource: SchemaResource): string[] {
  const lines = [`type ${resource.typeName} {`];
  for (const [fieldName, field] of Object.entries(resource.fields)) {
    if (field.description) {
      lines.push(`  "${String(field.description).replaceAll('"', '\\"')}"`);
    }
    lines.push(`  ${fieldName}: ${graphqlFieldType(field, fieldName === resource.idField)}`);
  }
  lines.push('}');
  return lines;
}

function identityFields(resource: SchemaResource): string[] {
  const fields = Array.isArray(resource.identity?.fields)
    ? resource.identity.fields.map(String).filter(Boolean)
    : [];
  return fields.length > 0 ? fields : [String(resource.idField ?? 'id')];
}

function singleIdField(resource: SchemaResource): string | null {
  const fields = identityFields(resource);
  return fields.length === 1 ? fields[0] ?? null : null;
}

function graphqlFieldType(field: SchemaField, isIdField = false): string {
  if (isIdField) {
    return field.required ? 'ID!' : 'ID';
  }

  const suffix = field.required ? '!' : '';
  switch (field.type) {
    case 'string':
    case 'datetime':
    case 'bytes':
    case 'enum':
      return `String${suffix}`;
    case 'number':
      return `Float${suffix}`;
    case 'boolean':
      return `Boolean${suffix}`;
    case 'array':
      return `[JSON]${suffix}`;
    case 'object':
    case 'unknown':
    default:
      return `JSON${suffix}`;
  }
}
