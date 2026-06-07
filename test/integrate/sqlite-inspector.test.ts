import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { inspectSqliteIntegration as typedInspectSqliteIntegration } from '../../src/features/integrate/sqlite-inspector.js';
import { makeProject } from '../helpers.js';

const inspectSqliteIntegration = async (options: unknown): Promise<any> => typedInspectSqliteIntegration(options as never) as Promise<any>;

test('SQLite integration inspector inventories tables and recommends migration paths', async (t) => {
  const DatabaseSync = await databaseSyncOrSkip(t);
  if (!DatabaseSync) return;

  const cwd = await makeProject();
  const sqliteFile = path.join(cwd, 'data/app.sqlite');
  await mkdir(path.dirname(sqliteFile), { recursive: true });
  const database = new DatabaseSync(sqliteFile);
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      ) STRICT;
      CREATE TABLE package_versions (
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL,
        PRIMARY KEY (name, version)
      ) STRICT;
      CREATE TABLE install_events (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        package_name TEXT,
        decision TEXT
      ) STRICT;
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE user_roles (
        user_id TEXT NOT NULL REFERENCES users(id),
        role_id TEXT NOT NULL,
        PRIMARY KEY (user_id, role_id)
      ) STRICT;
      CREATE INDEX users_name_idx ON users(name);
      CREATE VIEW user_dashboard AS SELECT id, name FROM users;
      INSERT INTO users (id, name) VALUES ('u_1', 'Ada');
    `);
  } finally {
    database.close();
  }

  const report = await inspectSqliteIntegration({
    cwd,
    target: '.',
    sqliteFile,
    generatedAt: '2026-06-07T00:00:00.000Z',
  });
  const byName = Object.fromEntries(report.sqlite.tables.map((table) => [table.name, table]));

  assert.equal(report.kind, 'db.integrationReport');
  assert.equal(report.sqlite.path, 'data/app.sqlite');
  assert.equal(report.importPlan, undefined);
  assert.deepEqual(byName.users.primaryKey, ['id']);
  assert.equal(byName.users.classification, 'single-primary-key');
  assert.equal(byName.users.rowCount, 1);
  assert.equal(byName.users.indexes.some((index) => index.name === 'users_name_idx' && index.columns.includes('name')), true);
  assert.equal(byName.package_versions.classification, 'compound-primary-key');
  assert.equal(byName.install_events.classification, 'event-log');
  assert.equal(byName.settings.classification, 'document-settings');
  assert.equal(byName.user_roles.foreignKeys.some((foreignKey) => foreignKey.table === 'users'), true);
  assert.equal(byName.user_dashboard.classification, 'view');
  assert.equal(
    report.recommendations.some((entry) => entry.table === 'users' && entry.kind === 'direct-resource'),
    true,
  );
  assert.equal(
    report.recommendations.some((entry) => (
      entry.table === 'users'
      && entry.adoptionPath?.kind === 'table-backed-adapter'
      && entry.adoptionPath.sourceOfTruth === 'existing-sqlite'
    )),
    true,
  );
  assert.equal(
    report.recommendations.some((entry) => entry.table === 'install_events' && entry.kind === 'read-model'),
    true,
  );
  assert.equal(
    report.suggestions.some((suggestion) => suggestion.table === 'install_events' && suggestion.code === 'INTEGRATE_READ_MODEL_FIRST'),
    true,
  );
  assert.equal(
    report.recommendations.some((entry) => entry.table === 'package_versions' && entry.kind === 'custom-store'),
    true,
  );
  assert.equal(
    report.suggestions.some((suggestion) => (
      suggestion.table === 'package_versions'
      && suggestion.code === 'INTEGRATE_COMPOUND_KEY_USE_OPERATIONS'
      && suggestion.hint.includes('{ name: ..., version: ... }')
    )),
    true,
  );
  assert.equal(
    report.suggestedFiles.some((file) => file.path === 'db/users.schema.jsonc'),
    true,
  );
  assert.equal(
    report.suggestedFiles.some((file) => file.path === 'src/db/usersTableAdapter.ts'),
    true,
  );
  assert.equal(
    report.agentInstructions.some((instruction) => instruction.includes('Keep the existing SQLite file as the write source of truth')),
    true,
  );

  const importReport = await inspectSqliteIntegration({
    cwd,
    target: '.',
    sqliteFile,
    targetState: './data/local-registry.asyncdb',
    generatedAt: '2026-06-07T00:00:00.000Z',
  });
  const importResources = Object.fromEntries(importReport.importPlan.resources.map((resource) => [resource.table, resource]));

  assert.equal(importReport.importPlan.kind, 'sqlite.importPlan');
  assert.equal(importReport.importPlan.target.stateFile, 'data/local-registry.asyncdb');
  assert.equal(importResources.users.keyStrategy.kind, 'single-primary-key');
  assert.equal(importResources.package_versions.keyStrategy.kind, 'compound-generated-id');
  assert.deepEqual(importResources.package_versions.keyStrategy.fields, ['name', 'version']);
  assert.equal(importResources.install_events.importKind, 'append-only');
  assert.equal(importResources.install_events.writePolicy, 'append-only');
  assert.equal(importResources.settings.kind, 'document');
  assert.equal(importResources.settings.keyStrategy.kind, 'key-value-document');
  assert.equal(
    importReport.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_IMPORT_TO_ASYNC_DB_STATE'),
    true,
  );
  assert.equal(
    importReport.suggestions.some((suggestion) => suggestion.table === 'install_events' && suggestion.code === 'INTEGRATE_APPEND_ONLY_EVENT_LOG'),
    true,
  );
});

test('SQLite integration inspector statically detects common SQLite source usage', async (t) => {
  const DatabaseSync = await databaseSyncOrSkip(t);
  if (!DatabaseSync) return;

  const cwd = await makeProject();
  const sqliteFile = path.join(cwd, 'data/app.sqlite');
  await mkdir(path.dirname(sqliteFile), { recursive: true });
  const database = new DatabaseSync(sqliteFile);
  database.exec('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT) STRICT;');
  database.close();

  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await mkdir(path.join(cwd, 'migrations'), { recursive: true });
  await writeFile(path.join(cwd, 'src/db.ts'), `
import { DatabaseSync } from 'node:sqlite';
import Database from 'better-sqlite3';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { drizzle } from 'drizzle-orm/sqlite-core';

const db = new DatabaseSync('app.sqlite');
db.prepare('SELECT * FROM users WHERE id = ?');
void Database;
void sqlite3;
void open;
void drizzle;
`, 'utf8');
  await writeFile(path.join(cwd, 'migrations/0001.sql'), `
CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT);
CREATE INDEX posts_title_idx ON posts(title);
`, 'utf8');

  const report = await inspectSqliteIntegration({
    cwd,
    target: '.',
    sqliteFile,
    generatedAt: '2026-06-07T00:00:00.000Z',
  });
  const kinds = new Set(report.source.matches.map((match) => match.kind));

  assert.equal(report.source.filesWithMatches, 2);
  assert.equal(kinds.has('node-sqlite-import'), true);
  assert.equal(kinds.has('better-sqlite3-import'), true);
  assert.equal(kinds.has('sqlite3-import'), true);
  assert.equal(kinds.has('sqlite-import'), true);
  assert.equal(kinds.has('drizzle-import'), true);
  assert.deepEqual(report.sqlite.drivers.detected, ['node:sqlite', 'better-sqlite3', 'sqlite3', 'sqlite']);
  assert.equal(report.sqlite.drivers.recommended, 'node:sqlite');
  assert.deepEqual(report.sqlite.drivers.ormDetected, ['drizzle']);
  assert.equal(kinds.has('db-facade-file'), true);
  assert.equal(kinds.has('sqlite-open-call'), true);
  assert.equal(kinds.has('prepared-statement'), true);
  assert.equal(kinds.has('schema-or-migration-file'), true);
  assert.equal(kinds.has('create-table-sql'), true);
  assert.equal(kinds.has('create-index-sql'), true);
  assert.equal(
    report.recommendations.some((recommendation) => recommendation.kind === 'manual-review' && recommendation.message.includes('higher-level SQL toolkit')),
    true,
  );
  assert.equal(
    report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_WRAP_EXISTING_DB_FACADE'),
    true,
  );
  assert.equal(
    report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_USE_SQLITE_COMPAT_DRIVER'),
    true,
  );
  assert.equal(
    report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_QUERY_AGGREGATION_API'),
    true,
  );
  assert.equal(
    report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_ORM_MANUAL_REVIEW'),
    true,
  );
});

async function databaseSyncOrSkip(t: TestContext): Promise<any> {
  try {
    const sqlite = await import('node:sqlite') as any;
    return sqlite.DatabaseSync;
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return null;
  }
}
