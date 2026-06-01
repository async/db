type DoctorRelation = {
  sourceField: string;
};

type DoctorResource = {
  name: string;
  idField: string;
  fields?: Record<string, unknown>;
  relations?: DoctorRelation[];
  seed: Array<Record<string, unknown>>;
};

type DoctorFinding = {
  code: string;
  severity: 'warn' | 'info';
  source: 'doctor';
  resource: string;
  field: string;
  message: string;
  hint: string;
  details: Record<string, unknown>;
};

export function relationSuggestionFindings(collections: DoctorResource[]): DoctorFinding[] {
  const findings: DoctorFinding[] = [];

  for (const source of collections) {
    const explicitRelationFields = new Set((source.relations ?? []).map((relation) => relation.sourceField));
    for (const fieldName of Object.keys(source.fields ?? {})) {
      if (fieldName === source.idField || explicitRelationFields.has(fieldName) || !fieldName.endsWith('Id')) {
        continue;
      }

      const relationName = fieldName.slice(0, -2);
      const target = collections.find((candidate) => candidate.name !== source.name && relationNameMatchesResource(relationName, candidate.name));
      if (!target) {
        continue;
      }

      const sourceValues = source.seed
        .map((record) => record?.[fieldName])
        .filter((value) => !isEmpty(value));
      if (sourceValues.length === 0) {
        continue;
      }

      const targetValues = new Set(target.seed
        .map((record) => record?.[target.idField])
        .filter((value) => !isEmpty(value))
        .map((value) => String(value)));
      const matchingValues = sourceValues
        .filter((value) => targetValues.has(String(value)));
      const missingValues = [...new Set(sourceValues
        .filter((value) => !targetValues.has(String(value)))
        .map((value) => String(value)))];
      const matchingCount = matchingValues.length;
      if (matchingCount === 0) {
        continue;
      }

      const suggestedRelation = {
        name: relationName,
        to: target.name,
        toField: target.idField,
        cardinality: 'one',
      };

      if (missingValues.length > 0) {
        findings.push({
          code: 'DOCTOR_RELATION_MISSING_TARGET_VALUES',
          severity: 'warn',
          source: 'doctor',
          resource: source.name,
          field: fieldName,
          message: `${source.name}.${fieldName} looks related to ${target.name}.${target.idField}, but ${missingValues.length} value(s) are missing from ${target.name}.`,
          hint: `Add matching ${target.name} records, fix ${source.name}.${fieldName}, or ignore this if the field is not a relation.`,
          details: {
            suggestedRelation,
            missingValues,
            matchingCount,
          },
        });
        continue;
      }

      findings.push({
        code: 'DOCTOR_RELATION_SUGGESTION',
        severity: 'info',
        source: 'doctor',
        resource: source.name,
        field: fieldName,
        message: `Possible relation detected: ${source.name}.${fieldName} -> ${target.name}.${target.idField}.`,
        hint: `Add relation metadata to ${source.name}.schema.json to enable ?expand=${relationName}.`,
        details: {
          suggestedRelation,
          matchingCount,
        },
      });
    }
  }

  return findings;
}

function relationNameMatchesResource(relationName: string, resourceName: string): boolean {
  const normalizedRelation = relationName.toLowerCase();
  return resourceNameVariants(resourceName).has(normalizedRelation);
}

function resourceNameVariants(resourceName: string): Set<string> {
  const normalized = resourceName.toLowerCase();
  const variants = new Set([normalized]);
  if (normalized.endsWith('ies') && normalized.length > 3) {
    variants.add(`${normalized.slice(0, -3)}y`);
  }
  if (normalized.endsWith('s') && normalized.length > 1) {
    variants.add(normalized.slice(0, -1));
  }
  return variants;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}
