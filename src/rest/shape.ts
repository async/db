import { dbError, listChoices } from '../errors.js';
import { resolveSelectedComputedFields } from '../features/runtime/fanout.js';
import { resolveResource } from '../names.js';

type RestRecord = Record<string, unknown>;

type RestField = {
  computed?: boolean;
  [key: string]: unknown;
};

type RestRelation = {
  name: string;
  sourceField: string;
  targetResource: string;
  targetField: string;
  cardinality: string;
  [key: string]: unknown;
};

type RestResource = {
  name: string;
  fields?: Record<string, RestField>;
  relations?: RestRelation[];
  [key: string]: unknown;
};

type RestCollection = {
  all: () => Promise<RestRecord[]>;
};

type RestDb = {
  resources: Map<string, RestResource>;
  collection: (resourceName: string) => RestCollection;
  config?: unknown;
  [key: string]: unknown;
};

type ShapeOptions = {
  allowPagination?: boolean;
};

type ShapeQuery = {
  select: string[][];
  expand: string[];
  offset: number;
  limit?: number;
  relationMap: Map<string, RestRelation>;
};

export async function shapeCollectionRead(
  db: RestDb,
  resource: RestResource,
  records: RestRecord[],
  url: URL,
  options: ShapeOptions = {},
): Promise<RestRecord[]> {
  const query = parseShapeQuery(db, resource, url, options);
  const paginated = options.allowPagination ? paginateRecords(records, query) : records;
  const expanded = query.expand.length > 0
    ? await expandRecords(db, paginated, query)
    : paginated;

  if (query.select.length === 0) {
    return expanded;
  }

  const computed = query.select
    .filter(([head, child]) => !child && resource.fields?.[head]?.computed)
    .map(([head]) => head);
  const resolved = computed.length > 0
    ? await resolveSelectedComputedFields(db, resource, expanded, computed)
    : expanded;

  return resolved.map((record) => projectRecord(record, query));
}

function parseShapeQuery(db: RestDb, resource: RestResource, url: URL, options: ShapeOptions): ShapeQuery {
  const relationMap = new Map((resource.relations ?? []).map((relation) => [relation.name, relation]));
  const expand = parseListParam(url.searchParams.get('expand'));
  const select = parseListParam(url.searchParams.get('select')).map((path) => path.split('.'));

  for (const relationName of expand) {
    const relation = relationMap.get(relationName);
    if (!relation) {
      throw dbError(
        'REST_EXPAND_UNKNOWN_RELATION',
        `Unknown expanded relation "${relationName}" on ${resource.name}.`,
        {
          status: 400,
          hint: `Use one of: ${listChoices([...relationMap.keys()])}.`,
          details: {
            resource: resource.name,
            relation: relationName,
            availableRelations: [...relationMap.keys()],
          },
        },
      );
    }

    if (relation.cardinality !== 'one') {
      throw dbError(
        'REST_EXPAND_UNSUPPORTED_CARDINALITY',
        `Relation "${relationName}" on ${resource.name} cannot be expanded by REST yet because it is ${relation.cardinality}.`,
        {
          status: 400,
          hint: 'MVP REST expansion supports explicit to-one relations only.',
          details: relation,
        },
      );
    }
  }

  validateSelectedFields(db, resource, select, new Set(expand), relationMap);

  const offset = options.allowPagination
    ? parseOffset(url.searchParams.get('offset'))
    : 0;
  const limit = options.allowPagination
    ? parseLimit(url.searchParams.get('limit'))
    : undefined;

  return {
    select,
    expand,
    offset,
    limit,
    relationMap,
  };
}

function validateSelectedFields(
  db: RestDb,
  resource: RestResource,
  select: string[][],
  expanded: Set<string>,
  relationMap: Map<string, RestRelation>,
): void {
  for (const parts of select) {
    const [head, child, extra] = parts;
    if (!head || extra !== undefined) {
      throw dbError(
        'REST_SELECT_UNSUPPORTED_DEPTH',
        `Selected path "${parts.join('.')}" is too deep.`,
        {
          status: 400,
          hint: 'Use top-level fields or one nested relation field such as "author.name".',
          details: {
            resource: resource.name,
            path: parts.join('.'),
          },
        },
      );
    }

    const relation = relationMap.get(head);
    if (!child) {
      if (head in (resource.fields ?? {}) || relation) {
        if (relation && !expanded.has(head)) {
          throw selectRequiresExpand(resource, head);
        }
        continue;
      }

      throw unknownSelectField(resource, head, availableShapeFields(resource, relationMap));
    }

    if (!relation) {
      throw unknownSelectField(resource, head, availableShapeFields(resource, relationMap));
    }

    if (!expanded.has(head)) {
      throw selectRequiresExpand(resource, head);
    }

    const target = resolveResource(db.resources, relation.targetResource).resource;
    const targetFields = target?.fields ?? {};
    if (!(child in targetFields)) {
      throw unknownSelectField(target ?? resource, child, Object.keys(targetFields), `${head}.${child}`);
    }
  }
}

