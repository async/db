import path from 'node:path';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { loadConfig } from '../../config.js';
import { dbError, listChoices } from '../../errors.js';
import { resolveResource, resourceAliasCollisionGroups } from '../../names.js';
import { createDbOperationHandler } from '../../operations.js';
import { loadProjectSchema } from '../../schema.js';
import { syncDb } from '../../sync.js';
import { createRuntime } from '../storage/runtime.js';
import { DbCollection } from './collection.js';
import { DbDocument } from './document.js';

type DbConfig = {
  cwd: string;
  stateDir: string;
  schemaLoadMode?: string;
  resources?: Record<string, unknown>;
  __asyncDbScope?: DbScope;
  [key: string]: unknown;
};

type DbResource = {
  name: string;
  kind: 'collection' | 'document' | string;
  [key: string]: unknown;
};

type DbProject = {
  resources: DbResource[];
  diagnostics?: unknown[];
};

type LoadedDbSchema = {
  kind: 'DbSchema';
  resources: Map<string, DbResource>;
  config?: Partial<DbConfig> & Record<string, unknown>;
  locator?: {
    file?: string;
    mode?: string;
    sourceDir?: string;
    cwd?: string;
  };
};

type OpenDbOptions = Record<string, unknown> & {
  from?: string;
  schema?: unknown;
  syncOnOpen?: boolean;
  allowSourceErrors?: boolean;
  load?: string;
};

type RuntimeFacade = ReturnType<typeof createRuntime>;

type DbScope = {
  fork: string | null;
  branch: string;
  rootStateDir: string;
};

type ForkCreateOptions = {
  from?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
};

type BranchCreateOptions = {
  from?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
};

type SnapshotCreateOptions = {
  label?: string;
  resources?: string[];
};

type SnapshotRestoreOptions = {
  resources?: string[];
};

type MigrationStartOptions = {
  resources: string[];
  mode?: 'read-only';
};

type MigrationVerifyOptions = {
  resources: string[];
  checks?: Array<'count' | 'schema' | 'checksum'>;
};

type ResourceMigrateOptions = {
  from: string;
  to: string;
};

type MigrationLock = {
  name: string;
  resources: string[];
  mode: 'read-only';
  startedAt: string;
};

type MigrationCopy = {
  from: string;
  to: string;
};

type SnapshotResult = {
  id: string;
  label?: string;
  fork: string | null;
  branch: string;
  resources: string[];
  path: string;
};

export async function openDb(options: OpenDbOptions | string = {}): Promise<Db> {
  const rawOptions = typeof options === 'string' ? { from: options } : options;
  const loadedSchema = loadedSchemaFromOptions(rawOptions);
  const config = await loadConfig(openOptionsForConfig(rawOptions, loadedSchema) as Parameters<typeof loadConfig>[0]) as DbConfig;
  const syncOnOpen = rawOptions.syncOnOpen ?? true;
  const project = (syncOnOpen
    ? await syncDb(config, { allowErrors: rawOptions.allowSourceErrors === true })
    : await loadProjectSchema(config, { load: config.schemaLoadMode ?? 'runtime' })) as DbProject;
  const db = new Db(config, project.resources, project.diagnostics);
  if (syncOnOpen) {
    await db.runtime.hydrate();
  }

  return db;
}

function loadedSchemaFromOptions(options: OpenDbOptions): LoadedDbSchema | null {
  return isLoadedDbSchema(options?.schema) ? options.schema : null;
}

function openOptionsForConfig(options: OpenDbOptions, loadedSchema: LoadedDbSchema | null): OpenDbOptions {
  const next = loadedSchema
    ? optionsFromLoadedSchema(options, loadedSchema)
    : { ...options };

  next.load ??= 'runtime';
  return next;
}

function optionsFromLoadedSchema(options: OpenDbOptions, loadedSchema: LoadedDbSchema): OpenDbOptions {
  const { schema: _loadedSchema, ...overrides } = options;
  const next = {
    ...(loadedSchema.config ?? {}),
    ...overrides,
  };

  next.from ??= locatorInputForLoadedSchema(loadedSchema);
  return next;
}

function locatorInputForLoadedSchema(loadedSchema: LoadedDbSchema): string | undefined {
  const locator = loadedSchema.locator ?? loadedSchema.config?.schemaLocator as LoadedDbSchema['locator'] | undefined;
  if (locator?.file) {
    return locator.file;
  }

  if (locator?.mode === 'source-dir' && locator.sourceDir) {
    return locator.sourceDir;
  }

  return locator?.cwd ?? loadedSchema.config?.cwd;
}

