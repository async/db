export type CollectionRecord = Record<string, unknown>;

export type CollectionWhereOperator = {
    eq?: unknown;
    ne?: unknown;
    in?: unknown[];
    gt?: unknown;
    gte?: unknown;
    lt?: unknown;
    lte?: unknown;
    contains?: unknown;
};

export type CollectionWhereValue = unknown | CollectionWhereOperator;

export type CollectionWhere = Record<string, CollectionWhereValue>;

export type CollectionOrderBy =
  | string
  | {
    field: string;
    direction?: 'asc' | 'desc';
  }
  | Array<string | {
    field: string;
    direction?: 'asc' | 'desc';
  }>;

export type CollectionQuery = {
  where?: CollectionWhere;
  orderBy?: CollectionOrderBy;
  limit?: number;
  offset?: number;
};

export type CollectionAggregateMetric =
  | 'count'
  | {
    op: 'count' | 'sum' | 'min' | 'max' | 'avg';
    field?: string;
  };

export type CollectionAggregate = CollectionQuery & {
  groupBy?: string | string[];
  metrics?: Record<string, CollectionAggregateMetric>;
};

export function applyCollectionQuery(records: CollectionRecord[], query: CollectionQuery = {}): CollectionRecord[] {
  let next = query.where ? records.filter((record) => recordMatchesWhere(record, query.where)) : [...records];
  if (query.orderBy) {
    next = next.sort(compareRecords(normalizeOrderBy(query.orderBy)));
  }
  const offset = Math.max(0, query.offset ?? 0);
  const limit = query.limit == null ? undefined : Math.max(0, query.limit);
  return next.slice(offset, limit == null ? undefined : offset + limit);
}

export function countCollectionRecords(records: CollectionRecord[], query: CollectionQuery = {}): number {
  return applyCollectionQuery(records, { where: query.where }).length;
}

export function aggregateCollectionRecords(records: CollectionRecord[], aggregate: CollectionAggregate): CollectionRecord[] {
  const filtered = aggregate.where ? records.filter((record) => recordMatchesWhere(record, aggregate.where)) : records;
  const groupFields = Array.isArray(aggregate.groupBy)
    ? aggregate.groupBy
    : aggregate.groupBy
      ? [aggregate.groupBy]
      : [];
  const metrics = aggregate.metrics ?? { count: 'count' };
  const groups = new Map<string, { values: CollectionRecord; records: CollectionRecord[] }>();

  for (const record of filtered) {
    const values = Object.fromEntries(groupFields.map((field) => [field, record[field]]));
    const key = JSON.stringify(values);
    const group = groups.get(key);
    if (group) {
      group.records.push(record);
    } else {
      groups.set(key, { values, records: [record] });
    }
  }

  let rows = [...groups.values()].map((group) => ({
    ...group.values,
    ...evaluateMetrics(group.records, metrics),
  }));
  if (aggregate.orderBy) {
    rows = rows.sort(compareRecords(normalizeOrderBy(aggregate.orderBy)));
  }
  const offset = Math.max(0, aggregate.offset ?? 0);
  const limit = aggregate.limit == null ? undefined : Math.max(0, aggregate.limit);
  return rows.slice(offset, limit == null ? undefined : offset + limit);
}

function evaluateMetrics(
  records: CollectionRecord[],
  metrics: Record<string, CollectionAggregateMetric>,
): CollectionRecord {
  const output: CollectionRecord = {};
  for (const [name, rawMetric] of Object.entries(metrics)) {
    const metric = rawMetric === 'count' ? { op: 'count' as const } : rawMetric;
    if (metric.op === 'count') {
      output[name] = metric.field
        ? records.filter((record) => record[metric.field as string] !== undefined && record[metric.field as string] !== null).length
        : records.length;
      continue;
    }
    const values = records
      .map((record) => Number(record[metric.field as string]))
      .filter((value) => Number.isFinite(value));
    if (metric.op === 'sum') {
      output[name] = values.reduce((sum, value) => sum + value, 0);
    } else if (metric.op === 'avg') {
      output[name] = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    } else if (metric.op === 'min') {
      output[name] = values.length > 0 ? Math.min(...values) : null;
    } else if (metric.op === 'max') {
      output[name] = values.length > 0 ? Math.max(...values) : null;
    }
  }
  return output;
}

function recordMatchesWhere(record: CollectionRecord, where: CollectionWhere): boolean {
  return Object.entries(where).every(([field, condition]) => valueMatches(record[field], condition));
}

function valueMatches(value: unknown, condition: CollectionWhereValue): boolean {
  if (isOperatorCondition(condition)) {
    if ('eq' in condition && !sameValue(value, condition.eq)) return false;
    if ('ne' in condition && sameValue(value, condition.ne)) return false;
    if ('in' in condition && !condition.in?.some((entry) => sameValue(value, entry))) return false;
    if ('gt' in condition && !compareOperator(value, condition.gt, (left, right) => left > right)) return false;
    if ('gte' in condition && !compareOperator(value, condition.gte, (left, right) => left >= right)) return false;
    if ('lt' in condition && !compareOperator(value, condition.lt, (left, right) => left < right)) return false;
    if ('lte' in condition && !compareOperator(value, condition.lte, (left, right) => left <= right)) return false;
    if ('contains' in condition && !String(value ?? '').includes(String(condition.contains ?? ''))) return false;
    return true;
  }
  return sameValue(value, condition);
}

function isOperatorCondition(value: unknown): value is CollectionWhereOperator {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && ['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'contains'].some((key) => key in value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || left === null || right === undefined || right === null) return false;
  return String(left) === String(right);
}

function compareOperator(left: unknown, right: unknown, compare: (left: number | string, right: number | string) => boolean): boolean {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return compare(leftNumber, rightNumber);
  }
  return compare(String(left), String(right));
}

function normalizeOrderBy(orderBy: CollectionOrderBy): Array<{ field: string; direction: 'asc' | 'desc' }> {
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  return entries.map((entry) => {
    if (typeof entry === 'string') {
      const direction = entry.startsWith('-') ? 'desc' : 'asc';
      const field = entry.replace(/^-/, '');
      return { field, direction };
    }
    return {
      field: entry.field,
      direction: entry.direction === 'desc' ? 'desc' : 'asc',
    };
  });
}

function compareRecords(orderBy: Array<{ field: string; direction: 'asc' | 'desc' }>): (left: CollectionRecord, right: CollectionRecord) => number {
  return (left, right) => {
    for (const order of orderBy) {
      const result = compareValues(left[order.field], right[order.field]);
      if (result !== 0) {
        return order.direction === 'desc' ? -result : result;
      }
    }
    return 0;
  };
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === undefined || left === null) return 1;
  if (right === undefined || right === null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}
