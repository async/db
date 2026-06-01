import { resolveResource } from '../../names.js';

const RELATION_SCALAR_FIELD_TYPES = new Set(['string', 'datetime', 'number', 'boolean', 'enum']);

type SchemaField = {
  type?: string;
  required?: boolean;
  relation?: RawRelationDefinition;
};

type RawRelationDefinition = {
  name?: string;
  to?: string;
  toField?: string;
  cardinality?: string;
};

type RelationDefinition = {
  name: string;
  sourceResource: string;
  sourceField: string;
  targetResource: string;
  targetField: string;
  cardinality: string;
};

type SchemaResource = {
  name: string;
  kind?: string;
  fields?: Record<string, SchemaField>;
  relations?: RelationDefinition[];
  seed?: Array<Record<string, unknown>>;
};

type SchemaDiagnostic = {
  code: string;
  severity: 'error' | 'warn';
  resource: string;
  field?: string;
  message: string;
  hint: string;
  details: unknown;
};

export function validateProjectRelations(resources: SchemaResource[]): SchemaDiagnostic[] {
  const diagnostics: SchemaDiagnostic[] = [];
  const resourceMap = new Map(resources.map((resource) => [resource.name, resource]));

  for (const resource of resources) {
    for (const relation of resource.relations ?? []) {
      const sourceField = resource.fields?.[relation.sourceField] ?? {};
      const sourceFieldDiagnostic = relationSourceFieldDiagnostic(resource, relation, sourceField);
      if (sourceFieldDiagnostic) {
        diagnostics.push(sourceFieldDiagnostic);
      }

      const target = resolveResource(resourceMap, relation.targetResource).resource;
      if (!target || target.kind !== 'collection') {
        diagnostics.push({
          code: 'SCHEMA_RELATION_TARGET_RESOURCE_MISSING',
          severity: 'error',
          resource: resource.name,
          field: relation.sourceField,
          message: `${resource.name} relation "${relation.name}" targets missing collection "${relation.targetResource}"`,
          hint: 'Add the target collection fixture or update the relation.to value.',
          details: relation,
        });
        continue;
      }

      if (!(relation.targetField in (target.fields ?? {}))) {
        diagnostics.push({
          code: 'SCHEMA_RELATION_TARGET_FIELD_MISSING',
          severity: 'error',
          resource: resource.name,
          field: relation.sourceField,
          message: `${resource.name} relation "${relation.name}" targets missing field "${relation.targetResource}.${relation.targetField}"`,
          hint: 'Use an existing target field, usually the target collection id field.',
          details: relation,
        });
        continue;
      }

      if (resource.kind !== 'collection') {
        continue;
      }

      if (sourceFieldDiagnostic) {
        continue;
      }

      const targetValues = new Set((Array.isArray(target.seed) ? target.seed : [])
        .map((record) => record?.[relation.targetField])
        .filter((value) => value !== undefined && value !== null && value !== '')
        .map((value) => String(value)));

      for (const [index, record] of resource.seed.entries()) {
        const value = record?.[relation.sourceField];
        if (value === undefined || value === null || value === '') {
          continue;
        }

        if (targetValues.has(String(value))) {
          continue;
        }

        diagnostics.push({
          code: 'SCHEMA_RELATION_TARGET_MISSING',
          severity: sourceField.required ? 'error' : 'warn',
          resource: resource.name,
          field: relation.sourceField,
          message: `${resource.name} seed record ${index} field "${relation.sourceField}" links to missing ${relation.targetResource}.${relation.targetField} "${value}"`,
          hint: `Add a matching ${relation.targetResource} record or update "${relation.sourceField}".`,
          details: {
            ...relation,
            value,
            recordIndex: index,
          },
        });
      }
    }
  }

  return diagnostics;
}

function relationSourceFieldDiagnostic(
  resource: SchemaResource,
  relation: RelationDefinition,
  sourceField: SchemaField,
): SchemaDiagnostic | null {
  const sourceFieldType = sourceField?.type ?? 'unknown';
  if (RELATION_SCALAR_FIELD_TYPES.has(sourceFieldType)) {
    return null;
  }

  return {
    code: 'SCHEMA_RELATION_SOURCE_FIELD_INVALID',
    severity: 'error',
    resource: resource.name,
    field: relation.sourceField,
    message: `${resource.name} relation "${relation.name}" source field "${relation.sourceField}" must be a scalar field, but found ${sourceFieldType}.`,
    hint: 'Use a scalar id field for to-one relation metadata, such as string, number, boolean, datetime, or enum.',
    details: {
      relation,
      sourceFieldType,
    },
  };
}

export function relationsForResource(resource: SchemaResource): RelationDefinition[] {
  if (resource.kind !== 'collection') {
    return [];
  }

  return Object.entries(resource.fields ?? {})
    .filter(([, field]) => field.relation)
    .map(([fieldName, field]) => {
      const relation = field.relation as RawRelationDefinition;
      return {
        name: relation.name as string,
        sourceResource: resource.name,
        sourceField: fieldName,
        targetResource: relation.to as string,
        targetField: relation.toField as string,
        cardinality: relation.cardinality as string,
      };
    });
}
