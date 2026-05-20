export async function runMockBehavior(config, url = null) {
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

export function normalizeMockDelay(value) {
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

export function pickDelayMs(delay, random = Math.random) {
  const minMs = Math.max(0, Number(delay.minMs ?? 0));
  const maxMs = Math.max(minMs, Number(delay.maxMs ?? minMs));
  return Math.round(minMs + (maxMs - minMs) * random());
}

function normalizeMockError(value) {
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

function normalizeDelayNumbers(min, max) {
  const minMs = Math.max(0, Number(min ?? 0));
  const maxMs = Math.max(minMs, Number(max ?? minMs));
  return {
    minMs,
    maxMs,
  };
}

function clampRate(value) {
  return Math.min(1, Math.max(0, Number(value)));
}

function shouldSkipMock(config, url) {
  return url?.pathname === normalizeBasePath(config.server?.apiBase ?? '/__db');
}

function normalizeBasePath(value) {
  const path = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return path === '/' ? '' : path;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