function unknownSelectField(
  resource: RestResource,
  field: string,
  availableFields: string[],
  path = field,
): Error {
  return dbError(
    'REST_SELECT_UNKNOWN_FIELD',
    `Unknown selected field "${field}" on ${resource.name}.`,
    {
      status: 400,
      hint: `Use one of: ${listChoices(availableFields)}.`,
      details: {
        resource: resource.name,
        field,
        path,
        availableFields: [...availableFields],
      },
    },
  );
}

function selectRequiresExpand(resource: RestResource, relationName: string): Error {
  return dbError(
    'REST_SELECT_REQUIRES_EXPAND',
    `Selected relation "${relationName}" on ${resource.name} requires explicit expand.`,
    {
      status: 400,
      hint: `Add expand=${relationName} to include nested relation fields.`,
      details: {
        resource: resource.name,
        relation: relationName,
      },
    },
  );
}

function availableShapeFields(resource: RestResource, relationMap: Map<string, RestRelation>): string[] {
  return [...new Set([...Object.keys(resource.fields ?? {}), ...relationMap.keys()])];
}

function paginateRecords(records: RestRecord[], query: ShapeQuery): RestRecord[] {
  const end = query.limit === undefined ? undefined : query.offset + query.limit;
  return records.slice(query.offset, end);
}

async function expandRecords(db: RestDb, records: RestRecord[], query: ShapeQuery): Promise<RestRecord[]> {
  const nextRecords = records.map((record) => ({ ...record }));

  for (const relationName of query.expand) {
    const relation = query.relationMap.get(relationName);
    const targets = await db.collection(relation.targetResource).all();
    const targetById = new Map();
    for (const target of targets) {
      const targetValue = target?.[relation.targetField];
      if (targetValue === undefined || targetValue === null) {
        continue;
      }

      const key = String(targetValue);
      if (!targetById.has(key)) {
        targetById.set(key, target);
      }
    }

    for (const record of nextRecords) {
      const value = record?.[relation.sourceField];
      if (value === undefined || value === null || value === '') {
        record[relation.name] = null;
        continue;
      }

      record[relation.name] = targetById.get(String(value)) ?? null;
    }
  }

  return nextRecords;
}

function projectRecord(record: RestRecord, query: ShapeQuery): RestRecord {
  const projected: RestRecord = {};
  for (const [head, child] of query.select) {
    if (!child) {
      if (record?.[head] !== undefined) {
        projected[head] = record[head];
      }
      continue;
    }

    if (record?.[head] === null) {
      projected[head] = null;
      continue;
    }

    const nested = record?.[head];
    if (!isRecord(nested)) {
      continue;
    }

    if (!isRecord(projected[head])) {
      projected[head] = {};
    }
    const projectedNested = projected[head] as RestRecord;
    if (nested[child] !== undefined) {
      projectedNested[child] = nested[child];
    }
  }

  return projected;
}

function parseListParam(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function parseOffset(value: string | null | undefined): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  if (!/^\d+$/.test(value)) {
    throw dbError(
      'REST_INVALID_OFFSET',
      `REST offset must be a non-negative integer: ${value}`,
      {
        status: 400,
        hint: 'Use offset=0, offset=20, or omit offset.',
        details: {
          offset: value,
        },
      },
    );
  }

  return Number(value);
}

function parseLimit(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw dbError(
      'REST_INVALID_LIMIT',
      `REST limit must be a positive integer: ${value}`,
      {
        status: 400,
        hint: 'Use limit=20, limit=100, or omit limit.',
        details: {
          limit: value,
        },
      },
    );
  }

  return Number(value);
}

function isRecord(value: unknown): value is RestRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
