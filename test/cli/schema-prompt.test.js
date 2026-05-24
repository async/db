import assert from 'node:assert/strict';
import test from 'node:test';
import { promptForSchemaTarget } from '../../src/cli/schema-prompt.js';

test('schema target prompt can choose all schemas', async () => {
  const result = await promptForSchemaTarget({
    command: 'bundle',
    resources: ['users', 'posts'],
    isInteractive: true,
    ask: async () => '1',
    write() {},
  });

  assert.deepEqual(result, { all: true });
});

test('schema target prompt can choose a resource', async () => {
  const result = await promptForSchemaTarget({
    command: 'unbundle',
    resources: ['users', 'posts'],
    isInteractive: true,
    ask: async () => '2',
    write() {},
  });

  assert.deepEqual(result, { resourceName: 'users' });
});

test('schema target prompt retries invalid choices', async () => {
  const answers = ['unknown', '3'];
  let output = '';
  const result = await promptForSchemaTarget({
    command: 'bundle',
    resources: ['users', 'posts'],
    isInteractive: true,
    ask: async () => answers.shift(),
    write(text) {
      output += text;
    },
  });

  assert.deepEqual(result, { resourceName: 'posts' });
  assert.match(output, /Invalid selection/);
});

test('schema target prompt returns undefined on cancellation', async () => {
  const result = await promptForSchemaTarget({
    command: 'bundle',
    resources: ['users'],
    isInteractive: true,
    ask: async () => 'q',
    write() {},
  });

  assert.equal(result, undefined);
});
