import { dbError, listChoices } from '../../errors.js';

type EventRecord = Record<string, unknown>;

export type DbEventAppendCollection<RecordType extends EventRecord = EventRecord> = {
  append(record: RecordType): Promise<RecordType>;
};

export type DbEventResourceOptions = {
  /**
   * Optional id producer. Leave unset when the target collection already
   * generates ids through its normal append path.
   */
  id?: () => unknown;
  /** Timestamp producer for the conventional timestamp field. */
  now?: () => string | Date;
  /** Default event level when append() does not provide one. Defaults to "info". */
  defaultLevel?: string;
  /** Field name for the generated timestamp. Defaults to "createdAt". */
  timestampField?: string;
  /** Optional validation for event type names. */
  typePattern?: RegExp;
  /** Optional allow-list for event levels. */
  levels?: readonly string[];
};

export type DbEventResourceAppendOptions = {
  /** Explicit id for this event record. Overrides the helper id producer. */
  id?: unknown;
  /** Event severity or classification. Defaults to the helper default level. */
  level?: string;
  /** Human-readable event message. Defaults to the event type. */
  message?: string;
  /** Explicit timestamp for this event record. */
  createdAt?: string;
  /** Extra record fields to merge into the appended event. */
  fields?: EventRecord;
};

export type DbEventResource<
  Payload = unknown,
  RecordType extends EventRecord = EventRecord,
> = {
  readonly collection: DbEventAppendCollection<RecordType>;
  append(type: string, payload?: Payload, options?: DbEventResourceAppendOptions): Promise<RecordType>;
};

export function eventResource<
  Payload = unknown,
  RecordType extends EventRecord = EventRecord,
>(
  collection: DbEventAppendCollection<RecordType>,
  options: DbEventResourceOptions = {},
): DbEventResource<Payload, RecordType> {
  if (!collection || typeof collection.append !== 'function') {
    throw dbError(
      'DB_EVENT_RESOURCE_INVALID_COLLECTION',
      'Cannot create an event resource helper without a collection append(record) function.',
      {
        hint: 'Pass an append-only collection such as db.collection("localEvents").',
      },
    );
  }

  return {
    collection,
    async append(type: string, payload?: Payload, appendOptions: DbEventResourceAppendOptions = {}) {
      assertEventType(type, options);
      const level = appendOptions.level ?? options.defaultLevel ?? 'info';
      assertEventLevel(level, options);
      const timestampField = options.timestampField ?? 'createdAt';
      const timestamp = appendOptions.createdAt ?? timestampFrom(options.now?.() ?? new Date().toISOString());
      const id = appendOptions.id ?? options.id?.();
      const record = stripUndefined({
        ...appendOptions.fields,
        id,
        type,
        level,
        message: appendOptions.message ?? type,
        payload: payload === undefined ? {} : payload,
        [timestampField]: timestamp,
      }) as RecordType;

      return await collection.append(record);
    },
  };
}

function assertEventType(type: string, options: DbEventResourceOptions): void {
  if (typeof type !== 'string' || type.trim() === '') {
    throw dbError(
      'DB_EVENT_RESOURCE_INVALID_TYPE',
      'Cannot append an event without a non-empty string type.',
      {
        hint: 'Use a stable event type such as "app.registered".',
        details: { type },
      },
    );
  }

  if (!options.typePattern) {
    return;
  }

  if (options.typePattern.global || options.typePattern.sticky) {
    options.typePattern.lastIndex = 0;
  }
  if (!options.typePattern.test(type)) {
    throw dbError(
      'DB_EVENT_RESOURCE_INVALID_TYPE',
      `Cannot append event type "${type}" because it does not match the configured pattern.`,
      {
        hint: 'Use a type that matches the event resource typePattern option.',
        details: {
          type,
          pattern: String(options.typePattern),
        },
      },
    );
  }
}

function assertEventLevel(level: string, options: DbEventResourceOptions): void {
  if (typeof level !== 'string' || level.trim() === '') {
    throw dbError(
      'DB_EVENT_RESOURCE_INVALID_LEVEL',
      'Cannot append an event without a non-empty string level.',
      {
        hint: 'Use a stable event level such as "info", "warn", or "error".',
        details: { level },
      },
    );
  }

  if (!options.levels || options.levels.length === 0 || options.levels.includes(level)) {
    return;
  }

  throw dbError(
    'DB_EVENT_RESOURCE_INVALID_LEVEL',
    `Cannot append event level "${level}" because it is not allowed for this event resource.`,
    {
      hint: `Use one of: ${listChoices([...options.levels])}.`,
      details: {
        level,
        levels: [...options.levels],
      },
    },
  );
}

function timestampFrom(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function stripUndefined(record: EventRecord): EventRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
