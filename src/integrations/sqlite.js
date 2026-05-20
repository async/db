import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { dbError, listChoices } from '../errors.js';
import { resolveResource, resourceAliasCollisionGroups } from '../names.js';
import { assertRecordMatchesResource, loadProjectSchema } from '../schema.js';
import { applyDefaultsToRecord } from '../sync.js';
import { applyDefaultsToSeed } from '../features/sync/defaults.js';
import { seedForRuntimeState } from '../features/sync/synthetic-seed.js';

const require = createRequire(import.meta.url);

export async function openSqliteDb(options = {}) {
  const config = await loadConfig(options);
  const project = options.project ?? await loadProjectSchema(config);
  const storage = options.storage ?? {};
  const file = storage.file ?? options.file ?? path.join(config.stateDir, 'sqlite', 'db.sqlite');
  const { DatabaseSync } = await importNodeSqlite();

  if (file !== ':memory:') {
    await mkdir(path.dirname(file), { recursive: true });
  }

  const database = new DatabaseSync(file);
  migrateSqliteDb(database, project.resources);

  return new SqliteDb(config, project.resources, database);
}

export function sqliteStore(options = {}) {
  const databases = new WeakMap();
  const writeQueues = new Map();

  return ({ config, storeName }) => {
    const file = resolveSqliteStoreFile(config, options.file);
    const connection = openStoreDatabase(file, databases, config);
    const database = connection.database;
    migrateSqliteStore(database);

    return {
      name: storeName,
      capabilities: sqliteStoreCapabilities,
      statePath() {
        return file === ':memory:' ? undefined : file;
      },
      async hydrate(resources) {
        migrateSqliteStore(database);
        for (const resource of resources) {
          syncSqliteStoreResource(database, config, resource);
        }
      },
      readResource(resource, fallback) {
        const row = database.prepare('SELECT value FROM "_db_resources" WHERE name = ?').get(resource.name);
        return row ? JSON.parse(row.value) : fallback;
      },
      writeResource(resource, value) {
        writeSqliteStoreResource(database, resource, value);
      },
      withResourceWrite(resource, operation) {
        const queueKey = `${file}:${resource.name}`;
        const previous = writeQueues.get(queueKey) ?? Promise.resolve();
        const current = previous.then(operation, operation);
        const stored = current.catch(() => {});
        writeQueues.set(queueKey, stored);
        stored.finally(() => {
          if (writeQueues.get(queueKey) === stored) {
            writeQueues.delete(queueKey);
          }
        });
        return current;
      },
      close() {
        if (connection.closed) {
          return;
        }
        connection.closed = true;
        database.close();
        databases.delete(config);
      },
    };
  };
}

function resolveSqliteStoreFile(config, file) {
  if (file === ':memory:') {
    return file;
  }
  if (file) {
    return path.resolve(config.cwd, file);
  }
  return path.join(config.stateDir, 'runtime.sqlite');
}

export const sqliteStoreCapabilities = {
  writable: true,
  persistence: 'local-sqlite',
  atomicity: 'resource',
  liveEvents: true,
  staticExport: false,
  production: 'small-local',
};

export function migrateSqliteDb(database, resources) {
  for (const resource of resources) {
    if (resource.kind === 'collection') {
      database.exec(createTableSql(resource));
    }
  }

  database.exec(`CREATE TABLE IF NOT EXISTS "_db_documents" (
    "name" TEXT PRIMARY KEY,
    "value" TEXT NOT NULL
  ) STRICT;`);
}

