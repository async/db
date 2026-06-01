import { dbError } from '../../errors.js';
import { createSchemaValidator } from '../../schema.js';
import { createRuntime } from '../storage/runtime.js';
import { getPointer, setPointer } from './json-pointer.js';

type RuntimeConfig = {
  schema?: {
    unknownFields?: string;
  };
  cwd?: string;
  stateDir?: string;
  [key: string]: unknown;
};

type RuntimeResource = {
  name: string;
  kind?: string;
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
  value: unknown;
  errors: Array<{ message: string; [key: string]: unknown }>;
};

export class DbDocument {
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

  async all(): Promise<unknown> {
    return this.adapter().readResource?.(this.resource, {});
  }

  async get(pointer = ''): Promise<unknown> {
    const document = await this.all();
    return pointer ? getPointer(document, pointer) : document;
  }

  async put(value: unknown): Promise<unknown> {
    this.db.assertResourceWritable?.(this.resource.name);
    return this.adapter().withResourceWrite(this.resource, async () => {
      const document = await assertRuntimeDocument(value, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await this.adapter().writeResource?.(this.resource, document);
      this.emit('put');
      return document;
    });
  }

  async set(pointer: string, value: unknown): Promise<unknown> {
    this.db.assertResourceWritable?.(this.resource.name);
    return this.adapter().withResourceWrite(this.resource, async () => {
      const document = await this.all() as Record<string, unknown>;
      setPointer(document, pointer, value);
      const nextDocument = await assertRuntimeDocument(document, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await this.adapter().writeResource?.(this.resource, nextDocument);
      this.emit('set', { pointer });
      return getPointer(nextDocument, pointer);
    });
  }

  async update(patch: Record<string, unknown>): Promise<unknown> {
    this.db.assertResourceWritable?.(this.resource.name);
    return this.adapter().withResourceWrite(this.resource, async () => {
      const document = await this.all() as Record<string, unknown>;
      const nextDocument = {
        ...document,
        ...patch,
      };
      const validatedDocument = await assertRuntimeDocument(nextDocument, this.resource, this.config, {
        source: `${this.resource.name} document patch body`,
      });
      await this.adapter().writeResource?.(this.resource, validatedDocument);
      this.emit('update');
      return validatedDocument;
    });
  }

  adapter(): RuntimeAdapter {
    return this.db.runtime.adapterFor(this.resource);
  }

  emit(op: string, details: Record<string, unknown> = {}): void {
    this.db.runtime.emit({
      resource: this.resource.name,
      kind: 'document',
      op,
      ...details,
    });
  }
}

function assertRuntimeDocument(
  document: unknown,
  resource: RuntimeResource,
  config: RuntimeConfig,
  options: { source?: string } = {},
): Promise<unknown> {
  const validator = createSchemaValidator(resource, config, {
    mode: 'replace',
    unknownFields: config.schema?.unknownFields ?? 'warn',
    applyDefaults: false,
  });
  return validator.validateAsync(document, {
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
