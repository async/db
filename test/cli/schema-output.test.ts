import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  preflightSchemaOutput,
  schemaOutputContentMatches,
  writeSchemaOutput,
} from '../../src/cli/commands/schema/output.js';
import { makeProject } from '../helpers.js';

test('schema output content matching treats equivalent JSON as unchanged', () => {
  assert.equal(
    schemaOutputContentMatches('[{"name":"Ada","id":"u_1"}]\n', '[\n  {\n    "id": "u_1",\n    "name": "Ada"\n  }\n]\n'),
    true,
  );
});

test('schema output preflight skips semantically matching JSON output', async () => {
  const cwd = await makeProject();
  const output = path.join(cwd, 'artifacts/users.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, '[{"name":"Ada","id":"u_1"}]\n', 'utf8');

  const result = await preflightSchemaOutput(
    output,
    '[\n  {\n    "id": "u_1",\n    "name": "Ada"\n  }\n]\n',
    { cwd },
  );

  assert.deepEqual(result, { shouldWrite: false });
});

test('schema output preflight reports configured conflict diagnostics', async () => {
  const cwd = await makeProject();
  const output = path.join(cwd, 'artifacts/users.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, '[{"id":"u_1","name":"Ada"}]\n', 'utf8');

  await assert.rejects(
    () => preflightSchemaOutput(
      output,
      '[{"id":"u_2","name":"Grace"}]\n',
      { cwd },
      {
        command: 'schema bundle --all',
        existsCode: 'SCHEMA_BUNDLE_SEED_OUTPUT_EXISTS',
        existsHint: 'Choose a different seed output.',
        resource: 'users',
      },
    ),
    (error: unknown) => {
      const diagnostic = error as {
        code?: string;
        details?: Record<string, unknown>;
        hint?: string;
        message?: string;
      };
      assert.equal(diagnostic.code, 'SCHEMA_BUNDLE_SEED_OUTPUT_EXISTS');
      assert.match(diagnostic.message ?? '', /artifacts\/users\.json already exists with different content/);
      assert.equal(diagnostic.hint, 'Choose a different seed output.');
      assert.deepEqual(diagnostic.details, {
        command: 'schema bundle --all',
        resource: 'users',
        file: 'artifacts/users.json',
        severity: 'error',
      });
      return true;
    },
  );
});

test('schema output write creates output and reports whether it wrote', async () => {
  const cwd = await makeProject();
  const output = path.join(cwd, 'artifacts/users.json');
  await mkdir(path.dirname(output), { recursive: true });

  const wrote = await writeSchemaOutput(output, '[{"id":"u_1"}]\n', { cwd });

  assert.equal(wrote, true);
  assert.equal(await readFile(output, 'utf8'), '[{"id":"u_1"}]\n');
});
