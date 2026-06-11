import { dbError } from '../../errors.js';
import { createSchemaValidator } from '../../schema.js';
import { createRuntime } from '../storage/runtime.js';
import { recordAuditEntry } from './audit.js';
import { assertIfMatch } from './etag.js';
import { getPointer, setPointer, type JsonPath } from './json-pointer.js';

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
  value: unknown;
  errors: Array<{ message: string; [key: string]: unknown }>;
};

export type DocumentWriteOptions = {
  /**
   * Optimistic-concurrency precondition. When set, the write only applies if
   * the stored document's current ETag matches; otherwise it fails with a 412
   * DB_PRECONDITION_FAILED error.
   */
  ifMatch?: string | null;
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

  async get(path: JsonPath = ''): Promise<unknown> {
    const document = await this.all();
    return Array.isArray(path) || path ? getPointer(document, path) : document;
  }

  async put(value: unknown, options: DocumentWriteOptions = {}): Promise<unknown> {
    this.db.assertResourceWritable?.(this.resource.name);
    return this.adapter().withResourceWrite(this.resource, async () => {
      if (options.ifMatch !== undefined && options.ifMatch !== null) {
        assertIfMatch(await this.all(), options.ifMatch, { resource: this.resource.name });
      }
      const document = await assertRuntimeDocument(value, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await this.write(document);
      await this.audit('put', { after: document });
      this.emit('put');
      return document;
    });
  }

  async set(path: JsonPath, value: unknown): Promise<unknown> {
    this.db.assertResourceWritable?.(this.resource.name);
    return this.adapter().withResourceWrite(this.resource, async () => {
      const document = await this.all() as Record<string, unknown>;
      setPointer(document, path, value);
      const nextDocument = await assertRuntimeDocument(document, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await this.write(nextDocument);
      await this.audit('set', { fields: [pointerLabel(path)] });
      this.emit('set', pathEventDetails(path));
      return getPointer(nextDocument, path);
    });
  }

  async update(patch: Record<string, unknown>, options: DocumentWriteOptions = {}): Promise<unknown> {
    this.db.assertResourceWritable?.(this.resource.name);
    return this.adapter().withResourceWrite(this.resource, async () => {
      const document = await this.all() as Record<string, unknown>;
      assertIfMatch(document, options.ifMatch, { resource: this.resource.name });
      const nextDocument = {
        ...document,
        ...patch,
      };
      const validatedDocument = await assertRuntimeDocument(nextDocument, this.resource, this.config, {
        source: `${this.resource.name} document patch body`,
      });
      await this.write(validatedDocument);
      await this.audit('update', {
        fields: Object.keys(patch ?? {}),
        before: document,
        after: validatedDocument,
      });
      this.emit('update');
      return validatedDocument;
    });
  }

  adapter(): RuntimeAdapter {
    return this.db.runtime.adapterFor(this.resource);
  }

  private async write(nextDocument: unknown): Promise<void> {
    const adapter = this.adapter();
    if (adapter.writeResourceDelta) {
      await adapter.writeResourceDelta(this.resource, nextDocument, { op: 'replace-all', value: nextDocument });
      return;
    }
    await adapter.writeResource?.(this.resource, nextDocument);
  }

  emit(op: string, details: Record<string, unknown> = {}): void {
    this.db.runtime.emit({
      resource: this.resource.name,
      kind: 'document',
      op,
      ...details,
    });
  }

  private audit(op: string, details: { fields?: string[]; before?: unknown; after?: unknown }): Promise<void> {
    return recordAuditEntry(this.config, this.path, {
      at: new Date().toISOString(),
      resource: this.resource.name,
      kind: 'document',
      op,
      ...details,
    });
  }
}

function pointerLabel(path: JsonPath): string {
  return typeof path === 'string' ? path : `/${path.join('/')}`;
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

function pathEventDetails(path: JsonPath): Record<string, unknown> {
  return typeof path === 'string' ? { pointer: path } : { path };
}
