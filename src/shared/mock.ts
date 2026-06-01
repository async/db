type MockDelay = {
  minMs?: number;
  min?: number;
  maxMs?: number;
  max?: number;
};

type NormalizedMockDelay = {
  minMs: number;
  maxMs: number;
};

type MockErrorConfig = {
  rate?: number;
  probability?: number;
  status?: number;
  message?: string;
};

type MockConfig = {
  delay?: number | [number, number] | MockDelay | false;
  delayMs?: number | [number, number] | MockDelay | false;
  errors?: number | MockErrorConfig | false | null;
  error?: number | MockErrorConfig | false | null;
};

type RuntimeConfigWithMock = {
  mock?: MockConfig | false | null;
  chaos?: MockConfig | false | null;
  server?: {
    apiBase?: string;
  };
};

type MockErrorResponse = {
  status: number;
  body: {
    error: string;
    mock: true;
  };
};

export async function runMockBehavior(config: RuntimeConfigWithMock, url: URL | null = null): Promise<MockErrorResponse | null> {
  const mock = config.mock ?? config.chaos;
  if (!mock || shouldSkipMock(config, url)) {
    return null;
  }

  const delay = normalizeMockDelay(mock.delay ?? mock.delayMs);
  if (delay.maxMs > 0) {
    await sleep(pickDelayMs(delay));
  }

  const error = normalizeMockError(mock.errors ?? mock.error);
  if (error.rate > 0 && Math.random() < error.rate) {
    return {
      status: error.status,
      body: {
        error: error.message,
        mock: true,
      },
    };
  }

  return null;
}

export function normalizeMockDelay(value: MockConfig['delay']): NormalizedMockDelay {
  if (!value) {
    return {
      minMs: 0,
      maxMs: 0,
    };
  }

  if (Array.isArray(value)) {
    return normalizeDelayNumbers(value[0], value[1]);
  }

  if (typeof value === 'number') {
    return normalizeDelayNumbers(value, value);
  }

  return normalizeDelayNumbers(value.minMs ?? value.min ?? 0, value.maxMs ?? value.max ?? value.minMs ?? value.min ?? 0);
}

export function pickDelayMs(delay: Partial<NormalizedMockDelay>, random = Math.random): number {
  const minMs = Math.max(0, Number(delay.minMs ?? 0));
  const maxMs = Math.max(minMs, Number(delay.maxMs ?? minMs));
  return Math.round(minMs + (maxMs - minMs) * random());
}

function normalizeMockError(value: MockConfig['errors']): { rate: number; status: number; message: string } {
  if (!value) {
    return {
      rate: 0,
      status: 503,
      message: 'Mock chaos error',
    };
  }

  if (typeof value === 'number') {
    return {
      rate: clampRate(value),
      status: 503,
      message: 'Mock chaos error',
    };
  }

  return {
    rate: clampRate(value.rate ?? value.probability ?? 0),
    status: Number(value.status ?? 503),
    message: String(value.message ?? 'Mock chaos error'),
  };
}

function normalizeDelayNumbers(min: unknown, max: unknown): NormalizedMockDelay {
  const minMs = Math.max(0, Number(min ?? 0));
  const maxMs = Math.max(minMs, Number(max ?? minMs));
  return {
    minMs,
    maxMs,
  };
}

function clampRate(value: unknown): number {
  return Math.min(1, Math.max(0, Number(value)));
}

function shouldSkipMock(config: RuntimeConfigWithMock, url: URL | null): boolean {
  return url?.pathname === normalizeBasePath(config.server?.apiBase ?? '/__db');
}

function normalizeBasePath(value: unknown): string {
  const path = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return path === '/' ? '' : path;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