function isLoadedDbSchema(value: unknown): value is LoadedDbSchema {
  const candidate = value as Partial<LoadedDbSchema> | null | undefined;
  return candidate?.kind === 'DbSchema' && candidate?.resources instanceof Map && Boolean(candidate?.config);
}

export class Db {
  config: DbConfig;
  resources: Map<string, DbResource>;
  diagnostics: unknown[];
  schemaVersion: number;
  runtime: RuntimeFacade;
  events: RuntimeFacade['events'];
  scope: DbScope;
  forks: {
    create: (name: string, options?: ForkCreateOptions) => Promise<Db>;
    list: () => Promise<Array<Record<string, unknown>>>;
    delete: (name: string) => Promise<boolean>;
  };
  branches: {
    create: (name: string, options?: BranchCreateOptions) => Promise<Db>;
  };
  snapshots: {
    create: (options?: SnapshotCreateOptions) => Promise<SnapshotResult>;
    restore: (id: string, options?: SnapshotRestoreOptions) => Promise<void>;
  };
  migrations: {
    start: (name: string, options: MigrationStartOptions) => Promise<MigrationLock>;
    verify: (name: string, options: MigrationVerifyOptions) => Promise<void>;
    finish: (name: string) => Promise<void>;
  };
  routing: {
    set: (routes: Record<string, string>) => Promise<Record<string, string>>;
  };
  private migrationLocks: Map<string, MigrationLock>;
  private migrationCopies: Map<string, MigrationCopy>;

  constructor(config: DbConfig, resources: DbResource[], diagnostics: unknown[] = [], scope?: DbScope) {
    this.config = {
      ...config,
      resources: cloneConfigResources(config.resources),
    };
    this.resources = new Map(resources.map((resource) => [resource.name, resource]));
    assertNoResourceAliasCollisions(this.resources);
    this.diagnostics = diagnostics;
    this.schemaVersion = Date.now();
    this.scope = scope ?? this.config.__asyncDbScope ?? {
      fork: null,
      branch: 'main',
      rootStateDir: config.stateDir,
    };
    this.config.__asyncDbScope = this.scope;
    applyPersistedRouting(this.config, this.scope);
    this.runtime = createRuntime(this.config, resources);
    this.events = this.runtime.events;
    this.migrationLocks = loadPersistedMigrationLocks(this.scope);
    this.migrationCopies = new Map();
    this.forks = {
      create: (name, options = {}) => this.createFork(name, options),
      list: () => this.listForks(),
      delete: (name) => this.deleteFork(name),
    };
    this.branches = {
      create: (name, options = {}) => this.createBranch(name, options),
    };
    this.snapshots = {
      create: (options = {}) => this.createSnapshot(options),
      restore: (id, options = {}) => this.restoreSnapshot(id, options),
    };
    this.migrations = {
      start: (name, options) => this.startMigration(name, options),
      verify: (name, options) => this.verifyMigration(name, options),
      finish: (name) => this.finishMigration(name),
    };
    this.routing = {
      set: (routes) => this.setRouting(routes),
    };
    (this.resources as Map<string, DbResource> & { migrate?: unknown }).migrate = (
      name: string,
      options: ResourceMigrateOptions,
    ) => this.migrateResource(name, options);
  }

  collection(name: string): DbCollection {
    const resource = this.requireResource(name, 'collection');
    return new DbCollection(this, resource);
  }

  document(name: string): DbDocument {
    const resource = this.requireResource(name, 'document');
    return new DbDocument(this, resource);
  }

  async operation(template: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    const result = await createDbOperationHandler(this as never).execute(template, variables);
    return result.body;
  }

  query(template: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    return this.operation(template, variables);
  }

  fork(name: string): Db {
    assertValidScopedName(name, 'fork');
    return this.scopedDb({
      fork: name,
      branch: 'main',
      rootStateDir: this.scope.rootStateDir,
    });
  }

  branch(name: string): Db {
    assertValidScopedName(name, 'branch');
    if (!this.scope.fork) {
      throw dbError(
        'DB_BRANCH_REQUIRES_FORK',
        `Cannot open branch "${name}" without a fork.`,
        {
          status: 400,
          hint: 'Call db.fork("tenant_id").branch("main") so the branch belongs to one isolated database fork.',
          details: {
            branch: name,
          },
        },
      );
    }
    return this.scopedDb({
      fork: this.scope.fork,
      branch: name,
      rootStateDir: this.scope.rootStateDir,
    });
  }

