import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  generateSchemaMigrationOutputs,
  inspectSchemaMigration,
} from '../../src/features/schema/migration.js';
import { generateSchemaManifest, generateTypes, loadDbSchema } from '../../src/index.js';
import { makeProject, writeFixture } from '../helpers.js';

test('schema migration inspect maps Prisma, SQL, Drizzle, and OpenAPI schema declarations', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'prisma'), { recursive: true });
  await mkdir(path.join(cwd, 'migrations'), { recursive: true });
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await writeFile(path.join(cwd, 'prisma/schema.prisma'), `
enum Role {
  ADMIN
  USER
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  role      Role     @default(USER)
  updatedAt DateTime @updatedAt
}
`, 'utf8');
  await writeFile(path.join(cwd, 'migrations/001.sql'), `
CREATE TABLE audit_events (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  updated_at TIMESTAMP
);

CREATE TRIGGER audit_events_touch BEFORE UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
`, 'utf8');
  await writeFile(path.join(cwd, 'src/schema.ts'), `
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()),
});
`, 'utf8');
  await writeFile(path.join(cwd, 'openapi.json'), JSON.stringify({
    openapi: '3.1.0',
    components: {
      schemas: {
        Project: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string', minLength: 2 },
          },
        },
      },
    },
  }), 'utf8');

  const report = await inspectSchemaMigration({ cwd, target: '.', generatedAt: '2026-06-07T00:00:00.000Z' });

  assert.equal(report.kind, 'db.schemaMigrationReport');
  assert.equal(report.source.filesScanned >= 4, true);
  assert.equal(report.resources.some((resource) => resource.source.kind === 'prisma'), true);
  assert.equal(report.resources.some((resource) => resource.source.kind === 'sql'), true);
  assert.equal(report.resources.some((resource) => resource.source.kind === 'drizzle'), true);
  assert.equal(report.resources.some((resource) => resource.source.kind === 'openapi'), true);

  const users = report.resources.find((resource) => resource.name === 'users');
  assert.equal(users?.idField, 'id');
  assert.equal(users?.fields.id.derived?.kind, 'generated-default');
  assert.equal(users?.fields.updatedAt.derived?.kind, 'updated-at');
  assert.deepEqual(users?.fields.role.values, ['ADMIN', 'USER']);

  const auditEvents = report.resources.find((resource) => resource.name === 'auditEvents');
  assert.equal(auditEvents?.fields.id.derived?.kind, 'identity');
  assert.equal(auditEvents?.fields.updatedAt.derived?.kind, 'trigger');

  const teams = report.resources.find((resource) => resource.name === 'teams');
  assert.equal(teams?.fields.name.required, true);
  assert.equal(teams?.fields.name.unique, true);
  assert.equal(teams?.fields.updatedAt.derived?.owner, 'drizzle');

  const projects = report.resources.find((resource) => resource.name === 'projects');
  assert.equal(projects?.fields.name.minLength, 2);
});

test('schema migration generate writes JSONC drafts and preserves executable validators in mixed mode', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await writeFile(path.join(cwd, 'src/user-schema.ts'), `
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().min(3),
}).refine((value) => value.email.includes('@'));
`, 'utf8');

  const report = await inspectSchemaMigration({ cwd, target: './src', generatedAt: '2026-06-07T00:00:00.000Z' });
  const users = report.resources.find((resource) => resource.name === 'users');
  assert.equal(users?.output.format, 'schema-module');
  assert.equal(users?.output.requiresExecutable, true);

  const mixed = await generateSchemaMigrationOutputs({ cwd, plan: report, schemaDir: './db' });
  assert.deepEqual(mixed.files, ['db/users.schema.mjs']);
  const moduleContent = await readFile(path.join(cwd, 'db/users.schema.mjs'), 'utf8');
  assert.match(moduleContent, /validator: migratedValidator/);
  assert.match(moduleContent, /from '\.\.\/src\/user-schema\.js'/);

  const jsonOnly = await generateSchemaMigrationOutputs({
    cwd,
    plan: report,
    schemaDir: './json-only',
    format: 'jsonc',
  });
  assert.deepEqual(jsonOnly.files, ['json-only/users.schema.jsonc']);
  assert.equal(jsonOnly.diagnostics.some((diagnostic) => diagnostic.code === 'SCHEMA_MIGRATION_EXECUTABLE_DROPPED'), true);
});

test('derived fields normalize as read-only schema metadata without becoming computed fields', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', JSON.stringify({
    kind: 'collection',
    idField: 'id',
    fields: {
      id: { type: 'string', required: true },
      updatedAt: {
        type: 'datetime',
        derived: {
          source: 'database',
          kind: 'trigger',
        },
      },
    },
  }));

  const schema = await loadDbSchema({ from: cwd });
  const field = schema.resource('users').fields.updatedAt;
  assert.equal(field.readOnly, true);
  assert.equal(field.computed, undefined);
  assert.equal(field.derived.kind, 'trigger');

  const invalid = schema.validator('users').validate({
    id: 'u_1',
    updatedAt: '2026-06-07T00:00:00.000Z',
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors[0].code, 'FIELD_READ_ONLY');
  assert.match(invalid.errors[0].hint, /derived/);

  const manifest = await generateSchemaManifest({ cwd, sourceDir: path.join(cwd, 'db') } as any);
  assert.equal((manifest.manifest.collections.users as any).fields.updatedAt.derived.kind, 'trigger');

  const generatedTypes = await generateTypes({ cwd, sourceDir: path.join(cwd, 'db') } as any);
  assert.match(generatedTypes.content, /updatedAt\?: string;/);
});
