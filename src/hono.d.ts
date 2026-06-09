import type { DbOperationsOptions, DbOptions, DbTraceOptions } from './index.d.ts';

export type DbHonoOptions = DbOptions & {
  api?: Array<'rest' | 'graphql'> | 'rest' | 'graphql' | 'rest,graphql';
  graphqlPath?: string;
  /** Explicit request trace option for generated Hono REST routes. Wins over db.config.js server.trace. */
  trace?: DbTraceOptions;
  restRoutes?: DbHonoRestRoutesOptions;
  storage?: {
    kind?: 'db' | 'sqlite';
    file?: string;
  };
};

export type DbHonoRestMethod = 'list' | 'get' | 'create' | 'patch' | 'delete' | 'put';

export type DbHonoRestHookContext = {
  c: unknown;
  db: unknown;
  resource: Record<string, unknown>;
  resourceName: string;
  method: DbHonoRestMethod;
  id?: string;
  body?: Record<string, unknown>;
};

export type DbHonoOperationHookContext = {
  c: unknown;
  db: unknown;
  resource: null;
  resourceName: null;
  method: 'operation';
  ref: string;
};

export type DbHonoBeforeRequestHookContext = DbHonoRestHookContext | DbHonoOperationHookContext;

export type DbHonoRestHook = (context: DbHonoRestHookContext) => unknown | Promise<unknown>;
export type DbHonoBeforeRequestHook = (context: DbHonoBeforeRequestHookContext) => unknown | Promise<unknown>;

export type DbHonoRestHooks = {
  beforeList?: DbHonoRestHook;
  beforeGet?: DbHonoRestHook;
  beforeCreate?: DbHonoRestHook;
  beforePatch?: DbHonoRestHook;
  beforeDelete?: DbHonoRestHook;
  beforePut?: DbHonoRestHook;
};

export type DbHonoRestLifecycleHooks = {
  beforeRequest?: DbHonoBeforeRequestHook;
  beforeWrite?: DbHonoRestHook;
};

export type DbHonoRestResourceOptions = false | {
  methods?: DbHonoRestMethod[];
  hooks?: DbHonoRestHooks;
};

export type DbHonoRestRoutesOptions = {
  prefix?: string;
  /** Mount registered operation route. Defaults to "auto", which uses db.config.operations when enabled. */
  operations?: 'auto' | boolean | DbOperationsOptions;
  resources?: string[];
  exclude?: string[];
  methods?: DbHonoRestMethod[];
  /** Explicit request trace option for registered Hono REST routes. Wins over db.config.js server.trace. */
  trace?: DbTraceOptions;
  hooks?: DbHonoRestHooks;
  lifecycleHooks?: DbHonoRestLifecycleHooks;
  resourceOptions?: Record<string, DbHonoRestResourceOptions>;
};

export function createDbHonoApp(options?: DbHonoOptions): Promise<unknown>;
export function createDbContext(options?: DbHonoOptions): Promise<unknown>;
export function dbContext(dbOrOptions?: unknown): unknown;
export function registerDbRoutes(app: unknown, db: unknown, options?: DbHonoRestRoutesOptions): void;
