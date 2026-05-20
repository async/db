export function renderSqliteAdapter(project, options) {
  const seedImport = options.seed === 'fixtures' ? "import { seedData } from './schema.js';\n" : '';
  const seedCall = options.seed === 'fixtures' ? '\n  seedFixtures(db);\n' : '';
  const seedFunction = options.seed === 'fixtures' ? `
function seedFixtures(db: DatabaseSync) {
  for (const [resourceName, seed] of Object.entries<any>(seedData)) {
    const resource = (resources as Record<string, any>)[resourceName];
    if (!resource) {
      continue;
    }
    if (resource.kind === 'collection') {
      const count = db.prepare('SELECT COUNT(*) as count FROM ' + quoteIdentifier(resourceName)).get() as { count: number };
      if (count.count > 0) {
        continue;
      }
      const collection = collectionRepository(db, resourceName);
      for (const record of seed) {
        collection.create(record);
      }
    } else {
      const existing = db.prepare('SELECT name FROM _jsondb_documents WHERE name = ?').get(resourceName);
      if (!existing) {
        documentRepository(db, resourceName).put(seed);
      }
    }
  }
}
` : '';

  return `${generatedHeader()}
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resources } from './schema.js';
${seedImport}import type { CollectionRepository, DocumentRepository, JsonDbRepository } from './repository.js';
import { applyDefaults, stripUnknownFields, validateRecord } from './validators.js';

export function openSqliteRepository(file = process.env.DATABASE_FILE || './data/app.sqlite'): JsonDbRepository {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  migrate(db);${seedCall}
  return {
    resources,
    collection(name: string) {
      return collectionRepository(db, name);
    },
    document(name: string) {
      return documentRepository(db, name);
    },
    close() {
      db.close();
    },
  };
}

export function migrate(db: DatabaseSync) {
${renderMigrationExecLines(project.resources)}
}

function collectionRepository(db: DatabaseSync, resourceName: string): CollectionRepository {
  const resource = requireResource(resourceName, 'collection');
  const table = quoteIdentifier(resource.name);
  const fields = Object.keys(resource.fields);
  const idField = resource.idField || 'id';

  return {
    async all() {
      return (db.prepare('SELECT * FROM ' + table).all() as Record<string, unknown>[]).map((row) => deserializeRow(resourceName, row));
    },
    async get(id) {
      const row = db.prepare('SELECT * FROM ' + table + ' WHERE ' + quoteIdentifier(idField) + ' = ?').get(String(id)) as Record<string, unknown> | undefined;
      return row ? deserializeRow(resourceName, row) : null;
    },
    async create(record) {
      const next = applyDefaults(resourceName, stripUnknownFields(resourceName, { ...record }));
      if (next[idField] === undefined || next[idField] === null || next[idField] === '') {
        next[idField] = nextId(db, table, idField);
      }
      validateRecord(resourceName, next);
      const serialized = serializeRow(resourceName, next);
      const columns = fields.map(quoteIdentifier).join(', ');
      const placeholders = fields.map(() => '?').join(', ');
      db.prepare('INSERT INTO ' + table + ' (' + columns + ') VALUES (' + placeholders + ')').run(...fields.map((field) => serialized[field] ?? null));
      return next;
    },
    async patch(id, patch) {
      const existing = await this.get(id);
      if (!existing) {
        return null;
      }
      const next = stripUnknownFields(resourceName, { ...existing, ...patch, [idField]: existing[idField] });
      validateRecord(resourceName, next);
      const serialized = serializeRow(resourceName, next);
      const updateFields = fields.filter((field) => field !== idField);
      const assignments = updateFields.map((field) => quoteIdentifier(field) + ' = ?').join(', ');
      db.prepare('UPDATE ' + table + ' SET ' + assignments + ' WHERE ' + quoteIdentifier(idField) + ' = ?').run(...updateFields.map((field) => serialized[field] ?? null), String(id));
      return next;
    },
    async delete(id) {
      const result = db.prepare('DELETE FROM ' + table + ' WHERE ' + quoteIdentifier(idField) + ' = ?').run(String(id));
      return result.changes > 0;
    },
  };
}

function documentRepository(db: DatabaseSync, resourceName: string): DocumentRepository {
  const resource = requireResource(resourceName, 'document');
  return {
    async all() {
      const row = db.prepare('SELECT value FROM _jsondb_documents WHERE name = ?').get(resource.name) as { value: string } | undefined;
      return row ? JSON.parse(row.value) : {};
    },
    async put(value) {
      const next = stripUnknownFields(resourceName, value);
      validateRecord(resourceName, next);
      db.prepare('INSERT INTO _jsondb_documents (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(resource.name, JSON.stringify(next));
      return next;
    },
    async patch(value) {
      const existing = await this.all();
      return this.put({ ...existing, ...value });
    },
  };
}

function serializeRow(resourceName: string, record: Record<string, unknown>) {
  const resource = requireResource(resourceName, 'collection');
  const row: Record<string, unknown> = {};
  for (const [fieldName, field] of Object.entries<any>(resource.fields)) {
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

function deserializeRow(resourceName: string, row: Record<string, unknown>) {
  const resource = requireResource(resourceName, 'collection');
  const record: Record<string, unknown> = {};
  for (const [fieldName, field] of Object.entries<any>(resource.fields)) {
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

function nextId(db: DatabaseSync, table: string, idField: string) {
  const rows = db.prepare('SELECT ' + quoteIdentifier(idField) + ' as id FROM ' + table).all() as Array<{ id: string }>;
  const ids = rows.map((row) => String(row.id)).filter(Boolean);
  const numeric = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
  let next = numeric.length > 0 ? Math.max(...numeric) + 1 : ids.length + 1;
  while (ids.includes(String(next))) {
    next += 1;
  }
  return String(next);
}

function requireResource(resourceName: string, kind: 'collection' | 'document') {
  const resource = resolveResource(resourceName);
  if (!resource || resource.kind !== kind) {
    throw new Error('Unknown ' + kind + ' resource "' + resourceName + '". Tried: ' + resourceNameCandidates(resourceName).join(', ') + '.');
  }
  return resource;
}

function resolveResource(resourceName: string) {
  for (const candidate of resourceNameCandidates(resourceName)) {
    const resource = (resources as Record<string, any>)[candidate];
    if (resource) {
      return resource;
    }
  }
  return null;
}

function resourceNameCandidates(value: string) {
  const exact = String(value);
  return [...new Set([exact, camelCase(exact), kebabCase(exact)])];
}

function camelCase(value: string) {
  return words(value).map((word, index) => (
    index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
  )).join('');
}

function kebabCase(value: string) {
  return words(value).join('-');
}

function words(value: string) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function quoteIdentifier(value: string) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}
${seedFunction}`;
}

