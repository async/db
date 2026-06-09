type SchemaField = {
  type?: string;
  required?: boolean;
  nullable?: boolean;
  values?: unknown[];
  items?: SchemaField;
  fields?: Record<string, SchemaField>;
  [key: string]: unknown;
};

type SchemaResource = {
  name: string;
  kind: string;
  idField?: string;
  schemaPath?: string | null;
  dataPath?: string | null;
  typeSource?: string;
  description?: string;
  fields?: Record<string, SchemaField>;
  seed?: unknown;
};

type SchemaProject = {
  resources: SchemaResource[];
};

type DoctorFinding = {
  code: string;
  severity: 'info';
  source: 'doctor';
  resource: string;
  field?: string;
  message: string;
  hint: string;
  details: Record<string, unknown>;
};

export function schemaGuidanceFindings(project: SchemaProject, inferredProject: SchemaProject): DoctorFinding[] {
  return [
    ...schemaRecommendedFindings(project.resources),
    ...schemaMatchesInferenceFindings(project.resources, inferredProject.resources),
  ];
}

function schemaRecommendedFindings(resources: SchemaResource[]): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const seen = new Set<string>();

  for (const resource of resources) {
    if (resource.schemaPath || resource.typeSource !== 'data') {
      continue;
    }

    for (const fieldPath of ambiguousPolymorphicArrayPaths(resource.seed, resource.kind)) {
      const key = `${resource.name}:${fieldPath}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      findings.push({
        code: 'DOCTOR_SCHEMA_RECOMMENDED',
        severity: 'info',
        source: 'doctor',
        resource: resource.name,
        field: fieldPath,
        message: `${resource.name}.${fieldPath} has polymorphic array data that db cannot infer confidently.`,
        hint: `Run async-db schema infer ${resource.name} --out db/${resource.name}.schema.jsonc to lock the current inferred shape into an explicit schema.`,
        details: {
          resource: resource.name,
          field: fieldPath,
        },
      });
    }
  }

  return findings;
}

function schemaMatchesInferenceFindings(resources: SchemaResource[], inferredResources: SchemaResource[]): DoctorFinding[] {
  const inferredByName = new Map(inferredResources.map((resource) => [resource.name, resource]));
  const findings: DoctorFinding[] = [];

  for (const resource of resources) {
    if (!resource.schemaPath || !resource.dataPath || hasNonInferableContractValue(resource)) {
      continue;
    }

    const inferred = inferredByName.get(resource.name);
    if (!inferred) {
      continue;
    }

    if (JSON.stringify(comparableResource(resource)) !== JSON.stringify(comparableResource(inferred))) {
      continue;
    }

    findings.push({
      code: 'DOCTOR_SCHEMA_MATCHES_INFERENCE',
      severity: 'info',
      source: 'doctor',
      resource: resource.name,
      message: `${resource.name} schema matches inferred data and may be removable.`,
      hint: 'Keep the schema if you want it as an explicit contract; otherwise the data file can infer the same local shape.',
      details: {
        resource: resource.name,
      },
    });
  }

  return findings;
}

function ambiguousPolymorphicArrayPaths(seed: unknown, kind: string): string[] {
  const roots = kind === 'collection' && Array.isArray(seed)
    ? seed
    : [seed];
  const paths: string[] = [];

  for (const root of roots) {
    collectAmbiguousArrayPaths(root, '', paths);
  }

  return paths;
}

function collectAmbiguousArrayPaths(value: unknown, path: string, paths: string[]): void {
  if (Array.isArray(value)) {
    if (isAmbiguousPolymorphicArray(value) && path) {
      paths.push(path);
      return;
    }

    for (const item of value) {
      collectAmbiguousArrayPaths(item, path, paths);
    }
    return;
  }

  if (!isPlainRecord(value)) {
    return;
  }

  for (const [fieldName, childValue] of Object.entries(value)) {
    collectAmbiguousArrayPaths(childValue, path ? `${path}.${fieldName}` : fieldName, paths);
  }
}

function isAmbiguousPolymorphicArray(value: unknown[]): boolean {
  const records = value.filter((item): item is Record<string, unknown> => item !== null && item !== undefined && isPlainRecord(item));
  if (records.length < 2 || records.length !== value.filter((item) => item !== null && item !== undefined).length) {
    return false;
  }

  const signatures = new Set(records.map((record) => Object.keys(record).sort().join('|')));
  return signatures.size > 1 && !hasStableDiscriminator(records);
}

function hasStableDiscriminator(records: Record<string, unknown>[]): boolean {
  return ['type', 'kind', 'blockType'].some((fieldName) => {
    const values = records.map((record) => record[fieldName]);
    return values.every((value) => typeof value === 'string' && value !== '')
      && new Set(values).size >= 2;
  });
}

function hasNonInferableContractValue(resource: SchemaResource): boolean {
  if (resource.description) {
    return true;
  }

  return Object.values(resource.fields ?? {}).some((field) => fieldHasNonInferableContractValue(field));
}

function fieldHasNonInferableContractValue(field: SchemaField): boolean {
  for (const property of [
    'description',
    'default',
    'unique',
    'relation',
    'min',
    'max',
    'minLength',
    'maxLength',
    'pattern',
    'additionalProperties',
    'variants',
  ]) {
    if (property in field) {
      return true;
    }
  }

  if (field.type === 'array') {
    return fieldHasNonInferableContractValue(field.items ?? { type: 'unknown' });
  }

  if (field.type === 'object') {
    return Object.values(field.fields ?? {}).some((childField) => fieldHasNonInferableContractValue(childField));
  }

  return false;
}

function comparableResource(resource: SchemaResource): unknown {
  const comparable: Record<string, unknown> = {
    kind: resource.kind,
    fields: comparableFieldMap(resource.fields ?? {}),
  };

  if (resource.kind === 'collection') {
    comparable.idField = resource.idField;
  }

  return sortObject(comparable);
}

function comparableFieldMap(fields: Record<string, SchemaField>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fieldName, field]) => [fieldName, comparableField(field)]),
  );
}

function comparableField(field: SchemaField): unknown {
  const comparable: Record<string, unknown> = {
    type: field.type ?? 'unknown',
    required: Boolean(field.required),
  };

  if ('nullable' in field) {
    comparable.nullable = Boolean(field.nullable);
  }

  if (field.type === 'enum') {
    comparable.values = [...(field.values ?? [])];
  }

  if (field.type === 'array') {
    comparable.items = comparableField(field.items ?? { type: 'unknown' });
  }

  if (field.type === 'object') {
    comparable.fields = comparableFieldMap(field.fields ?? {});
  }

  return sortObject(comparable);
}

function sortObject(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, childValue]) => [key, sortObject(childValue)]),
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
