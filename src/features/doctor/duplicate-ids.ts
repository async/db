type DoctorResource = {
  name: string;
  idField: string;
  seed: Array<Record<string, unknown>>;
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

export function duplicateIdFindings(resource: DoctorResource): DoctorFinding[] {
  const seen = new Map<string, number>();
  const findings: DoctorFinding[] = [];

  for (const [index, record] of resource.seed.entries()) {
    const value = record?.[resource.idField];
    if (isEmpty(value)) {
      continue;
    }

    const key = String(value);
    const firstIndex = seen.get(key);
    if (firstIndex !== undefined) {
      findings.push({
        code: 'DOCTOR_DUPLICATE_ID',
        severity: 'warn',
        source: 'doctor',
        resource: resource.name,
        field: resource.idField,
        message: `${resource.name} has duplicate ${resource.idField} "${value}" in records ${firstIndex} and ${index}.`,
        hint: `Make each ${resource.name}.${resource.idField} value unique before relying on update, delete, or relation expansion behavior.`,
        details: {
          idField: resource.idField,
          value,
          firstRecordIndex: firstIndex,
          recordIndex: index,
        },
      });
      continue;
    }

    seen.set(key, index);
  }

  return findings;
}

export function mixedIdTypeFindings(resource: DoctorResource): DoctorFinding[] {
  const counts = valueTypeCounts(resource.seed.map((record) => record?.[resource.idField]));
  if (counts.size <= 1) {
    return [];
  }

  return [
    {
      code: 'DOCTOR_MIXED_ID_TYPES',
      severity: 'warn',
      source: 'doctor',
      resource: resource.name,
      field: resource.idField,
      message: `${resource.name}.${resource.idField} uses mixed value types: ${describeCounts(counts)}.`,
      hint: 'Use one id type consistently. String ids are usually safest for JSON fixtures.',
      details: {
        idField: resource.idField,
        types: Object.fromEntries(counts),
      },
    },
  ];
}

function valueTypeCounts(values: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (isEmpty(value)) {
      continue;
    }

    const kind = valueKind(value);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
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

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}
