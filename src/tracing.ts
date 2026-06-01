const DEFAULT_TRACE_HEADER = 'x-async-db-request-id';

type TraceConfig = {
  enabled?: boolean;
  slowMs?: number;
  console?: boolean;
  events?: boolean;
  header?: string;
};

type TraceSource = boolean | TraceConfig | null | undefined;

type ResolvedTraceOptions = {
  enabled: true;
  slowMs: number;
  console: boolean;
  events: boolean;
  header: string;
};

type TraceDetails = Record<string, unknown>;

type TracePhase = TraceDetails & {
  name: string;
  durationMs: number;
};

type TraceError = {
  code: string;
  message: string;
};

type TraceEvent = TraceDetails & {
  type: 'request-trace';
  requestId: string;
  timestamp: string;
  method: string;
  pathname: string;
  queryKeys: string[];
  route: string | null;
  resource: string | null;
  operation: string | null;
  id: string | null;
  status: number | null;
  handled: boolean;
  durationMs: number;
  slow: boolean;
  phases: TracePhase[];
  error?: TraceError;
};

type TraceRequest = {
  method?: string;
  url?: string;
};

type TraceResponse = {
  body?: unknown;
  status?: number;
  statusCode?: number;
  setHeader?: (name: string, value: string) => unknown;
  writeHead?: (status: number, ...args: unknown[]) => unknown;
};

type HonoHeaderContext = {
  header?: (name: string, value: string) => unknown;
};

type DbWithTrace = {
  config?: {
    server?: {
      trace?: TraceSource;
    };
  };
  events?: {
    emit?: (event: TraceEvent) => unknown;
  };
};

type ErrorWithStatus = {
  code?: unknown;
  status?: unknown;
};

export function resolveTraceOptions(explicitTrace: TraceSource, configTrace?: TraceSource): ResolvedTraceOptions | null {
  const source = explicitTrace === undefined ? configTrace : explicitTrace;
  if (source === false || source === undefined || source === null) {
    return null;
  }

  const options = source === true
    ? {}
    : typeof source === 'object'
      ? source
      : {};

  if (options.enabled === false) {
    return null;
  }

  return {
    enabled: true,
    slowMs: Math.max(0, Number(options.slowMs ?? 0)),
    console: options.console !== false,
    events: options.events !== false,
    header: typeof options.header === 'string' && options.header.trim()
      ? options.header.trim().toLowerCase()
      : DEFAULT_TRACE_HEADER,
  };
}

export function createRequestTrace(
  db: DbWithTrace | null | undefined,
  request: TraceRequest,
  options: { trace?: TraceSource } = {},
): RequestTrace | null {
  const traceOptions = resolveTraceOptions(options.trace, db?.config?.server?.trace);
  if (!traceOptions) {
    return null;
  }

  const url = new URL(request.url ?? '/', 'http://db.local');
  return new RequestTrace(traceOptions, request, url);
}

export class RequestTrace {
  options: ResolvedTraceOptions;
  start: number;
  headerAttached: boolean;
  event: TraceEvent;

  constructor(options: ResolvedTraceOptions, request: TraceRequest, url: URL) {
    this.options = options;
    this.start = now();
    this.headerAttached = false;
    this.event = {
      type: 'request-trace',
      requestId: requestId(),
      timestamp: new Date().toISOString(),
      method: String(request.method ?? 'GET').toUpperCase(),
      pathname: url.pathname,
      queryKeys: [...new Set([...url.searchParams.keys()])].sort(),
      route: null,
      resource: null,
      operation: null,
      id: null,
      status: null,
      handled: false,
      durationMs: 0,
      slow: false,
      phases: [],
    };
  }

  markHandled(response: TraceResponse): void {
    this.event.handled = true;
    this.attachResponseHeader(response);
  }

  setRoute(details: TraceDetails = {}): void {
    for (const [key, value] of Object.entries(details)) {
      if (value !== undefined && value !== null && value !== '') {
        this.event[key] = value;
      }
    }
  }

  addPhase(name: string, durationMs: number, details: TraceDetails = {}): void {
    const phase: TracePhase = {
      name,
      durationMs: roundMs(durationMs),
    };
    for (const [key, value] of Object.entries(details)) {
      if (value !== undefined && value !== null) {
        phase[key] = value;
      }
    }
    this.event.phases.push(phase);
  }

  timeSync<Result>(name: string, fn: () => Result, details: TraceDetails = {}): Result {
    const start = now();
    try {
      return fn();
    } finally {
      this.addPhase(name, now() - start, details);
    }
  }

  async time<Result>(name: string, fn: () => Result | Promise<Result>, details: TraceDetails = {}): Promise<Result> {
    const start = now();
    try {
      return await fn();
    } finally {
      this.addPhase(name, now() - start, details);
    }
  }

