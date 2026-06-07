import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { inspectPostgresIntegration } from '../../src/features/integrate/postgres-inspector.js';
import { makeProject } from '../helpers.js';

test('postgres inspect emits source-only guidance without a URL', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await writeFile(path.join(cwd, 'src/db.ts'), `
import { Pool } from 'pg';
import postgres from 'postgres';
import { PrismaClient } from '@prisma/client';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export async function listUsers() {
  return pool.query('SELECT * FROM users WHERE active = $1', [true]);
}
`, 'utf8');

  const report = await inspectPostgresIntegration({
    cwd,
    target: 'src',
    generatedAt: '2026-06-07T00:00:00.000Z',
  });

  assert.equal(report.postgres.mode, 'source-only');
  assert.deepEqual(report.postgres.catalog.tables, []);
  assert.deepEqual(report.postgres.drivers.detected, ['pg', 'postgres']);
  assert.deepEqual(report.postgres.drivers.ormDetected, ['prisma']);
  assert.ok(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_KEEP_EXISTING_POSTGRES_SOURCE'));
  assert.ok(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_USE_POSTGRES_COMPAT_DRIVER'));
  assert.ok(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_POSTGRES_ORM_MANUAL_REVIEW'));
});

test('postgres inspect classifies catalog tables and import plans', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await writeFile(path.join(cwd, 'src/db.ts'), `
import { Pool } from 'pg';
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
`, 'utf8');
  process.env.TEST_POSTGRES_URL = 'postgres://user:secret@example.test/app';
  const client = new FakeCatalogClient();

  try {
    const report = await inspectPostgresIntegration({
      cwd,
      target: 'src',
      client,
      postgresUrlEnv: 'TEST_POSTGRES_URL',
      schemas: ['public'],
      targetPostgresTable: 'public._async_db_resources',
      generatedAt: '2026-06-07T00:00:00.000Z',
    });

    assert.equal(report.postgres.mode, 'catalog');
    assert.equal(report.postgres.connectionStringEnv, 'TEST_POSTGRES_URL');
    assert.equal(JSON.stringify(report).includes('secret'), false);
    assert.equal(report.importPlan?.kind, 'postgres.importPlan');
    assert.equal(report.importPlan?.target.kind, 'postgres-envelope');

    const byName = new Map(report.postgres.catalog.tables.map((table) => [table.name, table]));
    assert.equal(byName.get('users')?.classification, 'single-primary-key');
    assert.equal(byName.get('package_versions')?.classification, 'compound-primary-key');
    assert.equal(byName.get('install_events')?.classification, 'event-log');
    assert.equal(byName.get('settings')?.classification, 'document-settings');
    assert.equal(byName.get('secure_accounts')?.classification, 'rls-protected');
    assert.equal(byName.get('dashboard_stats')?.classification, 'view');
    assert.equal(byName.get('rollup_stats')?.classification, 'materialized-view');

    assert.ok(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_POSTGRES_TABLE_ADAPTER_CANDIDATE' && suggestion.table === 'public.users'));
    assert.ok(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_POSTGRES_OBJECT_KEY_OPERATIONS' && suggestion.table === 'public.package_versions'));
    assert.ok(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_POSTGRES_APPEND_ONLY_EVENT_LOG' && suggestion.table === 'public.install_events'));
    assert.ok(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_IMPORT_TO_POSTGRES_STORE'));

    const packageResource = report.importPlan?.resources.find((resource) => resource.table === 'package_versions');
    assert.deepEqual(packageResource?.keyStrategy, {
      kind: 'compound-generated-id',
      fields: ['name', 'version'],
      idField: 'id',
    });
    const events = report.importPlan?.resources.find((resource) => resource.table === 'install_events');
    assert.equal(events?.importKind, 'append-only');
    const settings = report.importPlan?.resources.find((resource) => resource.table === 'settings');
    assert.equal(settings?.kind, 'document');
  } finally {
    delete process.env.TEST_POSTGRES_URL;
  }
});

test('postgres inspect emits partial catalog reports when allowed', async () => {
  const cwd = await makeProject();
  const report = await inspectPostgresIntegration({
    cwd,
    postgresUrlEnv: 'MISSING_POSTGRES_URL',
    allowPartial: true,
    generatedAt: '2026-06-07T00:00:00.000Z',
  });

  assert.equal(report.postgres.mode, 'partial');
  assert.equal(report.postgres.errors[0].message.includes('MISSING_POSTGRES_URL'), true);
  assert.ok(report.suggestions.some((suggestion) => suggestion.code === 'INTEGRATE_POSTGRES_CATALOG_PARTIAL'));
});

class FakeCatalogClient {
  async query(sql) {
    if (sql.includes('FROM information_schema.tables')) {
      return {
        rows: [
          { table_schema: 'public', table_name: 'users', table_type: 'BASE TABLE' },
          { table_schema: 'public', table_name: 'package_versions', table_type: 'BASE TABLE' },
          { table_schema: 'public', table_name: 'install_events', table_type: 'BASE TABLE' },
          { table_schema: 'public', table_name: 'settings', table_type: 'BASE TABLE' },
          { table_schema: 'public', table_name: 'secure_accounts', table_type: 'BASE TABLE' },
          { table_schema: 'public', table_name: 'dashboard_stats', table_type: 'VIEW' },
        ],
      };
    }
    if (sql.includes('FROM pg_catalog.pg_matviews')) {
      return {
        rows: [
          { table_schema: 'public', table_name: 'rollup_stats', table_type: 'MATERIALIZED VIEW' },
        ],
      };
    }
    if (sql.includes('FROM information_schema.columns')) {
      return {
        rows: [
          column('users', 'id', 'text', false),
          column('users', 'email', 'text', false),
          column('package_versions', 'name', 'text', false),
          column('package_versions', 'version', 'text', false),
          column('package_versions', 'status', 'text', true),
          column('install_events', 'id', 'bigint', false),
          column('install_events', 'package_name', 'text', true),
          column('install_events', 'created_at', 'timestamp with time zone', true),
          column('settings', 'key', 'text', false),
          column('settings', 'value', 'jsonb', true),
          column('secure_accounts', 'id', 'uuid', false),
          column('secure_accounts', 'tenant_id', 'uuid', false),
          column('dashboard_stats', 'status', 'text', true),
          column('dashboard_stats', 'count', 'bigint', true),
          column('rollup_stats', 'status', 'text', true),
          column('rollup_stats', 'count', 'bigint', true),
        ],
      };
    }
    if (sql.includes("tc.constraint_type = 'PRIMARY KEY'")) {
      return {
        rows: [
          pk('users', 'id', 1),
          pk('package_versions', 'name', 1),
          pk('package_versions', 'version', 2),
          pk('install_events', 'id', 1),
          pk('settings', 'key', 1),
          pk('secure_accounts', 'id', 1),
        ],
      };
    }
    if (sql.includes('FROM pg_catalog.pg_indexes')) {
      return {
        rows: [
          {
            table_schema: 'public',
            table_name: 'users',
            index_name: 'users_email_key',
            indexdef: 'CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)',
          },
        ],
      };
    }
    if (sql.includes("tc.constraint_type = 'FOREIGN KEY'")) {
      return { rows: [] };
    }
    if (sql.includes('FROM information_schema.triggers')) {
      return { rows: [] };
    }
    if (sql.includes('FROM pg_catalog.pg_policies')) {
      return {
        rows: [
          { table_schema: 'public', table_name: 'secure_accounts', policyname: 'tenant_isolation', cmd: 'ALL' },
        ],
      };
    }
    if (sql.includes('FROM pg_catalog.pg_class')) {
      return {
        rows: [
          estimate('users', 10),
          estimate('package_versions', 50),
          estimate('install_events', 500),
          estimate('settings', 5),
          estimate('secure_accounts', 20),
        ],
      };
    }
    throw new Error(`Unhandled fake catalog query: ${sql}`);
  }
}

function column(table, name, type, nullable) {
  return {
    table_schema: 'public',
    table_name: table,
    column_name: name,
    data_type: type,
    is_nullable: nullable ? 'YES' : 'NO',
    column_default: null,
    is_generated: 'NEVER',
    identity_generation: null,
  };
}

function pk(table, columnName, position) {
  return {
    table_schema: 'public',
    table_name: table,
    column_name: columnName,
    ordinal_position: position,
  };
}

function estimate(table, estimatedRows) {
  return {
    table_schema: 'public',
    table_name: table,
    estimated_rows: estimatedRows,
  };
}
