import { dbError } from '../../errors.js';
import { assertRecordMatchesResource, validateUniqueCollectionFields } from '../../schema.js';
import { applyDefaultsToRecord } from '../../sync.js';
import { createRuntime } from '../storage/runtime.js';

export class DbCollection {
  constructor(db, resource) {
    this.db = normalizeDb(db, resource);
    this.config = this.db.config;
    this.resource = resource;
    this.path = this.db.runtime.adapterFor(resource).statePath?.(resource);
  }

  async all() {
    return this.adapter().readResource(this.resource, []);
  }

  async get(id) {
    const records = await this.all();
    return records.find((record) => idMatches(record?.[this.resource.idField], id)) ?? null;
  }

  async exists(id) {
    return await this.get(id) !== null;
  }

  async create(record) {
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

      assertRecordMatchesResource(nextRecord, this.resource, this.config, {
        source: `${this.resource.name} create body`,
      });

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

      assertUniqueCollectionRecords([...records, nextRecord], this.resource);
      const nextRecords = [...records, nextRecord];
      await this.adapter().writeResource(this.resource, nextRecords);
      this.emit('create', { id });
      return nextRecord;
    });
  }

  async update(id, patch) {
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
      nextRecords[index] = nextRecord;
      assertRecordMatchesResource(nextRecords[index], this.resource, this.config, {
        source: `${this.resource.name} patch body`,
      });
      assertUniqueCollectionRecords(nextRecords, this.resource);
      await this.adapter().writeResource(this.resource, nextRecords);
      this.emit('update', { id: existingId });
      return nextRecords[index];
    });
  }

  async patch(id, patch) {
    return this.update(id, patch);
  }

  async delete(id) {
    return this.adapter().withResourceWrite(this.resource, async () => {
      const records = await this.all();
      const nextRecords = records.filter((record) => !idMatches(record?.[this.resource.idField], id));
      const deleted = nextRecords.length !== records.length;
      await this.adapter().writeResource(this.resource, nextRecords);
      if (deleted) {
        this.emit('delete', { id });
      }
      return deleted;
    });
  }

  adapter() {
    return this.db.runtime.adapterFor(this.resource);
  }

  emit(op, details = {}) {
    this.db.runtime.emit({
      resource: this.resource.name,
      kind: 'collection',
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

function assertUniqueCollectionRecords(records, resource) {
  const diagnostics = validateUniqueCollectionFields(resource, records).filter((diagnostic) => diagnostic.severity === 'error');
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

function idMatches(left, right) {
  return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
}

function nextCollectionId(records, idField) {
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
