import { dbError } from '../../errors.js';
import { createSchemaValidator, validateUniqueCollectionFields } from '../../schema.js';
import { applyDefaultsToRecord } from '../../sync.js';
import { createRuntime } from '../storage/runtime.js';

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
  [key: string]: unknown;
};

type RuntimeAdapter = {
  statePath?: (resource: RuntimeResource) => unknown;
  readResource?: (resource: RuntimeResource, fallback: unknown) => Promise<unknown> | unknown;
  writeResource?: (resource: RuntimeResource, value: unknown) => Promise<unknown> | unknown;
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
    return records.find((record) => idMatches(record?.[this.resource.idField], id)) ?? null;
  }

  async exists(id: unknown): Promise<boolean> {
    return await this.get(id) !== null;
  }

  async create(record: RuntimeRecord): Promise<RuntimeRecord> {
    this.db.assertResourceWritable?.(this.resource.name);
    return this.adapter().withResourceWrite(this.resource, async () => {
      const records = await this.all();
      const nextRecord = this.config.defaults?.applyOnCreate === false
        ? { ...record }
        : applyDefaultsToRecord(record, this.resource);
      let id = nextRecord[this.resource.idField];

      if (id === undefined || id === null || id === '') {
        id = nextCollectionId(records, this.resource.idField);
        nextRecord[this.resource.idField] = id;
      }

      const validatedRecord = await assertRuntimeRecord(nextRecord, this.resource, this.config, {
        mode: 'create',
        source: `${this.resource.name} create body`,
      });
      id = validatedRecord[this.resource.idField];

      if (records.some((existing) => idMatches(existing?.[this.resource.idField], id))) {
        throw dbError(
          'DB_CREATE_DUPLICATE_ID',
          `Cannot create "${this.resource.name}" record because id "${id}" already exists.`,
          {
            status: 409,
            hint: 'Use a unique id, or call patch/update if you intended to modify the existing record.',
            details: {
              resource: this.resource.name,
              idField: this.resource.idField,
              id,
            },
          },
        );
      }

      assertUniqueCollectionRecords([...records, validatedRecord], this.resource);
      const nextRecords = [...records, validatedRecord];
      await this.adapter().writeResource?.(this.resource, nextRecords);
      this.emit('create', { id });
      return validatedRecord;
    });
  }

  async update(id: unknown, patch: RuntimeRecord): Promise<RuntimeRecord | null> {
    this.db.assertResourceWritable?.(this.resource.name);
    return this.adapter().withResourceWrite(this.resource, async () => {
      const records = await this.all();
      const index = records.findIndex((record) => idMatches(record?.[this.resource.idField], id));
      if (index === -1) {
        return null;
      }
      const existingId = records[index]?.[this.resource.idField];

      const nextRecord = {
        ...records[index],
        ...patch,
        [this.resource.idField]: existingId,
      };
      const nextRecords = [...records];
      nextRecords[index] = await assertRuntimeRecord(nextRecord, this.resource, this.config, {
        mode: 'replace',
        source: `${this.resource.name} patch body`,
      });
      assertUniqueCollectionRecords(nextRecords, this.resource);
      await this.adapter().writeResource?.(this.resource, nextRecords);
      this.emit('update', { id: existingId });
      return nextRecords[index];
    });
  }

  async patch(id: unknown, patch: RuntimeRecord): Promise<RuntimeRecord | null> {
    return this.update(id, patch);
  }

  async delete(id: unknown): Promise<boolean> {
    this.db.assertResourceWritable?.(this.resource.name);
    return this.adapter().withResourceWrite(this.resource, async () => {
      const records = await this.all();
      const nextRecords = records.filter((record) => !idMatches(record?.[this.resource.idField], id));
      const deleted = nextRecords.length !== records.length;
      await this.adapter().writeResource?.(this.resource, nextRecords);
      if (deleted) {
        this.emit('delete', { id });
      }
      return deleted;
    });
  }

  async replaceAll(records: RuntimeRecord[]): Promise<RuntimeRecord[]> {
    this.db.assertResourceWritable?.(this.resource.name);
    return this.adapter().withResourceWrite(this.resource, async () => {
      const validatedRecords = [];
      for (const [index, record] of records.entries()) {
        validatedRecords.push(await assertRuntimeRecord(record, this.resource, this.config, {
          mode: 'replace',
          source: `${this.resource.name}[${index}] replaceAll body`,
        }));
      }
      assertUniqueCollectionRecords(validatedRecords, this.resource);
      await this.adapter().writeResource?.(this.resource, validatedRecords);
      this.emit('replaceAll');
      return validatedRecords;
    });
  }

  adapter(): RuntimeAdapter {
    return this.db.runtime.adapterFor(this.resource);
  }

  emit(op: string, details: Record<string, unknown> = {}): void {
    this.db.runtime.emit({
      resource: this.resource.name,
      kind: 'collection',
      op,
      ...details,
    });
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

function idMatches(left: unknown, right: unknown): boolean {
  return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
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