export function renderInitialMigration(resources) {
  return `${generatedHeader('--')}${resources.map((resource) => (
    resource.kind === 'collection'
      ? createTableSql(resource)
      : null
  )).filter(Boolean).join('\n\n')}

CREATE TABLE IF NOT EXISTS "_jsondb_documents" (
  "name" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
) STRICT;
`;
}

function renderMigrationExecLines(resources) {
  const sql = renderInitialMigration(resources).split('\n').filter((line) => !line.startsWith('--')).join('\n');
  return `  db.exec(${JSON.stringify(sql)});`;
}

function createTableSql(resource) {
  const columns = Object.entries(resource.fields).map(([fieldName, field]) => {
    const type = sqliteTypeForField(field);
    const primary = fieldName === resource.idField ? ' PRIMARY KEY' : '';
    const required = field.required && fieldName !== resource.idField ? ' NOT NULL' : '';
    return `  ${quoteIdentifier(fieldName)} ${type}${primary}${required}`;
  });

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(resource.name)} (\n${columns.join(',\n')}\n) STRICT;`;
}

function sqliteTypeForField(field) {
  switch (field.type) {
    case 'number':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    case 'object':
    case 'array':
    case 'unknown':
      return 'TEXT';
    case 'string':
    case 'enum':
    default:
      return 'TEXT';
  }
}

function generatedHeader(comment = '//') {
  return `${comment} This file is generated by jsondb. Edit it freely after generation.\n`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
