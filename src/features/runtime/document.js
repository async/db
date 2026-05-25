import { dbError } from '../../errors.js';
import { createSchemaValidator } from '../../schema.js';
import { createRuntime } from '../storage/runtime.js';
import { getPointer, setPointer } from './json-pointer.js';

export class DbDocument {
  constructor(db, resource) {
    this.db = normalizeDb(db, resource);
    this.config = this.db.config;
    this.resource = resource;
    this.path = this.db.runtime.adapterFor(resource).statePath?.(resource);
  }

  async all() {
    return this.adapter().readResource(this.resource, {});
  }

  async get(pointer = '') {
    const document = await this.all();
    return pointer ? getPointer(document, pointer) : document;
  }

  async put(value) {
    return this.adapter().withResourceWrite(this.resource, async () => {
      const document = await assertRuntimeDocument(value, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await this.adapter().writeResource(this.resource, document);
      this.emit('put');
      return document;
    });
  }

  async set(pointer, value) {
    return this.adapter().withResourceWrite(this.resource, async () => {
      const document = await this.all();
      setPointer(document, pointer, value);
      const nextDocument = await assertRuntimeDocument(document, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await this.adapter().writeResource(this.resource, nextDocument);
      this.emit('set', { pointer });
      return getPointer(nextDocument, pointer);
    });
  }

  async update(patch) {
    return this.adapter().withResourceWrite(this.resource, async () => {
      const document = await this.all();
      const nextDocument = {
        ...document,
        ...patch,
      };
      const validatedDocument = await assertRuntimeDocument(nextDocument, this.resource, this.config, {
        source: `${this.resource.name} document patch body`,
      });
      await this.adapter().writeResource(this.resource, validatedDocument);
      this.emit('update');
      return validatedDocument;
    });
  }

  adapter() {
    return this.db.runtime.adapterFor(this.resource);
  }

  emit(op, details = {}) {
    this.db.runtime.emit({
      resource: this.resource.name,
      kind: 'document',
      op,
      ...details,
    });
  }
}

function assertRuntimeDocument(document, resource, config, options = {}) {
  const validator = createSchemaValidator(resource, config, {
    mode: 'replace',
    unknownFields: config.schema?.unknownFields ?? 'warn',
    applyDefaults: false,
  });
  return validator.validateAsync(document, {
    source: options.source,
    applyDefaults: false,
  }).then((result) => {
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

function normalizeDb(db, resource) {
  if (db?.runtime && db?.config) {
    return db;
  }
  const config = db;
  const runtime = createRuntime(config, [resource]);
  return {
    config,
    runtime,
  };
}