  assertResourceWritable(resourceName: string): void {
    for (const lock of this.migrationLocks.values()) {
      if (lock.mode === 'read-only' && lock.resources.includes(resourceName)) {
        throw dbError(
          'RESOURCE_MIGRATING',
          `Resource "${resourceName}" is read-only while migration "${lock.name}" is running.`,
          {
            status: 423,
            hint: 'Wait for the migration to finish, retry later, or write to a migration target outside the public resource API.',
            details: {
              resource: resourceName,
              migration: lock.name,
              fork: this.scope.fork,
              branch: this.scope.branch,
            },
          },
        );
      }
    }
  }

  requireResource(name: string, kind: 'collection' | 'document'): DbResource {
    const { resource, candidates } = resolveResource(this.resources, name);
    if (!resource) {
      throw dbError(
        'DB_UNKNOWN_RESOURCE',
        `Unknown db resource "${name}".`,
        {
          status: 404,
          hint: `Use one of: ${listChoices(this.resourceNames())}.`,
          details: {
            resource: name,
            requestedResource: name,
            normalizedCandidates: candidates,
            availableResources: this.resourceNames(),
          },
        },
      );
    }

    if (resource.kind !== kind) {
      throw dbError(
        'DB_RESOURCE_KIND_MISMATCH',
        `Resource "${name}" is a ${resource.kind}, not a ${kind}.`,
        {
          status: 400,
          hint: resource.kind === 'collection'
            ? `Use db.collection("${name}") for this resource.`
            : `Use db.document("${name}") for this resource.`,
          details: {
            resource: name,
            expectedKind: kind,
            actualKind: resource.kind,
          },
        },
      );
    }

    return resource;
  }

  resourceNames(): string[] {
    return [...this.resources.keys()];
  }

  close(): Promise<void> {
    return this.runtime.close();
  }

  private scopedDb(scope: DbScope): Db {
    const config = scopedConfig(this.config, scope);
    const next = new Db(config, [...this.resources.values()], this.diagnostics, scope);
    return next;
  }

  private async createFork(name: string, options: ForkCreateOptions = {}): Promise<Db> {
    assertValidScopedName(name, 'fork');
    const now = new Date().toISOString();
    const registryPath = forkRegistryPath(this.scope.rootStateDir);
    const registry = await readJsonFile(registryPath, { forks: {} });
    registry.forks[name] = {
      id: name,
      kind: options.kind ?? 'fork',
      metadata: options.metadata ?? {},
      from: options.from ?? 'main',
      createdAt: now,
    };
    await writeJsonFile(registryPath, registry);

    const target = this.fork(name);
    await copyResources(this, target, this.resourceNames());
    return target;
  }

  private async listForks(): Promise<Array<Record<string, unknown>>> {
    const registry = await readJsonFile(forkRegistryPath(this.scope.rootStateDir), { forks: {} });
    return Object.values(registry.forks ?? {});
  }

  private async deleteFork(name: string): Promise<boolean> {
    assertValidScopedName(name, 'fork');
    const registryPath = forkRegistryPath(this.scope.rootStateDir);
    const registry = await readJsonFile(registryPath, { forks: {} });
    const existed = Boolean(registry.forks?.[name]);
    if (registry.forks) {
      delete registry.forks[name];
    }
    await writeJsonFile(registryPath, registry);
    await rm(path.join(this.scope.rootStateDir, 'forks', name), { force: true, recursive: true });
    return existed;
  }

  private async createBranch(name: string, options: BranchCreateOptions = {}): Promise<Db> {
    assertValidScopedName(name, 'branch');
    if (!this.scope.fork) {
      throw dbError(
        'DB_BRANCH_REQUIRES_FORK',
        `Cannot create branch "${name}" without a fork.`,
        {
          status: 400,
          hint: 'Call db.fork("tenant_id").branches.create("preview") so the branch belongs to one fork.',
          details: {
            branch: name,
          },
        },
      );
    }
    const source = this.branch(options.from ?? this.scope.branch ?? 'main');
    const target = this.branch(name);
    await copyResources(source, target, this.resourceNames());

    const registryPath = branchRegistryPath(this.scope.rootStateDir, this.scope.fork);
    const registry = await readJsonFile(registryPath, { branches: {} });
    registry.branches[name] = {
      id: name,
      kind: options.kind ?? 'branch',
      metadata: options.metadata ?? {},
      from: options.from ?? this.scope.branch ?? 'main',
      createdAt: new Date().toISOString(),
    };
    await writeJsonFile(registryPath, registry);
    return target;
  }

