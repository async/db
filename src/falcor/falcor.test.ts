import assert from 'node:assert/strict';
import test from 'node:test';
import { openDb } from '../index.js';
import { makeProject, writeFixture } from '../../test/helpers.js';
import { handleFalcorRequest as typedHandleFalcorRequest } from './http.js';

const handleFalcorRequest = async (...args: any[]): Promise<void> => typedHandleFalcorRequest(args[0] as never, args[1] as never, args[2] as never);

test('Falcor get returns collection refs, by-id fields, path sets, and documents', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada', email: 'ada@example.com' },
    { id: 'u_2', name: 'Grace', email: 'grace@example.com' },
  ]));
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleFalcorRequest(
    db,
    makeRequest('POST', {
      method: 'get',
      paths: [
        ['users', 'length'],
        ['users', { from: 0, to: 1 }, 'name'],
        ['usersById', 'u_1', 'email'],
        ['settings', 'theme'],
      ],
    }),
    response,
  );

  assert.equal(response.status, 200);
  assert.equal(response.json().jsonGraph.users.length, 2);
  assert.deepEqual(response.json().jsonGraph.users[0], { $type: 'ref', value: ['usersById', 'u_1'] });
  assert.deepEqual(response.json().jsonGraph.users[1], { $type: 'ref', value: ['usersById', 'u_2'] });
  assert.equal(response.json().jsonGraph.usersById.u_1.name, 'Ada');
  assert.equal(response.json().jsonGraph.usersById.u_1.email, 'ada@example.com');
  assert.equal(response.json().jsonGraph.usersById.u_2.name, 'Grace');
  assert.equal(response.json().jsonGraph.settings.theme, 'light');
});

test('Falcor set updates collection fields and document paths', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada', profile: { title: 'Admin' } },
  ]));
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleFalcorRequest(
    db,
    makeRequest('POST', {
      method: 'set',
      jsonGraph: {
        usersById: {
          u_1: {
            name: 'Ada Lovelace',
            profile: {
              title: { $type: 'atom', value: 'Founder' },
            },
          },
        },
        settings: {
          theme: 'dark',
        },
      },
    }),
    response,
  );

  assert.equal(response.status, 200);
  assert.equal(response.json().jsonGraph.usersById.u_1.name, 'Ada Lovelace');
  assert.equal(response.json().jsonGraph.usersById.u_1.profile.title, 'Founder');
  assert.equal(response.json().jsonGraph.settings.theme, 'dark');
  assert.deepEqual(await db.collection('users').get('u_1'), {
    id: 'u_1',
    name: 'Ada Lovelace',
    profile: {
      title: 'Founder',
    },
  });
  assert.deepEqual(await db.document('settings').all(), {
    theme: 'dark',
  });

  const replaceResponse = makeResponse();
  await handleFalcorRequest(
    db,
    makeRequest('POST', {
      method: 'set',
      jsonGraph: {
        settings: {
          $type: 'atom',
          value: {
            theme: 'contrast',
            density: 'compact',
          },
        },
      },
    }),
    replaceResponse,
  );

  assert.equal(replaceResponse.status, 200);
  assert.deepEqual(replaceResponse.json().jsonGraph.settings, {
    theme: 'contrast',
    density: 'compact',
  });
  assert.deepEqual(await db.document('settings').all(), {
    theme: 'contrast',
    density: 'compact',
  });
});

test('Falcor call executes registered operations', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada', email: 'ada@example.com' },
  ]));

  const db = await openDb({
    cwd,
    operations: {
      enabled: true,
      registry: {
        'users.get': {
          name: 'GetUser',
          method: 'GET',
          path: '/users/{id}.json',
          query: {
            select: 'id,name',
          },
        },
      },
    },
  });
  const response = makeResponse();

  await handleFalcorRequest(
    db,
    makeRequest('POST', {
      method: 'call',
      callPath: ['operations', 'users.get'],
      arguments: [{ id: 'u_1' }],
    }),
    response,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json().jsonGraph.operations['users.get'].result, {
    id: 'u_1',
    name: 'Ada',
  });
});

function makeRequest(method: string, body: unknown = undefined) {
  return {
    method,
    url: '/model.json',
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
  };
}

function makeResponse() {
  return {
    status: null as number | null,
    headers: {} as Record<string, unknown>,
    body: '',
    writeHead(status: number, headers: Record<string, unknown> = {}) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += chunk;
    },
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}
