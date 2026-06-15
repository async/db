import { dbError } from '../../errors.js';
import {
  assertIdentityFields,
  identityForResource,
  keyFromRecord,
  normalizeKey,
  recordMatchesKey,
  singleIdentityField,
} from '../identity.js';
import { createSchemaValidator, validateUniqueCollectionFields } from '../../schema.js';
import { applyDefaultsToRecord } from '../../sync.js';
import { createRuntime } from '../storage/runtime.js';
import { recordAuditEntry } from './audit.js';
import { assertIfMatch } from './etag.js';
import {
  aggregateCollectionRecords,
  applyCollectionQuery,
  countCollectionRecords,
  type CollectionAggregate,
  type CollectionQuery,
} from './query.js';

type RuntimeRecord = Record<string, unknown>;

type RuntimeConfig = {
  schema?: {
    unknownFields?: string;
  };
  defaults?: {
    applyOnCreate?: boolean;
  };
  cwd?: string;
  stateDir?: string;
  [key: string]: unknown;
};

type RuntimeResource = {
  name: string;
  kind?: string;
  idField?: string;
  identity?: {
    fields?: string[];
  };
  writePolicy?: string;
  [key: string]: unknown;
};

type RuntimeAdapter = {
  statePath?: (resource: RuntimeResource) => unknown;
  readResource?: (resource: RuntimeResource, fallback: unknown) => Promise<unknown> | unknown;
  writeResource?: (resource: RuntimeResource, value: unknown) => Promise<unknown> | unknown;
  writeResourceDelta?: (resource: RuntimeResource, value: unknown, delta: Record<string, unknown>) => Promise<unknown> | unknown;
  withResourceWrite?: <T>(resource: RuntimeResource, operation: () => T | Promise<T>) => Promise<T> | T;
};

type RuntimeFacade = {
  adapterFor(resource: RuntimeResource): RuntimeAdapter;
  emit(change: Record<string, unknown>): unknown;
};

type DbLike = {
  config: RuntimeConfig;
  runtime: RuntimeFacade;
  assertResourceWritable?: (resourceName: string) => void;
};

type ValidationResult = {
  ok: boolean;
  value: RuntimeRecord;
  errors: Array<{ message: string; [key: string]: unknown }>;
};

type RuntimeDiagnostic = {
  severity?: string;
  message: string;
  [key: string]: unknown;
};

export type CollectionWriteOptions = {
  /**
   * Optimistic-concurrency precondition. When set, the write only applies if
   * the stored record's current ETag matches; otherwise it fails with a 412
   * DB_PRECONDITION_FAILED error. "*" requires only that the record exists.
   */
  ifMatch?: string | null;
};

export class DbCollection {
  db: DbLike;
  config: RuntimeConfig;
  resource: RuntimeResource;
  path: unknown;

  constructor(db: DbLike | RuntimeConfig, resource: RuntimeResource) {
    this.db = normalizeDb(db, resource);
    this.config = this.db.config;
    this.resource = resource;
    this.path = this.db.runtime.adapterFor(resource).statePath?.(resource);
  }

  async all(): Promise<RuntimeRecord[]> {
    return await this.adapter().readResource?.(this.resource, []) as RuntimeRecord[];
  }

  async get(id: unknown): Promise<RuntimeRecord | null> {
    const records = await this.all();
    const key = normalizeKey(this.resource, id);
    return records.find((record) => recordMatchesKey(this.resource, record, key)) ?? null;
  }

  async exists(id: unknown): Promise<boolean> {
    return await this.get(id) !== null;
  }

  async find(query: CollectionQuery = {}): Promise<RuntimeRecord[]> {
    return applyCollectionQuery(await this.all(), query);
  }

  async count(query: CollectionQuery = {}): Promise<number> {
    return countCollectionRecords(await this.all(), query);
  }

  async aggregate(aggregate: CollectionAggregate): Promise<RuntimeRecord[]> {
    return aggregateCollectionRecords(await this.all(), aggregate);
  }

  async create(record: RuntimeRecord): Promise<RuntimeRecord> {
    this.assertMutable('create');
    return this.createWithOperation(record, 'create');
  }

  async append(record: RuntimeRecord): Promise<RuntimeRecord> {
    return this.createWithOperation(record, 'append');
  }