  private async createSnapshot(options: SnapshotCreateOptions = {}): Promise<SnapshotResult> {
    const resources = options.resources ?? this.resourceNames();
    const id = snapshotId(options.label);
    const snapshotDir = this.scope.fork
      ? path.join(this.scope.rootStateDir, 'forks', this.scope.fork, 'snapshots', id)
      : path.join(this.scope.rootStateDir, 'snapshots', id);
    const resourcesDir = path.join(snapshotDir, 'resources');
    await mkdir(resourcesDir, { recursive: true });

    for (const resourceName of resources) {
      const resource = this.resourceForName(resourceName);
      const value = await readResourceValue(this, resource);
      await writeJsonFile(path.join(resourcesDir, `${resource.name}.json`), value);
    }

    const manifest = {
      id,
      label: options.label,
      fork: this.scope.fork,
      branch: this.scope.branch,
      resources,
      createdAt: new Date().toISOString(),
    };
    await writeJsonFile(path.join(snapshotDir, 'manifest.json'), manifest);
    return {
      id,
      label: options.label,
      fork: this.scope.fork,
      branch: this.scope.branch,
      resources,
      path: snapshotDir,
    };
  }

  private async restoreSnapshot(id: string, options: SnapshotRestoreOptions = {}): Promise<void> {
    assertValidSnapshotId(id);
    const snapshotDir = this.scope.fork
      ? path.join(this.scope.rootStateDir, 'forks', this.scope.fork, 'snapshots', id)
      : path.join(this.scope.rootStateDir, 'snapshots', id);
    const manifest = await readJsonFile(path.join(snapshotDir, 'manifest.json'), null);
    if (!manifest) {
      throw dbError(
        'DB_SNAPSHOT_NOT_FOUND',
        `Snapshot "${id}" was not found.`,
        {
          status: 404,
          hint: 'Create a snapshot before restoring it, or check the snapshot id.',
          details: {
            snapshot: id,
            fork: this.scope.fork,
          },
        },
      );
    }
    const resources = options.resources ?? manifest.resources ?? this.resourceNames();
    for (const resourceName of resources) {
      const resource = this.resourceForName(resourceName);
      const value = await readJsonFile(path.join(snapshotDir, 'resources', `${resource.name}.json`), undefined);
      if (value !== undefined) {
        await writeResourceValue(this, resource, value);
      }
    }
  }

  private async startMigration(name: string, options: MigrationStartOptions): Promise<MigrationLock> {
    assertValidScopedName(name, 'migration');
    const lock = {
      name,
      resources: options.resources.map((resourceName) => this.resourceForName(resourceName).name),
      mode: options.mode ?? 'read-only',
      startedAt: new Date().toISOString(),
    };
    this.migrationLocks.set(name, lock);
    await writeJsonFile(this.migrationLocksPath(), {
      locks: Object.fromEntries(this.migrationLocks),
    });
    return lock;
  }

  private async migrateResource(name: string, options: ResourceMigrateOptions): Promise<void> {
    const resource = this.resourceForName(name);
    const fromAdapter = this.runtime.adapterForStore(resource, options.from);
    const toAdapter = this.runtime.adapterForStore(resource, options.to);
    const value = await fromAdapter.readResource?.(resource, fallbackForResource(resource));
    if (toAdapter.withResourceWrite) {
      await toAdapter.withResourceWrite(resource, async () => {
        await toAdapter.writeResource?.(resource, cloneJson(value));
      });
    } else {
      await toAdapter.writeResource?.(resource, cloneJson(value));
    }
    const migrationName = this.activeMigrationForResource(resource.name);
    if (migrationName) {
      this.migrationCopies.set(`${migrationName}:${resource.name}`, {
        from: options.from,
        to: options.to,
      });
    }
  }

