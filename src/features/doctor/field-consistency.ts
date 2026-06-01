type DoctorResource = {
  name: string;
  idField: string;
  seed: unknown[];
};

type DoctorFinding = {
  code: string;
  severity: 'warn';
  source: 'doctor';
  resource: string;
  field: string;
  message: string;
  hint: string;
  details: Record<string, unknown>;
};

export function inconsistentFieldTypeFindings(resource: DoctorResource): DoctorFinding[] {
  const fieldTypes = new Map<string, Map<string, number>>();

  for (const record of resource.seed) {
    if (!isPlainRecord(record)) {
      continue;
    }

    for (const [fieldName, value] of Object.entries(record)) {
      if (fieldName === resource.idField || isEmpty(value)) {
        continue;
      }

      const counts = fieldTypes.get(fieldName) ?? new Map();
      counts.set(valueKind(value), (counts.get(valueKind(value)) ?? 0) + 1);
      fieldTypes.set(fieldName, counts);
    }
  }

  return [...fieldTypes.entries()]
    .filter(([, counts]) => counts.size > 1)
    .map(([fieldName, counts]) => ({
      code: 'DOCTOR_INCONSISTENT_FIELD_TYPES',
      severity: 'warn',
      source: 'doctor',
      resource: resource.name,
      field: fieldName,
      message: `${resource.name}.${fieldName} has inconsistent value types: ${describeCounts(counts)}.`,
      hint: `Normalize ${resource.name}.${fieldName} values or add a schema if the mixed shape is intentional.`,
      details: {
        types: Object.fromEntries(counts),
      },
    }));
}

function valueKind(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function describeCounts(counts: Map<string, number>): string {
  return [...counts.entries()].map(([kind, count]) => `${kind} (${count})`).join(', ');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}