  private async createWithOperation(record: RuntimeRecord, operation: 'create' | 'append'): Promise<RuntimeRecord> {
    this.db.assertResourceWritable?.(this.resource.name);
    return this.adapter().withResourceWrite(this.resource, async () => {
      const records = await this.all();
      const nextRecord = this.config.defaults?.applyOnCreate === false
        ? { ...record }
        : applyDefaultsToRecord(record, this.resource);
      const identity = identityForResource(this.resource);
      const idField = singleIdentityField(identity);

      if (idField && (nextRecord[idField] === undefined || nextRecord[idField] === null || nextRecord[idField] === '')) {
        nextRecord[idField] = nextCollectionId(records, idField);
      }
      if (!idField) {
        assertIdentityFields(this.resource, nextRecord);
      }

      const validatedRecord = await assertRuntimeRecord(nextRecord, this.resource, this.config, {
        mode: 'create',
        source: `${this.resource.name} create body`,
      });
      const key = keyFromRecord(this.resource, validatedRecord);

      if (records.some((existing) => recordMatchesKey(this.resource, existing, key))) {
        throw dbError(
          idField ? 'DB_CREATE_DUPLICATE_ID' : 'DB_CREATE_DUPLICATE_KEY',
          idField
            ? `Cannot create "${this.resource.name}" record because id "${String(key[idField])}" already exists.`
            : `Cannot create "${this.resource.name}" record because its identity already exists.`,
          {
            status: 409,
            hint: idField
              ? 'Use a unique id, or call patch/update if you intended to modify the existing record.'
              : `Use a unique compound key for fields: ${identity.fields.join(', ')}.`,
            details: {
              resource: this.resource.name,
              identity,
              key,
            },
          },
        );
      }

      assertUniqueCollectionRecords([...records, validatedRecord], this.resource);
      const nextRecords = [...records, validatedRecord];
      await this.write(nextRecords, { op: 'put-record', identity, record: validatedRecord });
      await this.audit(operation, { id: singleAuditId(identity, key), key, after: validatedRecord });
      this.emit(operation, { id: singleAuditId(identity, key), key });
      return validatedRecord;
    });
  }

  async update(id: unknown, patch: RuntimeRecord, options: CollectionWriteOptions = {}): Promise<RuntimeRecord | null> {
    this.db.assertResourceWritable?.(this.resource.name);
    this.assertMutable('update');
    return this.adapter().withResourceWrite(this.resource, async () => {
      const records = await this.all();
      const key = normalizeKey(this.resource, id);
      const index = records.findIndex((record) => recordMatchesKey(this.resource, record, key));
      if (index === -1) {
        return null;
      }
      const identity = identityForResource(this.resource);
      // Checked inside the write queue so no concurrent write can land
      // between the precondition and this update.
      assertIfMatch(records[index], options.ifMatch, {
        resource: this.resource.name,
        id: singleAuditId(identity, key),
      });

      const nextRecord = {
        ...records[index],
        ...patch,
        ...Object.fromEntries(identity.fields.map((field) => [field, records[index]?.[field]])),
      };
      const nextRecords = [...records];
      nextRecords[index] = await assertRuntimeRecord(nextRecord, this.resource, this.config, {
        mode: 'replace',
        source: `${this.resource.name} patch body`,
      });
      assertUniqueCollectionRecords(nextRecords, this.resource);
      await this.write(nextRecords, { op: 'put-record', identity, record: nextRecords[index] });
      await this.audit('update', {
        id: singleAuditId(identity, key),
        key,
        fields: Object.keys(patch ?? {}),
        before: records[index],
        after: nextRecords[index],
      });
      this.emit('update', { id: singleAuditId(identity, key), key });
      return nextRecords[index];
    });
  }

  async patch(id: unknown, patch: RuntimeRecord, options: CollectionWriteOptions = {}): Promise<RuntimeRecord | null> {
    return this.update(id, patch, options);
  }

  async delete(id: unknown, options: CollectionWriteOptions = {}): Promise<boolean> {
    this.db.assertResourceWritable?.(this.resource.name);
    this.assertMutable('delete');
    return this.adapter().withResourceWrite(this.resource, async () => {
      const records = await this.all();
      const key = normalizeKey(this.resource, id);
      const identity = identityForResource(this.resource);
      const index = records.findIndex((record) => recordMatchesKey(this.resource, record, key));
      if (index === -1) {
        return false;
      }
      assertIfMatch(records[index], options.ifMatch, {
        resource: this.resource.name,
        id: singleAuditId(identity, key),
      });
      const nextRecords = records.filter((record) => !recordMatchesKey(this.resource, record, key));
      await this.write(nextRecords, { op: 'delete-record', identity, key });
      await this.audit('delete', { id: singleAuditId(identity, key), key, before: records[index] });
      this.emit('delete', { id: singleAuditId(identity, key), key });
      return true;
    });
  }

  async replaceAll(records: RuntimeRecord[]): Promise<RuntimeRecord[]> {
    this.db.assertResourceWritable?.(this.resource.name);
    this.assertMutable('replaceAll');
    return this.adapter().withResourceWrite(this.resource, async () => {
      const validatedRecords = [];
      for (const [index, record] of records.entries()) {
        validatedRecords.push(await assertRuntimeRecord(record, this.resource, this.config, {
          mode: 'replace',
          source: `${this.resource.name}[${index}] replaceAll body`,
        }));
      }
      assertUniqueCollectionRecords(validatedRecords, this.resource);
      await this.write(validatedRecords, { op: 'replace-all', value: validatedRecords });
      await this.audit('replaceAll', {});
      this.emit('replaceAll');
      return validatedRecords;
    });
  }

