import type { DbOptions } from './index.d.ts';

export type DbHonoOptions = DbOptions & {
  api?: Array<'rest' | 'graphql'> | 'rest' | 'graphql' | 'rest,graphql';
  graphqlPath?: string;
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

export type DbHonoRestHook = (context: DbHonoRestHookContext) => unknown | Promise<unknown>;

export type DbHonoRestHooks = {
  beforeList?: DbHonoRestHook;
  beforeGet?: DbHonoRestHook;
  beforeCreate?: DbHonoRestHook;
  beforePatch?: DbHonoRestHook;
  beforeDelete?: DbHonoRestHook;
  beforePut?: DbHonoRestHook;
};

export type DbHonoRestLifecycleHooks = {
  beforeRequest?: DbHonoRestHook;
  beforeWrite?: DbHonoRestHook;
};

export type DbHonoRestResourceOptions = false | {
  methods?: DbHonoRestMethod[];
  hooks?: DbHonoRestHooks;
};

export type DbHonoRestRoutesOptions = {
  prefix?: string;
  resources?: string[];
  exclude?: string[];
  methods?: DbHonoRestMethod[];
  hooks?: DbHonoRestHooks;
  lifecycleHooks?: DbHonoRestLifecycleHooks;
  resourceOptions?: Record<string, DbHonoRestResourceOptions>;
};

export function createDbHonoApp(options?: DbHonoOptions): Promise<unknown>;
export function createDbContext(options?: DbHonoOptions): Promise<unknown>;
export function dbContext(dbOrOptions?: unknown): unknown;
export function registerDbRoutes(app: unknown, db: unknown, options?: DbHonoRestRoutesOptions): void;
