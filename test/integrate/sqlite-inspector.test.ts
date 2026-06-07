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
    report.recommendations.some((entry) => entry.table === 'install_events' && entry.kind === 'read-model'),
    true,
  );
  assert.equal(
    report.recommendations.some((entry) => entry.table === 'package_versions' && entry.kind === 'custom-store'),
    true,
  );
  assert.equal(
    report.suggestedFiles.some((file) => file.path === 'db/users.schema.jsonc'),
    true,
  );
  assert.equal(
    report.agentInstructions.some((instruction) => instruction.includes('Start with read-only integration')),
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
import { drizzle } from 'drizzle-orm/sqlite-core';

const db = new DatabaseSync('app.sqlite');
db.prepare('SELECT * FROM users WHERE id = ?');
void Database;
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
  assert.equal(kinds.has('drizzle-import'), true);
  assert.equal(kinds.has('sqlite-open-call'), true);
  assert.equal(kinds.has('prepared-statement'), true);
  assert.equal(kinds.has('schema-or-migration-file'), true);
  assert.equal(kinds.has('create-table-sql'), true);
  assert.equal(kinds.has('create-index-sql'), true);
  assert.equal(
    report.recommendations.some((recommendation) => recommendation.kind === 'manual-review' && recommendation.message.includes('higher-level SQL toolkit')),
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