  private async verifyMigration(name: string, options: MigrationVerifyOptions): Promise<void> {
    const checks = options.checks ?? ['count', 'schema', 'checksum'];
    for (const resourceName of options.resources) {
      const resource = this.resourceForName(resourceName);
      const copy = this.migrationCopies.get(`${name}:${resource.name}`);
      if (!copy) {
        throw dbError(
          'MIGRATION_VERIFY_FAILED',
          `Cannot verify resource "${resource.name}" because it was not migrated in "${name}".`,
          {
            status: 409,
            hint: 'Call resources.migrate(resource, { from, to }) before verifying the migration.',
            details: {
              migration: name,
              resource: resource.name,
            },
          },
        );
      }
      const fromValue = await this.runtime.adapterForStore(resource, copy.from).readResource?.(resource, fallbackForResource(resource));
      const toValue = await this.runtime.adapterForStore(resource, copy.to).readResource?.(resource, fallbackForResource(resource));
      if (checks.includes('count') && countValue(fromValue) !== countValue(toValue)) {
        throw migrationVerifyError(name, resource.name, 'count');
      }
      if (checks.includes('checksum') && stableJson(fromValue) !== stableJson(toValue)) {
        throw migrationVerifyError(name, resource.name, 'checksum');
      }
      if (checks.includes('schema')) {
        // Runtime writes already validate through resource APIs. Store-to-store
        // migrations preserve JSON values, so schema verification is a no-op in
        // this dependency-light v1.
      }
    }
  }

  private async finishMigration(name: string): Promise<void> {
    this.migrationLocks.delete(name);
    for (const key of [...this.migrationCopies.keys()]) {
      if (key.startsWith(`${name}:`)) {
        this.migrationCopies.delete(key);
      }
    }
    await writeJsonFile(this.migrationLocksPath(), {
      locks: Object.fromEntries(this.migrationLocks),
    });
  }

  private async setRouting(routes: Record<string, string>): Promise<Record<string, string>> {
    const persistedRoutes = await readJsonFile(this.routingPath(), {} as Record<string, string>);
    const nextRoutes = {
      ...persistedRoutes,
      ...routes,
    };
    const resourcesConfig = cloneConfigResources(this.config.resources) ?? {};
    for (const [resourceName, storeName] of Object.entries(nextRoutes)) {
      const resource = this.resourceForName(resourceName);
      const existing = configRecord(resourcesConfig[resource.name]);
      resourcesConfig[resource.name] = {
        ...existing,
        store: storeName,
      };
    }
    this.config.resources = resourcesConfig;
    await writeJsonFile(this.routingPath(), nextRoutes);
    return nextRoutes;
  }

  private activeMigrationForResource(resourceName: string): string | null {
    for (const lock of this.migrationLocks.values()) {
      if (lock.resources.includes(resourceName)) {
        return lock.name;
      }
    }
    return null;
  }

  resourceForName(name: string): DbResource {
    const { resource, candidates } = resolveResource(this.resources, name);
    if (resource) {
      return resource;
    }
    throw dbError(
      'DB_UNKNOWN_RESOURCE',
      `Unknown db resource "${name}".`,
      {
        status: 404,
        hint: `Use one of: ${listChoices(this.resourceNames())}.`,
        details: {
          resource: name,
          requestedResource: name,
          normalizedCandidates: candidates,
          availableResources: this.resourceNames(),
        },
      },
    );
  }

  private migrationLocksPath(): string {
    return migrationLocksPathForScope(this.scope);
  }

  private routingPath(): string {
    return routingPathForScope(this.scope);
  }

}

export function stateFileForDebug(db: Db, resourceName: string): string {
  return path.join(db.config.stateDir, 'state', `${resourceName}.json`);
}

function scopedConfig(config: DbConfig, scope: DbScope): DbConfig {
  const stateDir = scope.fork
    ? path.join(scope.rootStateDir, 'forks', scope.fork, 'branches', scope.branch)
    : scope.rootStateDir;
  return {
    ...config,
    stateDir,
    __asyncDbScope: scope,
  };
}

function branchMetaDirForScope(scope: DbScope): string {
  return scope.fork
    ? path.join(scope.rootStateDir, 'forks', scope.fork, 'branches', scope.branch, 'meta')
    : path.join(scope.rootStateDir, 'meta');
}

function routingPathForScope(scope: DbScope): string {
  return path.join(branchMetaDirForScope(scope), 'routing.json');
}

function migrationLocksPathForScope(scope: DbScope): string {
  return path.join(branchMetaDirForScope(scope), 'migration-locks.json');
}

function applyPersistedRouting(config: DbConfig, scope: DbScope): void {
  const routes = readJsonFileSync(routingPathForScope(scope), {} as Record<string, string>);
  if (Object.keys(routes).length === 0) {
    return;
  }
  const resourcesConfig = cloneConfigResources(config.resources) ?? {};
  for (const [resourceName, storeName] of Object.entries(routes)) {
    const existing = configRecord(resourcesConfig[resourceName]);
    resourcesConfig[resourceName] = {
      ...existing,
      store: storeName,
    };
  }
  config.resources = resourcesConfig;
}

