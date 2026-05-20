export function schemaGuidanceFindings(project, inferredProject) {
  return [
    ...schemaRecommendedFindings(project.resources),
    ...schemaMatchesInferenceFindings(project.resources, inferredProject.resources),
  ];
}

function schemaRecommendedFindings(resources) {
  const findings = [];
  const seen = new Set();

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

function schemaMatchesInferenceFindings(resources, inferredResources) {
  const inferredByName = new Map(inferredResources.map((resource) => [resource.name, resource]));
  const findings = [];

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
      hint: 'Keep the schema if you want it as an explicit contract; otherwise the data fixture can infer the same local shape.',
      details: {
        resource: resource.name,
      },
    });
  }

  return findings;
}

function ambiguousPolymorphicArrayPaths(seed, kind) {
  const roots = kind === 'collection' && Array.isArray(seed)
    ? seed
    : [seed];
  const paths = [];

  for (const root of roots) {
    collectAmbiguousArrayPaths(root, '', paths);
  }

  return paths;
}

function collectAmbiguousArrayPaths(value, path, paths) {
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

function isAmbiguousPolymorphicArray(value) {
  const records = value.filter((item) => item !== null && item !== undefined);
  if (records.length < 2 || records.some((item) => !isPlainRecord(item))) {
    return false;
  }

  const signatures = new Set(records.map((record) => Object.keys(record).sort().join('|')));
  return signatures.size > 1 && !hasStableDiscriminator(records);
}

function hasStableDiscriminator(records) {
  return ['type', 'kind', 'blockType'].some((fieldName) => {
    const values = records.map((record) => record[fieldName]);
    return values.every((value) => typeof value === 'string' && value !== '')
      && new Set(values).size >= 2;
  });
}

function hasNonInferableContractValue(resource) {
  if (resource.description) {
    return true;
  }

  return Object.values(resource.fields ?? {}).some((field) => fieldHasNonInferableContractValue(field));
}

function fieldHasNonInferableContractValue(field) {
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

function comparableResource(resource) {
  const comparable = {
    kind: resource.kind,
    fields: comparableFieldMap(resource.fields ?? {}),
  };

  if (resource.kind === 'collection') {
    comparable.idField = resource.idField;
  }

  return sortObject(comparable);
}

function comparableFieldMap(fields) {
  return Object.fromEntries(
    Object.entries(fields)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fieldName, field]) => [fieldName, comparableField(field)]),
  );
}

function comparableField(field) {
  const comparable = {
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

function sortObject(value) {
  if (!isPlainRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, childValue]) => [key, sortObject(childValue)]),
  );
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
