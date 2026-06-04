import { watch, type FSWatcher } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openDb } from './db.js';
import { assertOperationStrictModeReady } from './features/operations/readiness.js';
import { createDbRequestHandler, createViewerEventHub } from './request-handler.js';
import { syncDb } from './sync.js';

type RuntimeDiagnostic = {
  code?: string;
  severity?: 'error' | 'warn' | 'info' | string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
};

type RuntimeResource = {
  name: string;
  [key: string]: unknown;
};

type RuntimeConfig = {
  cwd: string;
  sourceDir: string;
  stateDir: string;
  operations?: {
    sourceDir?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type RuntimeDb = {
  config: RuntimeConfig;
  resources: Map<string, RuntimeResource>;
  diagnostics?: RuntimeDiagnostic[];
  schemaVersion?: number;
  replaceResources?: (resources: RuntimeResource[], diagnostics?: RuntimeDiagnostic[]) => unknown;
  runtime?: {
    hydrate?: () => unknown | Promise<unknown>;
  };
  close?: () => unknown | Promise<unknown>;
};

type RuntimeProject = {
  resources: RuntimeResource[];
  diagnostics: RuntimeDiagnostic[];
  [key: string]: unknown;
};

type RuntimeRequestHandler = (request: unknown, response: unknown, next?: () => unknown) => Promise<boolean>;

type RuntimeHandlerOptions = Record<string, unknown> & {
  rootRoutes?: boolean;
};

type RuntimeOpenOptions = Record<string, unknown> & {
  allowSourceErrors?: boolean;
  syncOnOpen?: boolean;
};

type WatchImpl = typeof watch;

type WatchError = Error & {
  code?: string;
};

type DbWatchOptionsInternal = DbWatchOptions & {
  events?: DbRuntimeEvents;
  watch?: WatchImpl;
};

export type DbRuntimeEvent =
  | { type: 'synced' | 'synced-with-errors'; version: number; diagnostics: unknown[] }
  | { type: 'sync-error'; version: number; diagnostics: unknown[] }
  | { type: 'watch-disabled'; version: number; diagnostics: unknown[] };

export type DbRuntimeEvents = {
  subscribe(listener: (event: DbRuntimeEvent) => void): () => void;
  publish(event: DbRuntimeEvent): void;
  close(): void;
};

export type DbWatchOptions = {
  debounceMs?: number;
  warn?: (message: string) => unknown;
};

export type DbSourceWatcher = {
  readonly enabled: boolean;
  close(): void;
};

export type DbRuntimeOptions = RuntimeOpenOptions & {
  handler?: RuntimeHandlerOptions;
  watch?: boolean | DbWatchOptions;
  hydrateOnOpen?: boolean;
};

export type DbRuntime = {
  db: RuntimeDb;
  events: DbRuntimeEvents;
  watcher: DbSourceWatcher | null;
  handleRequest: RuntimeRequestHandler;
  reload(options?: { allowErrors?: boolean }): Promise<RuntimeProject>;
  close(): Promise<void>;
};

export async function createDbRuntime(options: DbRuntimeOptions | string = {}): Promise<DbRuntime> {
  const rawOptions: DbRuntimeOptions = typeof options === 'string' ? { from: options } : { ...options };
  const {
    handler: handlerOptions = {},
    watch: watchOptions = true,
    hydrateOnOpen = true,
    ...openOptions
  } = rawOptions;
  const db = await openDb({
    ...openOptions,
    allowSourceErrors: openOptions.allowSourceErrors ?? true,
  }) as unknown as RuntimeDb;

  try {
    await assertOperationStrictModeReady(db.config as never);
    if (openOptions.syncOnOpen === false && hydrateOnOpen !== false) {
      await db.runtime?.hydrate?.();
    }

    const events = createDbRuntimeEvents();
    const viewerEvents = createViewerEventHub(events as never);
    const handleRequest = createDbRequestHandler(db as never, {
      ...handlerOptions,
      rootRoutes: handlerOptions.rootRoutes ?? true,
      events: viewerEvents as never,
    }) as RuntimeRequestHandler;
    const watcher = watchOptions === false
      ? null
      : await watchDbSources(db, {
        ...(watchOptions === true ? {} : watchOptions),
        events,
      });
    let closed = false;

    return {
      db,
      events,
      watcher,
      handleRequest,
      async reload(options = {}) {
        return await reloadAndPublish(db, events, options);
      },
      async close() {
        if (closed) {
          return;
        }
        closed = true;
        watcher?.close();
        viewerEvents.close();
        events.close();
        await db.close?.();
      },
    };
  } catch (error) {
    await db.close?.();
    throw error;
  }
}

export function createDbRuntimeEvents(): DbRuntimeEvents {
  const listeners = new Set<(event: DbRuntimeEvent) => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(event: DbRuntimeEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    close() {
      listeners.clear();
    },
  };
}

export async function reloadDb(db: RuntimeDb, options: { allowErrors?: boolean } = {}): Promise<RuntimeProject> {
  const project = await syncDb(db.config as never, {
    allowErrors: options.allowErrors ?? true,
  }) as RuntimeProject;
  if (typeof db.replaceResources === 'function') {
    db.replaceResources(project.resources, project.diagnostics);
  } else {
    db.resources = new Map(project.resources.map((resource) => [resource.name, resource]));
    db.diagnostics = project.diagnostics;
    db.schemaVersion = Date.now();
  }
  return project;
}

export async function watchDbSources(db: RuntimeDb, options: DbWatchOptionsInternal = {}): Promise<DbSourceWatcher> {
  await mkdir(db.config.sourceDir, { recursive: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let enabled = true;
  const watchImpl = options.watch ?? watch;
  const warn = options.warn ?? ((message) => console.warn(message));
  const debounceMs = Number(options.debounceMs ?? 75);
  let watcher: FSWatcher | undefined;

  try {
    watcher = watchImpl(db.config.sourceDir, { recursive: true }, (_event, filename) => {
      if (!enabled || shouldIgnoreSourceEvent(db, filename)) {
        return;
      }

      clearTimeout(timer);
      timer = setTimeout(async () => {
        await reloadAndPublish(db, options.events).catch(() => undefined);
      }, debounceMs);
    });
  } catch (error) {
    enabled = false;
    reportWatchUnavailable(db, options.events, error as WatchError, warn);
    return {
      enabled,
      close() {
        clearTimeout(timer);
      },
    };
  }

  watcher.on?.('error', (error) => {
    if (!enabled) {
      return;
    }

    enabled = false;
    clearTimeout(timer);
    try {
      watcher.close();
    } catch {
      // The watcher may already be closed by the runtime.
    }
    reportWatchUnavailable(db, options.events, error as WatchError, warn);
  });

  return {
    get enabled() {
      return enabled;
    },
    close() {
      enabled = false;
      clearTimeout(timer);
      try {
        watcher.close();
      } catch {
        // The watcher may already be closed after an error event.
      }
    },
  };
}

async function reloadAndPublish(
  db: RuntimeDb,
  events?: DbRuntimeEvents,
  options: { allowErrors?: boolean } = {},
): Promise<RuntimeProject> {
  try {
    const project = await reloadDb(db, options);
    events?.publish({
      type: project.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'synced-with-errors' : 'synced',
      version: db.schemaVersion ?? Date.now(),
      diagnostics: project.diagnostics,
    });
    return project;
  } catch (error) {
    const diagnostic: RuntimeDiagnostic = {
      code: 'SERVER_SOURCE_RELOAD_FAILED',
      severity: 'error',
      message: (error as Error).message,
      hint: 'Fix the source file and db will try to reload it on the next change.',
    };
    db.diagnostics = [diagnostic];
    db.schemaVersion = Date.now();
    events?.publish({
      type: 'sync-error',
      version: db.schemaVersion,
      diagnostics: db.diagnostics,
    });
    throw error;
  }
}

function reportWatchUnavailable(
  db: RuntimeDb,
  events: DbRuntimeEvents | undefined,
  error: WatchError,
  warn: (message: string) => unknown,
): void {
  const diagnostic = {
    code: 'SERVER_WATCH_UNAVAILABLE',
    severity: 'warn',
    message: `File watching is disabled: ${error.message}`,
    hint: 'async-db serve is still running, but fixture changes will require restarting the server.',
    details: {
      code: error.code,
    },
  };

  db.diagnostics = [...(db.diagnostics ?? []), diagnostic];
  db.schemaVersion = Date.now();
  events?.publish({
    type: 'watch-disabled',
    version: db.schemaVersion,
    diagnostics: db.diagnostics,
  });
  warn(`async-db serve: file watching disabled (${error.message}). Restart the server to pick up fixture changes.`);
}

function shouldIgnoreSourceEvent(db: RuntimeDb, filename: string | Buffer | null | undefined): boolean {
  if (!filename) {
    return false;
  }

  const relativePath = path.normalize(String(filename));
  if (relativePath.split(path.sep).some((part) => part.startsWith('.'))) {
    return true;
  }

  const absolutePath = path.join(db.config.sourceDir, relativePath);
  if (db.config.operations?.sourceDir && isInsideOrEqualPath(db.config.operations.sourceDir, absolutePath)) {
    return true;
  }

  const relativeStatePath = path.relative(db.config.stateDir, absolutePath);
  return relativeStatePath === '' || (!relativeStatePath.startsWith('..') && !path.isAbsolute(relativeStatePath));
}

function isInsideOrEqualPath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