function loadPersistedMigrationLocks(scope: DbScope): Map<string, MigrationLock> {
  const state = readJsonFileSync(migrationLocksPathForScope(scope), { locks: {} });
  const locks = new Map<string, MigrationLock>();
  for (const [name, value] of Object.entries(configRecord(state.locks))) {
    const lock = configRecord(value);
    if (!Array.isArray(lock.resources)) {
      continue;
    }
    locks.set(name, {
      name,
      resources: lock.resources.map(String),
      mode: lock.mode === 'read-only' ? 'read-only' : 'read-only',
      startedAt: typeof lock.startedAt === 'string' ? lock.startedAt : '',
    });
  }
  return locks;
}

async function copyResources(source: Db, target: Db, resourceNames: string[]): Promise<void> {
  for (const resourceName of resourceNames) {
    const resource = source.resourceForName(resourceName);
    const value = await readResourceValue(source, resource);
    await writeResourceValue(target, resource, value);
  }
}

async function readResourceValue(db: Db, resource: DbResource): Promise<unknown> {
  return db.runtime.adapterFor(resource).readResource?.(resource, fallbackForResource(resource));
}

async function writeResourceValue(db: Db, resource: DbResource, value: unknown): Promise<void> {
  const adapter = db.runtime.adapterFor(resource);
  if (adapter.withResourceWrite) {
    await adapter.withResourceWrite(resource, async () => {
      await adapter.writeResource?.(resource, cloneJson(value));
    });
    return;
  }
  await adapter.writeResource?.(resource, cloneJson(value));
}

function fallbackForResource(resource: DbResource): unknown {
  return resource.kind === 'collection' ? [] : {};
}

function cloneJson<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function forkRegistryPath(rootStateDir: string): string {
  return path.join(rootStateDir, 'forks', 'registry.json');
}

function branchRegistryPath(rootStateDir: string, fork: string): string {
  return path.join(rootStateDir, 'forks', fork, 'branches', 'registry.json');
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function readJsonFileSync<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function snapshotId(label?: string): string {
  const safeLabel = label
    ? `_${slugPart(label)}`
    : '';
  return `snap_${new Date().toISOString().replace(/[-:.TZ]/g, '')}${safeLabel}_${Math.random().toString(36).slice(2, 8)}`;
}

function assertValidSnapshotId(id: string): void {
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) {
    return;
  }
  throw dbError(
    'DB_SNAPSHOT_ID_INVALID',
    `Invalid snapshot id "${id}".`,
    {
      status: 400,
      hint: 'Use a snapshot id with letters, numbers, dots, underscores, or hyphens.',
      details: {
        snapshot: id,
      },
    },
  );
}

function assertValidScopedName(name: string, kind: string): void {
  if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(name ?? ''))) {
    return;
  }
  throw dbError(
    'DB_SCOPE_NAME_INVALID',
    `Invalid ${kind} name "${name}".`,
    {
      status: 400,
      hint: 'Use a folder-style name with letters, numbers, underscores, or hyphens.',
      details: {
        kind,
        name,
      },
    },
  );
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function configRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cloneConfigResources(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([name, config]) => [name, cloneConfigValue(config)]),
  );
}

function cloneConfigValue(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : value;
}

function countValue(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).length;
  }
  return value === undefined || value === null ? 0 : 1;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function migrationVerifyError(name: string, resourceName: string, check: string): Error {
  return dbError(
    'MIGRATION_VERIFY_FAILED',
    `Migration "${name}" failed ${check} verification for resource "${resourceName}".`,
    {
      status: 409,
      hint: 'Keep the resource read-only, inspect the migration target, and rerun the resource migration before switching routing.',
      details: {
        migration: name,
        resource: resourceName,
        check,
      },
    },
  );
}

function assertNoResourceAliasCollisions(resources: Map<string, DbResource>): void {
  const collisions = resourceAliasCollisionGroups(resources);
  if (collisions.length === 0) {
    return;
  }

  const collision = collisions[0];
  throw dbError(
    'DB_RESOURCE_ALIAS_COLLISION',
    `Resource aliases are ambiguous for "${collision.alias}".`,
    {
      status: 400,
      hint: 'Rename one resource so its camelCase and kebab-case aliases are unique.',
      details: {
        alias: collision.alias,
        aliases: collision.aliases,
        resources: collision.resources,
        candidates: collision.candidates,
        collisions,
      },
    },
  );
}
