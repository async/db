import assert from 'node:assert/strict';
import test from 'node:test';
import { createViewerEventHub } from './request-handler.js';

type SseTestResponse = {
  status: number | null;
  chunks: string[];
  body: string;
  destroyed: boolean;
  writableEnded: boolean;
  failWrites: boolean;
  writeHead(status: number, headers?: Record<string, unknown>): void;
  write(chunk: string): boolean;
  end(chunk?: string): void;
  on(event: string, listener: () => void): void;
  json(): unknown;
};

function makeSseResponse(): SseTestResponse {
  return {
    status: null,
    chunks: [],
    body: '',
    destroyed: false,
    writableEnded: false,
    failWrites: false,
    writeHead(status) {
      this.status = status;
    },
    write(chunk: string) {
      if (this.failWrites) {
        throw new Error('broken pipe');
      }
      this.chunks.push(chunk);
      return true;
    },
    end(chunk = '') {
      this.body += chunk;
      this.writableEnded = true;
    },
    on() {},
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}

function makeSseRequest() {
  return {
    on() {},
  };
}

function makeSseDb(maxEventClients?: number) {
  return {
    config: {
      server: maxEventClients === undefined ? {} : { maxEventClients },
    },
    resources: new Map(),
    diagnostics: [],
    schemaVersion: 1,
  };
}

test('viewer event hub limits concurrent subscribers with a clear error', () => {
  const hub = createViewerEventHub();
  const db = makeSseDb(1);
  try {
    const first = makeSseResponse();
    hub.subscribe(makeSseRequest() as never, first as never, db as never);
    assert.equal(first.status, 200);
    assert.equal(first.chunks.some((chunk) => chunk.includes('"type":"connected"')), true);

    const second = makeSseResponse();
    hub.subscribe(makeSseRequest() as never, second as never, db as never);
    assert.equal(second.status, 503);
    const error = (second.json() as { error: { code: string; hint: string; details: { maxEventClients: number } } }).error;
    assert.equal(error.code, 'VIEWER_EVENTS_LIMIT');
    assert.match(error.hint, /maxEventClients/);
    assert.equal(error.details.maxEventClients, 1);
  } finally {
    hub.close();
  }
});

test('viewer event hub drops broken clients instead of failing publishes', () => {
  const hub = createViewerEventHub();
  const db = makeSseDb(1);
  try {
    const broken = makeSseResponse();
    hub.subscribe(makeSseRequest() as never, broken as never, db as never);
    broken.failWrites = true;

    // Publishing to a client whose socket fails must not throw, and must free
    // its subscriber slot for the next viewer.
    hub.publish({ type: 'sync' });

    const replacement = makeSseResponse();
    hub.subscribe(makeSseRequest() as never, replacement as never, db as never);
    assert.equal(replacement.status, 200);

    hub.publish({ type: 'sync' });
    assert.equal(replacement.chunks.some((chunk) => chunk.includes('"type":"sync"')), true);
  } finally {
    hub.close();
  }
});

test('viewer event hub skips clients that already ended', () => {
  const hub = createViewerEventHub();
  const db = makeSseDb();
  try {
    const ended = makeSseResponse();
    hub.subscribe(makeSseRequest() as never, ended as never, db as never);
    ended.writableEnded = true;
    const before = ended.chunks.length;

    hub.publish({ type: 'sync' });
    assert.equal(ended.chunks.length, before);
  } finally {
    hub.close();
  }
});

function makeHandlerResponse() {
  return {
    status: null as number | null,
    headers: {} as Record<string, unknown>,
    body: '',
    setHeader(name: string, value: unknown) {
      this.headers[String(name).toLowerCase()] = value;
    },
    writeHead(status: number, headers: Record<string, unknown> = {}) {
      this.status = status;
      this.headers = { ...this.headers, ...headers };
    },
    write() {
      return true;
    },
    end(chunk = '') {
      this.body += chunk;
    },
    on() {},
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}

function makeHandlerRequest(method: string, url: string, headers: Record<string, unknown> = {}) {
  return {
    method,
    url,
    headers,
    on() {},
  };
}

function makeHandlerDb(server: Record<string, unknown> = {}) {
  return {
    config: {
      rest: { enabled: true },
      server,
    },
    resources: new Map(),
    diagnostics: [],
    schemaVersion: 7,
  };
}

test('health endpoint reports ok status and counts without a state dir', async () => {
  const { createDbRequestHandler } = await import('./request-handler.js');
  const handler = createDbRequestHandler(makeHandlerDb() as never);
  const response = makeHandlerResponse();

  const handled = await handler(makeHandlerRequest('GET', '/__db/health') as never, response as never);
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  const body = response.json() as { status: string; schemaVersion: number; resources: number; state: { writable: null } };
  assert.equal(body.status, 'ok');
  assert.equal(body.schemaVersion, 7);
  assert.equal(body.resources, 0);
  assert.equal(body.state.writable, null);
});

test('health endpoint honors its own exposure policy', async () => {
  const { createDbRequestHandler } = await import('./request-handler.js');
  const handler = createDbRequestHandler(makeHandlerDb({ expose: { health: false } }) as never);
  const response = makeHandlerResponse();

  await handler(makeHandlerRequest('GET', '/__db/health') as never, response as never);
  assert.equal(response.status, 404);
  assert.equal((response.json() as { error: { code: string } }).error.code, 'HEALTH_DISABLED');
});

test('server.authorize denies, customizes, and allows handled requests', async () => {
  const { createDbRequestHandler } = await import('./request-handler.js');

  const denied = makeHandlerResponse();
  await createDbRequestHandler(makeHandlerDb({ authorize: () => false }) as never)(
    makeHandlerRequest('GET', '/__db/health') as never,
    denied as never,
  );
  assert.equal(denied.status, 403);
  assert.equal((denied.json() as { error: { code: string } }).error.code, 'SERVER_AUTHORIZATION_DENIED');

  const challenged = makeHandlerResponse();
  await createDbRequestHandler(makeHandlerDb({
    authorize: () => ({ status: 401, body: { error: { code: 'NEEDS_TOKEN' } } }),
  }) as never)(
    makeHandlerRequest('GET', '/__db/health') as never,
    challenged as never,
  );
  assert.equal(challenged.status, 401);
  assert.equal((challenged.json() as { error: { code: string } }).error.code, 'NEEDS_TOKEN');

  const seen: string[] = [];
  const allowed = makeHandlerResponse();
  await createDbRequestHandler(makeHandlerDb({
    authorize: (context: { route: string; method: string }) => {
      seen.push(`${context.method} ${context.route}`);
      return true;
    },
  }) as never)(
    makeHandlerRequest('GET', '/__db/health') as never,
    allowed as never,
  );
  assert.equal(allowed.status, 200);
  assert.deepEqual(seen, ['GET health']);
});

test('requests that fall through to app routes never reach the authorize hook', async () => {
  const { createDbRequestHandler } = await import('./request-handler.js');
  let called = 0;
  const handler = createDbRequestHandler(makeHandlerDb({ authorize: () => { called += 1; return false; } }) as never, {
    rootRoutes: false,
    dataPath: '/db',
  });
  const response = makeHandlerResponse();

  const handled = await handler(makeHandlerRequest('GET', '/app/own-route') as never, response as never);
  assert.equal(handled, false);
  assert.equal(called, 0);
});