function migrateSqliteStore(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS "_db_resources" (
    "name" TEXT PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "source_hash" TEXT,
    "value" TEXT NOT NULL
  ) STRICT;`);
}

function openStoreDatabase(file, databases, config) {
  let connection = databases.get(config);
  if (connection && !connection.closed) {
    return connection;
  }

  const { DatabaseSync } = importNodeSqliteSync();
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  connection = {
    database: new DatabaseSync(file),
    closed: false,
  };
  databases.set(config, connection);
  return connection;
}

function syncSqliteStoreResource(database, config, resource) {
  const row = database.prepare('SELECT source_hash FROM "_db_resources" WHERE name = ?').get(resource.name);
  const sourceChanged = resource.dataHash && row?.source_hash !== resource.dataHash;

  if (!row || sourceChanged) {
    writeSqliteStoreResource(database, resource, applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config));
    return;
  }

  if (config.defaults?.applyOnSafeMigration !== false) {
    const current = JSON.parse(database.prepare('SELECT value FROM "_db_resources" WHERE name = ?').get(resource.name).value);
    writeSqliteStoreResource(database, resource, applyDefaultsToSeed(current, resource, config));
  }
}

function writeSqliteStoreResource(database, resource, value) {
  database.prepare(`INSERT INTO "_db_resources" (name, kind, source_hash, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      kind = excluded.kind,
      source_hash = excluded.source_hash,
      value = excluded.value`).run(
    resource.name,
    resource.kind,
    resource.dataHash ?? null,
    JSON.stringify(value),
  );
}

export class SqliteDb {
  constructor(config, resources, database) {
    this.config = config;
    this.resources = new Map(resources.map((resource) => [resource.name, resource]));
    assertNoResourceAliasCollisions(this.resources);
    this.database = database;
  }

  collection(name) {
    const resource = this.requireResource(name, 'collection');
    return new SqliteDbCollection(this.config, resource, this.database);
  }

  document(name) {
    const resource = this.requireResource(name, 'document');
    return new SqliteDbDocument(this.config, resource, this.database);
  }

  resourceNames() {
    return [...this.resources.keys()];
  }

  close() {
    this.database.close();
  }

  requireResource(name, kind) {
    const { resource, candidates } = resolveResource(this.resources, name);
    if (!resource) {
      throw dbError(
        'SQLITE_UNKNOWN_RESOURCE',
        `Unknown SQLite db resource "${name}".`,
        {
          status: 404,
          hint: `Use one of: ${listChoices(this.resourceNames())}.`,
          details: {
            resource: name,
            requestedResource: name,
            normalizedCandidates: candidates,
            availableResources: this.resourceNames(),
          },
        },
      );
    }

    if (resource.kind !== kind) {
      throw dbError(
        'SQLITE_RESOURCE_KIND_MISMATCH',
        `Resource "${name}" is a ${resource.kind}, not a ${kind}.`,
        {
          status: 400,
          hint: resource.kind === 'collection'
            ? `Use db.collection("${name}") for this resource.`
            : `Use db.document("${name}") for this resource.`,
          details: {
            resource: name,
            expectedKind: kind,
            actualKind: resource.kind,
          },
        },
      );
    }

    return resource;
  }
}

function assertNoResourceAliasCollisions(resources) {
  const collisions = resourceAliasCollisionGroups(resources);
  if (collisions.length === 0) {
    return;
  }

  const collision = collisions[0];
  throw dbError(
    'SQLITE_RESOURCE_ALIAS_COLLISION',
    `Resource aliases are ambiguous for "${collision.alias}".`,
    {
      status: 400,
      hint: 'Rename one resource so its camelCase and kebab-case aliases are unique.',
      details: {
        alias: collision.alias,
        aliases: collision.aliases,
        resources: collision.resources,
        candidates: collision.candidates,
        collisions,
      },
    },
  );
}

export class SqliteDbCollection {
  constructor(config, resource, database) {
    this.config = config;
    this.resource = resource;
    this.database = database;
    this.table = quoteIdentifier(resource.name);
  }

  async all() {
    return this.database.prepare(`SELECT * FROM ${this.table}`).all().map((row) => deserializeRow(this.resource, row));
  }

  async get(id) {
    const idField = quoteIdentifier(this.resource.idField);
    const row = this.database.prepare(`SELECT * FROM ${this.table} WHERE ${idField} = ?`).get(String(id));
    return row ? deserializeRow(this.resource, row) : null;
  }

  async exists(id) {
    const idField = quoteIdentifier(this.resource.idField);
    const row = this.database.prepare(`SELECT 1 as found FROM ${this.table} WHERE ${idField} = ?`).get(String(id));
    return Boolean(row);
  }

  async create(record) {
    const fields = Object.keys(this.resource.fields);
    const nextRecord = this.config.defaults?.applyOnCreate === false
      ? stripUnknownFields(this.resource, record)
      : applyDefaultsToRecord(stripUnknownFields(this.resource, record), this.resource);

    if (nextRecord[this.resource.idField] === undefined || nextRecord[this.resource.idField] === null || nextRecord[this.resource.idField] === '') {
      nextRecord[this.resource.idField] = await this.nextId();
    }

    assertRecordMatchesResource(nextRecord, this.resource, this.config, {
      source: `${this.resource.name} create body`,
    });

    const serialized = serializeRow(this.resource, nextRecord);
    const columns = fields.map(quoteIdentifier).join(', ');
    const placeholders = fields.map(() => '?').join(', ');
    try {
      this.database.prepare(`INSERT INTO ${this.table} (${columns}) VALUES (${placeholders})`).run(...fields.map((field) => serialized[field] ?? null));
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        throw dbError(
          'SQLITE_DUPLICATE_ID',
          `Cannot create "${this.resource.name}" record because id "${nextRecord[this.resource.idField]}" already exists.`,
          {
            status: 409,
            hint: 'Use a unique id, or call patch/update if you intended to modify the existing record.',
            details: {
              resource: this.resource.name,
              idField: this.resource.idField,
              id: nextRecord[this.resource.idField],
            },
          },
        );
      }
      throw error;
    }
    return nextRecord;
  }

  async update(id, patch) {
    return this.patch(id, patch);
  }

  async patch(id, patch) {
    const existing = await this.get(id);
    if (!existing) {
      return null;
    }

    const nextRecord = stripUnknownFields(this.resource, { ...existing, ...patch, [this.resource.idField]: existing[this.resource.idField] });

    assertRecordMatchesResource(nextRecord, this.resource, this.config, {
      source: `${this.resource.name} patch body`,
    });

    const fields = Object.keys(this.resource.fields).filter((field) => field !== this.resource.idField);
    const serialized = serializeRow(this.resource, nextRecord);
    const assignments = fields.map((field) => `${quoteIdentifier(field)} = ?`).join(', ');
    this.database.prepare(`UPDATE ${this.table} SET ${assignments} WHERE ${quoteIdentifier(this.resource.idField)} = ?`).run(
      ...fields.map((field) => serialized[field] ?? null),
      String(id),
    );
    return nextRecord;
  }

  async delete(id) {
    const result = this.database.prepare(`DELETE FROM ${this.table} WHERE ${quoteIdentifier(this.resource.idField)} = ?`).run(String(id));
    return result.changes > 0;
  }

  async nextId() {
    const rows = this.database.prepare(`SELECT ${quoteIdentifier(this.resource.idField)} as id FROM ${this.table}`).all();
    const ids = rows.map((row) => String(row.id)).filter(Boolean);
    const numeric = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    let next = numeric.length > 0 ? Math.max(...numeric) + 1 : ids.length + 1;

    while (ids.includes(String(next))) {
      next += 1;
    }

    return String(next);
  }
}

export class SqliteDbDocument {
  constructor(config, resource, database) {
    this.config = config;
    this.resource = resource;
    this.database = database;
  }

  async all() {
    const row = this.database.prepare('SELECT value FROM "_db_documents" WHERE name = ?').get(this.resource.name);
    return row ? JSON.parse(row.value) : {};
  }

  async get(pointer = '') {
    const document = await this.all();
    return pointer ? getPointer(document, pointer) : document;
  }

  async put(value) {
    const nextDocument = stripUnknownFields(this.resource, value);
    assertRecordMatchesResource(nextDocument, this.resource, this.config, {
      source: `${this.resource.name} document body`,
    });
    this.database.prepare('INSERT INTO "_db_documents" (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value')
      .run(this.resource.name, JSON.stringify(nextDocument));
    return nextDocument;
  }

  async set(pointer, value) {
    const document = await this.all();
    setPointer(document, pointer, value);
    await this.put(document);
    return value;
  }

  async update(patch) {
    const document = await this.all();
    return this.put({ ...document, ...patch });
  }
}

function createTableSql(resource) {
  const columns = Object.entries(resource.fields).map(([fieldName, field]) => {
    const primary = fieldName === resource.idField ? ' PRIMARY KEY' : '';
    const required = field.required && fieldName !== resource.idField ? ' NOT NULL' : '';
    return `  ${quoteIdentifier(fieldName)} ${sqliteTypeForField(field)}${primary}${required}`;
  });

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(resource.name)} (
${columns.join(',\n')}
) STRICT;`;
}

function sqliteTypeForField(field) {
  switch (field.type) {
    case 'number':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    case 'string':
    case 'datetime':
    case 'enum':
    case 'object':
    case 'array':
    case 'unknown':
    default:
      return 'TEXT';
  }
}

function stripUnknownFields(resource, record) {
  const next = {};
  for (const fieldName of Object.keys(resource.fields ?? {})) {
    if (record?.[fieldName] !== undefined) {
      next[fieldName] = record[fieldName];
    }
  }
  return next;
}

function serializeRow(resource, record) {
  const row = {};
  for (const [fieldName, field] of Object.entries(resource.fields)) {
    const value = record[fieldName];
    if (value === undefined) {
      row[fieldName] = null;
    } else if (field.type === 'boolean') {
      row[fieldName] = value ? 1 : 0;
    } else if (field.type === 'object' || field.type === 'array' || field.type === 'unknown') {
      row[fieldName] = JSON.stringify(value);
    } else {
      row[fieldName] = value;
    }
  }
  return row;
}

function deserializeRow(resource, row) {
  const record = {};
  for (const [fieldName, field] of Object.entries(resource.fields)) {
    const value = row[fieldName];
    if (value === null || value === undefined) {
      continue;
    }
    if (field.type === 'boolean') {
      record[fieldName] = Boolean(value);
    } else if (field.type === 'object' || field.type === 'array' || field.type === 'unknown') {
      record[fieldName] = typeof value === 'string' ? JSON.parse(value) : value;
    } else {
      record[fieldName] = value;
    }
  }
  return record;
}

async function importNodeSqlite() {
  try {
    return await import('node:sqlite');
  } catch (error) {
    throw sqliteRuntimeUnavailableError(error);
  }
}

function importNodeSqliteSync() {
  try {
    return require('node:sqlite');
  } catch (error) {
    throw sqliteRuntimeUnavailableError(error);
  }
}

function sqliteRuntimeUnavailableError(error) {
  return dbError(
    'SQLITE_RUNTIME_UNAVAILABLE',
    'SQLite store requires Node.js with node:sqlite support.',
    {
      status: 500,
      hint: 'Use Node.js 22.13 or newer for the SQLite store, or keep using the JSON store.',
      details: {
        parserMessage: error.message,
      },
    },
  );
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function getPointer(document, pointer) {
  const parts = parsePointer(pointer);
  let value = document;
  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = value[part];
  }
  return value;
}

function setPointer(document, pointer, value) {
  const parts = parsePointer(pointer);
  let current = document;
  while (parts.length > 1) {
    const part = parts.shift();
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[0]] = value;
}

function parsePointer(pointer) {
  if (!pointer) {
    return [];
  }

  return String(pointer)
    .split('/')
    .slice(1)
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}
