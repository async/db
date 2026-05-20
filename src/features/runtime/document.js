import { assertRecordMatchesResource } from '../../schema.js';
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
      assertRecordMatchesResource(value, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await this.adapter().writeResource(this.resource, value);
      this.emit('put');
      return value;
    });
  }

  async set(pointer, value) {
    return this.adapter().withResourceWrite(this.resource, async () => {
      const document = await this.all();
      setPointer(document, pointer, value);
      assertRecordMatchesResource(document, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await this.adapter().writeResource(this.resource, document);
      this.emit('set', { pointer });
      return value;
    });
  }

  async update(patch) {
    return this.adapter().withResourceWrite(this.resource, async () => {
      const document = await this.all();
      const nextDocument = {
        ...document,
        ...patch,
      };
      assertRecordMatchesResource(nextDocument, this.resource, this.config, {
        source: `${this.resource.name} document patch body`,
      });
      await this.adapter().writeResource(this.resource, nextDocument);
      this.emit('update');
      return nextDocument;
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
