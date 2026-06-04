import path from 'node:path';
import { loadConfig } from '../../config.js';
import { dbError, listChoices } from '../../errors.js';
import { resolveResource, resourceAliasCollisionGroups } from '../../names.js';
import { createDbOperationHandler } from '../../operations.js';
import { loadProjectSchema } from '../../schema.js';
import { syncDb } from '../../sync.js';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';
import { createRuntime } from '../storage/runtime.js';
import { DbCollection } from './collection.js';
import { DbDocument } from './document.js';
import {
  assertValidScopedName,
  assertValidSnapshotId,
  branchRegistryPath,
  cloneConfigResources,
  configRecord,
  type DbScope,
  forkRegistryPath,
  loadPersistedMigrationLocks,
  type MigrationLock,
  type MigrationResourceCopy,
  migrationLocksPathForScope,
  normalizeScopedConfig,
  readJsonFile,
  readJsonFileSync,
  routingPathForScope,
  scopedConfig,
  snapshotDirForScope,
  snapshotId,
  writeJsonFile,
} from './scope-state.js';

type DbConfig = {
  cwd: string;
  stateDir: string;
  fs?: DbFileSystem;
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

type ForkSource =
  | 'main'
  | { fork?: string | null; branch: string }
  | { fork?: string | null; snapshot: string };

type ForkCreateOptions = {
  from?: ForkSource;
  metadata?: Record<string, unknown>;
};

type BranchCreateOptions = {
  from?: string;
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

type SnapshotResult = {
  id: string;
  label?: string;
  fork: string | null;
  branch: string;
  resources: string[];
  path: string;
};

type ResolvedForkSource =
  | { kind: 'db'; label: string; db: Db }
  | { kind: 'snapshot'; label: string; snapshotDir: string; resources: string[] };

class DbResourceRegistry extends Map<string, DbResource> {
  constructor(
    entries: Array<[string, DbResource]>,
    private readonly migrateResource: (name: string, options: ResourceMigrateOptions) => Promise<void>,
  ) {
    super(entries);
  }

  migrate(name: string, options: ResourceMigrateOptions): Promise<void> {
    return this.migrateResource(name, options);
  }
}

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
  resources: DbResourceRegistry;
  diagnostics: unknown[];
  schemaVersion: number;
  runtime: RuntimeFacade;
  events: RuntimeFacade['events'];
  scope: DbScope;
  forks: {
    create: (name: string, options?: ForkCreateOptions) => Promise<Db>;
    open: (name: string) => Promise<Db>;
    ensure: (name: string, options?: ForkCreateOptions) => Promise<Db>;
    list: () => Promise<Array<Record<string, unknown>>>;
    delete: (name: string) => Promise<boolean>;
  };
  branches: {
    create: (name: string, options?: BranchCreateOptions) => Promise<Db>;
    open: (name: string) => Promise<Db>;
    ensure: (name: string, options?: BranchCreateOptions) => Promise<Db>;
    list: () => Promise<Array<Record<string, unknown>>>;
    delete: (name: string) => Promise<boolean>;
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

  constructor(config: DbConfig, resources: DbResource[], diagnostics: unknown[] = [], scope?: DbScope) {
    const scoped = normalizeScopedConfig(config, scope);
    this.config = scoped.config as DbConfig;
    this.resources = this.createResourceRegistry(resources);
    this.diagnostics = diagnostics;
    this.schemaVersion = Date.now();
    this.scope = scoped.scope;
    this.runtime = createRuntime(this.config, resources);
    this.events = this.runtime.events;
    this.migrationLocks = loadPersistedMigrationLocks(this.scope, this.fs());
    this.forks = {
      create: (name, options = {}) => this.createFork(name, options),
      open: (name) => this.openFork(name),
      ensure: (name, options = {}) => this.ensureFork(name, options),
      list: () => this.listForks(),
      delete: (name) => this.deleteFork(name),
    };
    this.branches = {
      create: (name, options = {}) => this.createBranch(name, options),
      open: (name) => this.openBranch(name),
      ensure: (name, options = {}) => this.ensureBranch(name, options),
      list: () => this.listBranches(),
      delete: (name) => this.deleteBranch(name),
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
  }

  replaceResources(resources: DbResource[], diagnostics: unknown[] = this.diagnostics): void {
    this.resources = this.createResourceRegistry(resources);
    this.diagnostics = diagnostics;
    this.schemaVersion = Date.now();
  }

  private createResourceRegistry(resources: DbResource[]): DbResourceRegistry {
    const registry = new DbResourceRegistry(
      resources.map((resource) => [resource.name, resource]),
      (name, options) => this.migrateResource(name, options),
    );
    assertNoResourceAliasCollisions(registry);
    return registry;
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
    this.assertRootForkLifecycle('open fork');
    this.assertForkExists(name);
    this.assertBranchExists(name, 'main');
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
          hint: 'Open a fork with await db.forks.open("tenant_id"), then open a branch with await tenant.branches.open(name).',
          details: {
            branch: name,
          },
        },
      );
    }
    this.assertBranchExists(this.scope.fork, name);
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
    this.assertRootForkLifecycle('create fork');
    const now = new Date().toISOString();
    const registryPath = forkRegistryPath(this.scope.rootStateDir);
    const registry = await this.readJsonFile(registryPath, { forks: {} });
    if (configRecord(registry.forks)[name]) {
      throw dbError(
        'DB_FORK_ALREADY_EXISTS',
        `Fork "${name}" already exists.`,
        {
          status: 409,
          hint: 'Open it with db.forks.open(name), or use db.forks.ensure(name, options) for idempotent setup.',
          details: {
            fork: name,
          },
        },
      );
    }

    const source = await this.resolveForkSource(options.from);
    const target = this.scopedDb({
      fork: name,
      branch: 'main',
      rootStateDir: this.scope.rootStateDir,
    });

    await copyForkSource(source, target, this.resourceNames());

    registry.forks = {
      ...configRecord(registry.forks),
      [name]: {
        id: name,
        metadata: options.metadata ?? {},
        from: serializeForkSource(options.from),
        createdAt: now,
      },
    };
    await this.writeJsonFile(registryPath, registry);

    await this.writeBranchRegistry(name, {
      main: {
        id: 'main',
        metadata: {},
        from: source.label,
        createdAt: now,
      },
    });

    return target;
  }

  private async openFork(name: string): Promise<Db> {
    return this.fork(name);
  }

  private async ensureFork(name: string, options: ForkCreateOptions = {}): Promise<Db> {
    assertValidScopedName(name, 'fork');
    this.assertRootForkLifecycle('ensure fork');
    const registry = await this.readJsonFile(forkRegistryPath(this.scope.rootStateDir), { forks: {} });
    if (configRecord(registry.forks)[name]) {
      return this.openFork(name);
    }
    return this.createFork(name, options);
  }

  private async listForks(): Promise<Array<Record<string, unknown>>> {
    this.assertRootForkLifecycle('list forks');
    const registry = await this.readJsonFile(forkRegistryPath(this.scope.rootStateDir), { forks: {} });
    return Object.values(registry.forks ?? {});
  }

  private async deleteFork(name: string): Promise<boolean> {
    assertValidScopedName(name, 'fork');
    this.assertRootForkLifecycle('delete fork');
    const registryPath = forkRegistryPath(this.scope.rootStateDir);
    const registry = await this.readJsonFile(registryPath, { forks: {} });
    const existed = Boolean(registry.forks?.[name]);
    if (registry.forks) {
      delete registry.forks[name];
    }
    await this.writeJsonFile(registryPath, registry);
    await this.fs().rm(path.join(this.scope.rootStateDir, 'forks', name), { force: true, recursive: true });
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
          hint: 'Open a fork with await db.forks.open("tenant_id"), then create a branch with await tenant.branches.create(name).',
          details: {
            branch: name,
          },
        },
      );
    }
    const registryPath = branchRegistryPath(this.scope.rootStateDir, this.scope.fork);
    const registry = await this.readJsonFile(registryPath, { branches: {} });
    if (configRecord(registry.branches)[name]) {
      throw dbError(
        'DB_BRANCH_ALREADY_EXISTS',
        `Branch "${name}" already exists in fork "${this.scope.fork}".`,
        {
          status: 409,
          hint: 'Open it with tenant.branches.open(branch), or use tenant.branches.ensure(branch, options) for idempotent setup.',
          details: {
            fork: this.scope.fork,
            branch: name,
          },
        },
      );
    }

    const source = this.branch(options.from ?? this.scope.branch ?? 'main');
    const target = this.scopedDb({
      fork: this.scope.fork,
      branch: name,
      rootStateDir: this.scope.rootStateDir,
    });
    await copyResources(source, target, this.resourceNames());

    registry.branches = {
      ...configRecord(registry.branches),
      [name]: {
        id: name,
        metadata: options.metadata ?? {},
        from: options.from ?? this.scope.branch ?? 'main',
        createdAt: new Date().toISOString(),
      },
    };
    await this.writeJsonFile(registryPath, registry);
    return target;
  }

  private async openBranch(name: string): Promise<Db> {
    return this.branch(name);
  }

  private async ensureBranch(name: string, options: BranchCreateOptions = {}): Promise<Db> {
    assertValidScopedName(name, 'branch');
    if (!this.scope.fork) {
      throw dbError(
        'DB_BRANCH_REQUIRES_FORK',
        `Cannot ensure branch "${name}" without a fork.`,
        {
          status: 400,
          hint: 'Open or create a fork before ensuring a branch.',
          details: {
            branch: name,
          },
        },
      );
    }
    const registry = await this.readJsonFile(branchRegistryPath(this.scope.rootStateDir, this.scope.fork), { branches: {} });
    if (configRecord(registry.branches)[name]) {
      return this.openBranch(name);
    }
    return this.createBranch(name, options);
  }

  private async listBranches(): Promise<Array<Record<string, unknown>>> {
    if (!this.scope.fork) {
      throw dbError(
        'DB_BRANCH_REQUIRES_FORK',
        'Cannot list branches without a fork.',
        {
          status: 400,
          hint: 'Open a fork before listing its branches.',
          details: {},
        },
      );
    }
    const registry = await this.readJsonFile(branchRegistryPath(this.scope.rootStateDir, this.scope.fork), { branches: {} });
    return Object.values(registry.branches ?? {});
  }

  private async deleteBranch(name: string): Promise<boolean> {
    assertValidScopedName(name, 'branch');
    if (!this.scope.fork) {
      throw dbError(
        'DB_BRANCH_REQUIRES_FORK',
        `Cannot delete branch "${name}" without a fork.`,
        {
          status: 400,
          hint: 'Open a fork before deleting one of its branches.',
          details: {
            branch: name,
          },
        },
      );
    }
    if (name === 'main') {
      throw dbError(
        'DB_BRANCH_MAIN_DELETE_FORBIDDEN',
        'Cannot delete the main branch.',
        {
          status: 400,
          hint: 'Delete the entire fork with db.forks.delete(name), or delete a non-main branch.',
          details: {
            fork: this.scope.fork,
            branch: name,
          },
        },
      );
    }

    const registryPath = branchRegistryPath(this.scope.rootStateDir, this.scope.fork);
    const registry = await this.readJsonFile(registryPath, { branches: {} });
    const existed = Boolean(configRecord(registry.branches)[name]);
    registry.branches = { ...configRecord(registry.branches) };
    delete registry.branches[name];
    await this.writeJsonFile(registryPath, registry);
    await this.fs().rm(path.join(this.scope.rootStateDir, 'forks', this.scope.fork, 'branches', name), {
      force: true,
      recursive: true,
    });
    return existed;
  }

  private async createSnapshot(options: SnapshotCreateOptions = {}): Promise<SnapshotResult> {
    const resources = options.resources ?? this.resourceNames();
    const id = snapshotId(options.label);
    const snapshotDir = snapshotDirForScope(this.scope, id);
    const resourcesDir = path.join(snapshotDir, 'resources');
    await this.fs().mkdir(resourcesDir, { recursive: true });

    for (const resourceName of resources) {
      const resource = this.resourceForName(resourceName);
      const value = await readResourceValue(this, resource);
      await this.writeJsonFile(path.join(resourcesDir, `${resource.name}.json`), value);
    }

    const manifest = {
      id,
      label: options.label,
      fork: this.scope.fork,
      branch: this.scope.branch,
      resources,
      createdAt: new Date().toISOString(),
    };
    await this.writeJsonFile(path.join(snapshotDir, 'manifest.json'), manifest);
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
    const snapshotDir = snapshotDirForScope(this.scope, id);
    const manifest = await this.readJsonFile(path.join(snapshotDir, 'manifest.json'), null);
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
      const value = await this.readJsonFile(path.join(snapshotDir, 'resources', `${resource.name}.json`), undefined);
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
    await this.persistMigrationLocks();
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
      await this.recordMigrationCopy(migrationName, resource.name, {
        resource: resource.name,
        from: options.from,
        to: options.to,
        copiedAt: new Date().toISOString(),
      });
    }
  }

  private async verifyMigration(name: string, options: MigrationVerifyOptions): Promise<void> {
    const checks = options.checks ?? ['count', 'schema', 'checksum'];
    const lock = this.migrationLocks.get(name);
    for (const resourceName of options.resources) {
      const resource = this.resourceForName(resourceName);
      const copy = lock?.copies?.[resource.name];
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
    await this.persistMigrationLocks();
  }

  private async setRouting(routes: Record<string, string>): Promise<Record<string, string>> {
    const persistedRoutes = await this.readJsonFile(this.routingPath(), {} as Record<string, string>);
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
    await this.writeJsonFile(this.routingPath(), nextRoutes);
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

  private assertRootForkLifecycle(action: string): void {
    if (!this.scope.fork) {
      return;
    }
    throw dbError(
      'DB_FORK_REQUIRES_ROOT',
      `Cannot ${action} from fork "${this.scope.fork}".`,
      {
        status: 400,
        hint: 'Use the root db handle for fork lifecycle methods. Pass an explicit from source when creating a fork from another fork or branch.',
        details: {
          fork: this.scope.fork,
          branch: this.scope.branch,
          action,
        },
      },
    );
  }

  private assertForkExists(name: string): void {
    const registry = this.readJsonFileSync(forkRegistryPath(this.scope.rootStateDir), { forks: {} });
    if (configRecord(registry.forks)[name]) {
      return;
    }
    throw dbError(
      'DB_FORK_NOT_FOUND',
      `Fork "${name}" was not found.`,
      {
        status: 404,
        hint: 'Create the fork with db.forks.create(name) before opening it, or check the fork id.',
        details: {
          fork: name,
        },
      },
    );
  }

  private assertBranchExists(fork: string, name: string): void {
    const registry = this.readJsonFileSync(branchRegistryPath(this.scope.rootStateDir, fork), { branches: {} });
    if (configRecord(registry.branches)[name]) {
      return;
    }
    throw dbError(
      'DB_BRANCH_NOT_FOUND',
      `Branch "${name}" was not found in fork "${fork}".`,
      {
        status: 404,
        hint: 'Create the branch with tenant.branches.create(branch) before opening it, or check the branch id.',
        details: {
          fork,
          branch: name,
        },
      },
    );
  }

  private async resolveForkSource(from: ForkSource | undefined): Promise<ResolvedForkSource> {
    if (from === undefined || from === 'main') {
      return {
        kind: 'db',
        label: 'main',
        db: this,
      };
    }

    if (typeof from === 'string') {
      throw dbError(
        'DB_FORK_SOURCE_UNSUPPORTED',
        `Unsupported fork source "${from}".`,
        {
          status: 400,
          hint: 'Use from: "main", from: { fork, branch }, or from: { fork, snapshot } so the source is unambiguous.',
          details: {
            from,
          },
        },
      );
    }

    if ('snapshot' in from) {
      const sourceScope = this.sourceScope(from.fork ?? this.scope.fork ?? null, this.scope.branch);
      const snapshot = String(from.snapshot);
      assertValidSnapshotId(snapshot);
      const snapshotDir = snapshotDirForScope(sourceScope, snapshot);
      const manifest = await this.readJsonFile(path.join(snapshotDir, 'manifest.json'), null);
      if (!manifest) {
        throw dbError(
          'DB_SNAPSHOT_NOT_FOUND',
          `Snapshot "${snapshot}" was not found.`,
          {
            status: 404,
            hint: 'Create the snapshot before using it as a fork source, or pass the fork that owns the snapshot.',
            details: {
              snapshot,
              fork: sourceScope.fork,
            },
          },
        );
      }
      const manifestRecord = configRecord(manifest);
      return {
        kind: 'snapshot',
        label: `snapshot:${snapshot}`,
        snapshotDir,
        resources: Array.isArray(manifestRecord.resources)
          ? manifestRecord.resources.map(String)
          : this.resourceNames(),
      };
    }

    const sourceBranch = from.branch;
    if (typeof sourceBranch !== 'string') {
      throw dbError(
        'DB_FORK_SOURCE_UNSUPPORTED',
        'Fork branch sources must include a branch name.',
        {
          status: 400,
          hint: 'Use from: { fork: "tenant_id", branch: "main" } when copying from another fork branch.',
          details: {
            from,
          },
        },
      );
    }
    const sourceScope = this.sourceScope(from.fork ?? this.scope.fork ?? null, sourceBranch);
    if (sourceScope.fork) {
      this.assertForkExists(sourceScope.fork);
      this.assertBranchExists(sourceScope.fork, sourceScope.branch);
    } else if (sourceScope.branch !== 'main') {
      throw dbError(
        'DB_BRANCH_REQUIRES_FORK',
        `Cannot use root branch "${sourceScope.branch}" as a fork source.`,
        {
          status: 400,
          hint: 'Only root main can be used without a fork. Use from: { fork, branch } for branch sources.',
          details: {
            branch: sourceScope.branch,
          },
        },
      );
    }

    return {
      kind: 'db',
      label: sourceScope.fork
        ? `fork:${sourceScope.fork}/branch:${sourceScope.branch}`
        : sourceScope.branch,
      db: this.scopedDb(sourceScope),
    };
  }

  private sourceScope(fork: string | null, branch = 'main'): DbScope {
    if (fork) {
      assertValidScopedName(fork, 'fork');
    }
    assertValidScopedName(branch, 'branch');
    return {
      fork,
      branch,
      rootStateDir: this.scope.rootStateDir,
    };
  }

  private async writeBranchRegistry(fork: string, branches: Record<string, Record<string, unknown>>): Promise<void> {
    const registryPath = branchRegistryPath(this.scope.rootStateDir, fork);
    const registry = await this.readJsonFile(registryPath, { branches: {} });
    registry.branches = {
      ...configRecord(registry.branches),
      ...branches,
    };
    await this.writeJsonFile(registryPath, registry);
  }

  private async recordMigrationCopy(
    migrationName: string,
    resourceName: string,
    copy: MigrationResourceCopy,
  ): Promise<void> {
    const lock = this.migrationLocks.get(migrationName);
    if (!lock) {
      return;
    }
    lock.copies = {
      ...(lock.copies ?? {}),
      [resourceName]: copy,
    };
    this.migrationLocks.set(migrationName, lock);
    await this.persistMigrationLocks();
  }

  private async persistMigrationLocks(): Promise<void> {
    await this.writeJsonFile(this.migrationLocksPath(), {
      locks: Object.fromEntries(this.migrationLocks),
    });
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

  private fs(): DbFileSystem {
    return dbFileSystem(this.config);
  }

  private readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    return readJsonFile(filePath, fallback, this.fs());
  }

  private writeJsonFile(filePath: string, value: unknown): Promise<void> {
    return writeJsonFile(filePath, value, this.fs());
  }

  private readJsonFileSync<T>(filePath: string, fallback: T): T {
    return readJsonFileSync(filePath, fallback, this.fs());
  }

}

export function stateFileForDebug(db: Db, resourceName: string): string {
  return path.join(db.config.stateDir, 'state', `${resourceName}.json`);
}

async function copyResources(source: Db, target: Db, resourceNames: string[]): Promise<void> {
  for (const resourceName of resourceNames) {
    const resource = source.resourceForName(resourceName);
    const value = await readResourceValue(source, resource);
    await writeResourceValue(target, resource, value);
  }
}

async function copyForkSource(source: ResolvedForkSource, target: Db, resourceNames: string[]): Promise<void> {
  if (source.kind === 'db') {
    await copyResources(source.db, target, resourceNames);
    return;
  }

  for (const resourceName of source.resources) {
    const resource = target.resourceForName(resourceName);
    const value = await readJsonFile(path.join(source.snapshotDir, 'resources', `${resource.name}.json`), undefined, dbFileSystem(target.config));
    if (value !== undefined) {
      await writeResourceValue(target, resource, value);
    }
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

function serializeForkSource(from: ForkSource | undefined): unknown {
  return from ?? 'main';
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