  setError(error: ErrorWithStatus | null | undefined): void {
    if (!error) {
      return;
    }
    if (typeof error.status === 'number') {
      this.event.status = error.status;
    }
    const code = error.code ? String(error.code) : 'ERROR';
    this.event.error = {
      code,
      message: safeErrorMessage(code),
    };
  }

  finish(db: DbWithTrace | null | undefined, response: TraceResponse): TraceEvent | null {
    if (!this.event.handled) {
      return null;
    }

    const status = responseStatus(response);
    if (status !== null) {
      this.event.status = status;
    }
    this.captureSerializedError(response);
    this.event.durationMs = roundMs(now() - this.start);
    this.event.slow = this.event.durationMs >= this.options.slowMs;

    const traceEvent = compactEvent(this.event);
    if (this.options.events && typeof db?.events?.emit === 'function') {
      db.events.emit(traceEvent);
    }
    if (this.options.console) {
      writeConsoleTrace(traceEvent);
    }
    return traceEvent;
  }

  attachResponseHeader(response: TraceResponse | null | undefined): void {
    if (this.headerAttached || !response || !this.options.header) {
      return;
    }
    this.headerAttached = true;

    if (typeof response.setHeader === 'function') {
      response.setHeader(this.options.header, this.event.requestId);
      return;
    }

    if (typeof response.writeHead !== 'function') {
      return;
    }

    const originalWriteHead = response.writeHead.bind(response);
    response.writeHead = (status, ...args) => {
      return originalWriteHead(status, ...withHeader(args, this.options.header, this.event.requestId));
    };
  }

  attachHonoHeader(c: HonoHeaderContext | null | undefined): void {
    if (!this.options.header || typeof c?.header !== 'function') {
      return;
    }
    c.header(this.options.header, this.event.requestId);
  }

  captureSerializedError(response: TraceResponse | null | undefined): void {
    if (this.event.error || typeof response?.body !== 'string' || response.body.trim() === '') {
      return;
    }
    try {
      const parsed = JSON.parse(response.body);
      const error = parsed?.error;
      if (error && typeof error === 'object') {
        const code = error.code ? String(error.code) : 'ERROR';
        this.event.error = {
          code,
          message: safeErrorMessage(code),
        };
      }
    } catch {
      // Response bodies are not part of trace data; this only observes tests' serialized error envelope.
    }
  }
}

export function responseStatus(response: TraceResponse | null | undefined): number | null {
  if (typeof response?.status === 'number') {
    return response.status;
  }
  if (typeof response?.statusCode === 'number') {
    return response.statusCode;
  }
  return null;
}

export function tracePhase<Result>(
  trace: RequestTrace | null | undefined,
  name: string,
  fn: () => Result | Promise<Result>,
  details?: TraceDetails,
): Result | Promise<Result> {
  return trace ? trace.time(name, fn, details) : fn();
}

export function tracePhaseSync<Result>(
  trace: RequestTrace | null | undefined,
  name: string,
  fn: () => Result,
  details?: TraceDetails,
): Result {
  return trace ? trace.timeSync(name, fn, details) : fn();
}

function withHeader(args: unknown[], name: string, value: string): unknown[] {
  if (args.length === 0) {
    return [{ [name]: value }];
  }

  if (typeof args[0] === 'string') {
    return [
      args[0],
      {
        ...headerObject(args[1]),
        [name]: value,
      },
      ...args.slice(2),
    ];
  }

  return [
    {
      ...headerObject(args[0]),
      [name]: value,
    },
    ...args.slice(1),
  ];
}

function compactEvent(event: TraceEvent): TraceEvent {
  const next: TraceDetails = {};
  for (const [key, value] of Object.entries(event)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    next[key] = value;
  }
  return next as TraceEvent;
}

function writeConsoleTrace(event: TraceEvent): void {
  const prefix = event.slow ? '[async-db:slow]' : '[async-db]';
  const fields = [
    event.route ? `route=${event.route}` : null,
    event.resource ? `resource=${event.resource}` : null,
    event.operation ? `op=${event.operation}` : null,
    event.hook ? `hook=${event.hook}` : null,
    event.shortCircuit ? 'shortCircuit=true' : null,
    `requestId=${event.requestId}`,
  ].filter(Boolean);

  console.log(`${prefix} ${event.method} ${event.pathname} ${event.status ?? '-'} ${event.durationMs}ms ${fields.join(' ')}`);
}

function headerObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeErrorMessage(code: string): string {
  return code ? `Request failed (${code})` : 'Request failed';
}

function requestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function now(): number {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

function roundMs(value: number): number {
  return Math.round(Number(value) * 1000) / 1000;
}