  adapter(): RuntimeAdapter {
    return this.db.runtime.adapterFor(this.resource);
  }

  /**
   * Delta-aware write: WAL-backed adapters acknowledge the per-record delta
   * (O(change) durability) and checkpoint the full value later; plain
   * adapters write the full value immediately.
   */
  private async write(nextRecords: RuntimeRecord[], delta: Record<string, unknown>): Promise<void> {
    const adapter = this.adapter();
    if (adapter.writeResourceDelta) {
      await adapter.writeResourceDelta(this.resource, nextRecords, delta);
      return;
    }
    await adapter.writeResource?.(this.resource, nextRecords);
  }

  emit(op: string, details: Record<string, unknown> = {}): void {
    this.db.runtime.emit({
      resource: this.resource.name,
      kind: 'collection',
      op,
      ...details,
    });
  }

  private audit(op: string, details: {
    id?: unknown;
    key?: unknown;
    fields?: string[];
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    return recordAuditEntry(this.config, this.path, {
      at: new Date().toISOString(),
      resource: this.resource.name,
      kind: 'collection',
      op,
      ...details,
    });
  }

  private assertMutable(operation: string): void {
    if (this.resource.writePolicy !== 'append-only') {
      return;
    }
    throw dbError(
      'DB_APPEND_ONLY_RESOURCE',
      `Cannot ${operation} "${this.resource.name}" because it is append-only.`,
      {
        status: 405,
        hint: `Use collection("${this.resource.name}").append(record) for append-only resources.`,
        details: {
          resource: this.resource.name,
          operation,
          writePolicy: this.resource.writePolicy,
        },
      },
    );
  }
}

function assertRuntimeRecord(
  record: RuntimeRecord,
  resource: RuntimeResource,
  config: RuntimeConfig,
  options: { mode?: string; source?: string } = {},
): Promise<RuntimeRecord> {
  const validator = createSchemaValidator(resource, config, {
    mode: options.mode,
    unknownFields: config.schema?.unknownFields ?? 'warn',
    applyDefaults: false,
  });
  return validator.validateAsync(record, {
    source: options.source,
    applyDefaults: false,
  }).then((result: ValidationResult) => {
    if (result.ok) {
      return result.value;
    }

    throw dbError(
      'DB_SCHEMA_VALIDATION_FAILED',
      `${resource.name} record does not match its schema: ${result.errors[0].message}`,
      {
        status: 400,
        hint: 'Update the record to match the schema field types, required fields, enum values, and constraints.',
        details: {
          resource: resource.name,
          diagnostics: result.errors,
        },
      },
    );
  });
}

function normalizeDb(db: DbLike | RuntimeConfig, resource: RuntimeResource): DbLike {
  if (isDbLike(db)) {
    return db;
  }
  const config = db as RuntimeConfig;
  const runtime = createRuntime(config as RuntimeConfig & { cwd: string; stateDir: string }, [resource]) as RuntimeFacade;
  return {
    config,
    runtime,
  };
}

function isDbLike(value: DbLike | RuntimeConfig): value is DbLike {
  return Boolean((value as DbLike)?.runtime && (value as DbLike)?.config);
}

function assertUniqueCollectionRecords(records: RuntimeRecord[], resource: RuntimeResource): void {
  const diagnostics = (validateUniqueCollectionFields(resource, records) as RuntimeDiagnostic[])
    .filter((diagnostic) => diagnostic.severity === 'error');
  if (diagnostics.length === 0) {
    return;
  }

  throw dbError(
    'DB_SCHEMA_VALIDATION_FAILED',
    `${resource.name} record does not match its schema: ${diagnostics[0].message}`,
    {
      status: 400,
      hint: 'Update the record to satisfy unique schema fields.',
      details: {
        resource: resource.name,
        diagnostics,
      },
    },
  );
}

function singleAuditId(identity: ReturnType<typeof identityForResource>, key: RuntimeRecord): unknown {
  const idField = singleIdentityField(identity);
  return idField ? key[idField] : undefined;
}

function nextCollectionId(records: RuntimeRecord[], idField: string | undefined): string {
  const usedIds = new Set(records
    .map((record) => record?.[idField])
    .filter((id) => id !== undefined && id !== null && id !== '')
    .map((id) => String(id)));
  const numericIds = [...usedIds]
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  let next = numericIds.length > 0 ? Math.max(...numericIds) + 1 : records.length + 1;

  while (usedIds.has(String(next))) {
    next += 1;
  }

  return String(next);
}
