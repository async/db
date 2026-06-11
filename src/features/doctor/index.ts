import { loadProjectSchema } from '../../schema.js';
import { resourceConfigValue } from '../../names.js';
import { dbFileSystem } from '../fs/index.js';
import { backupMetaPath, readJsonState } from '../storage/json.js';
import { normalizeMockDelay } from '../../shared/mock.js';
import { duplicateIdFindings, mixedIdTypeFindings } from './duplicate-ids.js';
import { inconsistentFieldTypeFindings } from './field-consistency.js';
import { operationStrictModeFindings } from '../operations/readiness.js';
import { relationSuggestionFindings } from './relations.js';
import { schemaGuidanceFindings } from './schema-guidance.js';
import { scanDbUsage, type UsageManifest, type UsageRecommendation } from '../usage/scanner.js';

const BUILTIN_STORES = ['json', 'memory', 'sourceFile', 'static'];
const LARGE_JSON_STORE_RECORD_COUNT = 1000;

type DiagnosticSeverity = 'error' | 'warn' | 'info';

type DoctorDiagnostic = {
  code: string;
  severity?: DiagnosticSeverity;
  source?: string;
  resource?: string;
  field?: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
};

type DoctorFinding = {
  code: string;
  severity: DiagnosticSeverity;
  source: string;
  resource?: string;
  field?: string;
  message: string;
  hint: string;
  details: Record<string, unknown>;
  [key: string]: unknown;
};

type DoctorSummary = Record<DiagnosticSeverity, number>;

type DoctorField = {
  type?: string;
  required?: boolean;
  nullable?: boolean;
  values?: unknown[];
  items?: DoctorField;
  fields?: Record<string, DoctorField>;
  [key: string]: unknown;
};

type DoctorResource = {
  name: string;
  kind: string;
  idField: string;
  seed?: unknown[];
  schemaPath?: string | null;
  sourceFile?: string | null;
  dataPath?: string | null;
  fields?: Record<string, DoctorField>;
  relations?: Array<{ sourceField: string }>;
  [key: string]: unknown;
};

type DoctorProject = {
  resources: DoctorResource[];
  diagnostics: DoctorDiagnostic[];
};

type ResourceConfig = {
  store?: string;
  indexes?: unknown[];
  [key: string]: unknown;
};

type StoreConfig = string | {
  driver?: string;
  [key: string]: unknown;
};

type DoctorConfig = {
  cwd?: string;
  doctor?: {
    production?: boolean;
    usage?: boolean | {
      enabled?: boolean;
      target?: string;
      generatedAt?: string;
    };
  };
  schema?: Record<string, unknown>;
  resources?: Record<string, ResourceConfig>;
  stores?: Record<string, StoreConfig> & {
    default?: string;
  };
  [key: string]: unknown;
};

type DoctorResult = {
  summary: DoctorSummary;
  findings: DoctorFinding[];
  usage?: UsageManifest;
};

export async function runDbDoctor(config: DoctorConfig): Promise<DoctorResult> {
  const project = await loadProjectSchema(config) as DoctorProject;
  const inferredProject = await loadProjectSchema({
    ...config,
    schema: {
      ...config.schema,
      source: 'data',
    },
  }) as DoctorProject;
  const usage = await doctorUsageManifest(config);
  const findings: DoctorFinding[] = [
    ...project.diagnostics.map((diagnostic) => diagnosticToFinding(diagnostic, 'schema')),
    ...doctorResourceFindings(project.resources, config),
    ...schemaGuidanceFindings(project, inferredProject),
    ...await operationStrictModeFindings(config),
    ...await backupRecencyFindings(project.resources, config),
    ...usageFindings(usage),
  ];

  const result: DoctorResult = {
    summary: summarizeFindings(findings),
    findings,
  };
  if (usage) {
    result.usage = usage;
  }
  return result;
}

function diagnosticToFinding(diagnostic: DoctorDiagnostic, source: string): DoctorFinding {
  return {
    ...diagnostic,
    source: diagnostic.source ?? source,
    severity: diagnostic.severity ?? 'warn',
    hint: diagnostic.hint ?? '',
    details: diagnostic.details ?? {},
  };
}

function doctorResourceFindings(resources: DoctorResource[], config: DoctorConfig): DoctorFinding[] {
  const collections = resources.filter((resource): resource is DoctorResource & { seed: Array<Record<string, unknown>> } => (
    resource.kind === 'collection'
    && Array.isArray(resource.seed)
    && resource.seed.every((record) => isRecord(record))
  ));
  return [
    ...storeConfigFindings(resources, config),
    ...jsonProductionFindings(resources, config),
    ...phaseFindings(resources, config),
    ...mockProductionFindings(config),
    ...collections.flatMap((resource) => [
      ...duplicateIdFindings(resource),
      ...mixedIdTypeFindings(resource),
      ...inconsistentFieldTypeFindings(resource),
    ]),
    ...relationSuggestionFindings(collections),
  ];
}

async function doctorUsageManifest(config: DoctorConfig): Promise<UsageManifest | undefined> {
  const usage = config.doctor?.usage;
  if (!usage) {
    return undefined;
  }

  const options = typeof usage === 'object' ? usage : {};
  if (typeof usage === 'object' && usage.enabled === false) {
    return undefined;
  }

  return await scanDbUsage({
    cwd: config.cwd,
    target: options.target,
    generatedAt: options.generatedAt,
    production: config.doctor?.production === true,
  });
}

function usageFindings(manifest: UsageManifest | undefined): DoctorFinding[] {
  if (!manifest) {
    return [];
  }

  return manifest.recommendations.map((recommendation) => usageRecommendationFinding(recommendation, manifest));
}

function usageRecommendationFinding(recommendation: UsageRecommendation, manifest: UsageManifest): DoctorFinding {
  return {
    code: recommendation.code,
    severity: recommendation.severity,
    source: 'doctor',
    message: recommendation.message,
    hint: recommendation.hint,
    details: {
      ...recommendation.details,
      target: manifest.target,
      matches: manifest.summary.matches,
    },
  };
}

function jsonProductionFindings(resources: DoctorResource[], config: DoctorConfig): DoctorFinding[] {
  if (config.doctor?.production !== true) {
    return [];
  }

  return resources.flatMap((resource) => {
    const findings: DoctorFinding[] = [];
    const resourceConfig = resourceConfigValue(config.resources, resource.name);
    const storeName = resourceConfig?.store ?? config.stores?.default ?? 'json';
    const driver = resolveStoreDriver(storeName, config);
    if (driver !== 'json') {
      return findings;
    }

    findings.push({
      code: 'DOCTOR_JSON_PRODUCTION_REVIEW',
      severity: 'info',
      source: 'doctor',
      resource: resource.name,
      message: `Resource "${resource.name}" uses the JSON store in production mode.`,
      hint: 'Keep JSON-backed production resources small, low-write, single-writer, and backed up; move high-write, multi-writer, transactional, or compliance-heavy data to SQLite, Postgres, or another app-owned store.',
      details: {
        resource: resource.name,
        store: driver,
        kind: resource.kind,
        production: true,
      },
    });

    if (!resource.schemaPath) {
      findings.push({
        code: 'DOCTOR_JSON_PRODUCTION_SCHEMA_RECOMMENDED',
        severity: 'warn',
        source: 'doctor',
        resource: resource.name,
        message: `Production JSON resource "${resource.name}" does not have an explicit schema file.`,
        hint: `Add db/${resource.name}.schema.jsonc or a root db.schema.js entry so production writes validate against a reviewed contract.`,
        details: {
          resource: resource.name,
          store: driver,
          kind: resource.kind,
          production: true,
        },
      });
    }

    return findings;
  });
}

type LifecycleConfig = {
  resources?: Record<string, { phase?: string; store?: string; seedHash?: string | null }>;
};

/**
 * Phase gates: draft (the file is the live database) is the only phase the
 * production gate refuses; seed drift on promoted resources warns because
 * sync deliberately stops auto-reseeding past the pinned hash.
 */
function phaseFindings(resources: DoctorResource[], config: DoctorConfig): DoctorFinding[] {
  const lifecycle = (config as { lifecycle?: LifecycleConfig }).lifecycle;
  const findings: DoctorFinding[] = [];

  for (const resource of resources) {
    const entry = lifecycle?.resources?.[resource.name];
    const resourceConfig = resourceConfigValue(config.resources, resource.name);
    const storeName = entry?.store ?? resourceConfig?.store ?? config.stores?.default ?? 'json';
    const driver = resolveStoreDriver(storeName, config);

    if (config.doctor?.production === true && driver === 'sourceFile' && !entry) {
      findings.push({
        code: 'DOCTOR_DRAFT_IN_PRODUCTION',
        severity: 'error',
        source: 'doctor',
        resource: resource.name,
        message: `Resource "${resource.name}" is still in draft: the db/ file is the live database.`,
        hint: `Promote before shipping: \`async-db promote ${resource.name}\` (or \`--store file\` to keep the file canonical with production guarantees).`,
        details: {
          resource: resource.name,
          phase: 'draft',
          store: storeName,
          production: true,
        },
      });
    }

    const seedDrift = Boolean(entry?.seedHash && (resource as { dataHash?: string | null }).dataHash && (resource as { dataHash?: string | null }).dataHash !== entry.seedHash);
    if (seedDrift) {
      findings.push({
        code: 'DOCTOR_SEED_DRIFT',
        severity: 'warn',
        source: 'doctor',
        resource: resource.name,
        message: `Promoted resource "${resource.name}" has a seed file that changed after promotion; live state was preserved.`,
        hint: `Seed files stop feeding production after promote. Run \`async-db reseed ${resource.name} --force\` to apply the new seed deliberately, or revert the seed edit.`,
        details: {
          resource: resource.name,
          pinnedSeedHash: entry?.seedHash,
          currentSeedHash: (resource as { dataHash?: string | null }).dataHash,
        },
      });
    }
  }

  return findings;
}

const BACKUP_RECENCY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

async function backupRecencyFindings(resources: DoctorResource[], config: DoctorConfig): Promise<DoctorFinding[]> {
  if (config.doctor?.production !== true || !config.stateDir || resources.length === 0) {
    return [];
  }

  const usesJsonStore = resources.some((resource) => {
    const resourceConfig = resourceConfigValue(config.resources, resource.name);
    const storeName = resourceConfig?.store ?? config.stores?.default ?? 'json';
    return resolveStoreDriver(storeName, config) === 'json';
  });
  if (!usesJsonStore) {
    return [];
  }

  const meta = await readJsonState<{ lastBackupAt?: string } | undefined>(
    backupMetaPath(config as { stateDir: string }),
    undefined,
    dbFileSystem(config),
  ).catch(() => undefined);
  const lastBackupAt = meta?.lastBackupAt ? Date.parse(meta.lastBackupAt) : Number.NaN;
  const age = Date.now() - lastBackupAt;

  if (Number.isFinite(age) && age >= 0 && age < BACKUP_RECENCY_THRESHOLD_MS) {
    return [];
  }

  return [{
    code: 'DOCTOR_JSON_BACKUP_RECOMMENDED',
    severity: 'info',
    source: 'doctor',
    message: Number.isFinite(lastBackupAt)
      ? `The last \`async-db backup\` ran ${Math.round(age / 86_400_000)} day(s) ago.`
      : 'No `async-db backup` bundle has been recorded for this project.',
    hint: 'Run `async-db backup` (and store the bundle off-machine) before treating JSON-backed resources as production data; schedule it alongside deployments.',
    details: {
      lastBackupAt: meta?.lastBackupAt ?? null,
      thresholdDays: 7,
      production: true,
    },
  }];
}

function mockProductionFindings(config: DoctorConfig): DoctorFinding[] {
  if (config.doctor?.production !== true) {
    return [];
  }

  const mock = (config.mock ?? config.chaos) as {
    delay?: number | [number, number] | { minMs?: number; maxMs?: number; min?: number; max?: number } | false;
    delayMs?: number | [number, number] | { minMs?: number; maxMs?: number; min?: number; max?: number } | false;
    errors?: number | { rate?: number; probability?: number } | false | null;
    error?: number | { rate?: number; probability?: number } | false | null;
    production?: boolean;
  } | false | null | undefined;
  if (!mock) {
    return [];
  }

  const delay = normalizeMockDelay(mock.delay ?? mock.delayMs);
  const errors = mock.errors ?? mock.error;
  const errorRate = typeof errors === 'number'
    ? errors
    : Number((errors as { rate?: number; probability?: number } | null | undefined)?.rate
      ?? (errors as { probability?: number } | null | undefined)?.probability
      ?? 0);
  if (delay.maxMs <= 0 && errorRate <= 0) {
    return [];
  }

  if (mock.production === true) {
    return [{
      code: 'DOCTOR_MOCK_PRODUCTION_ENABLED',
      severity: 'warn',
      source: 'doctor',
      message: 'mock.production: true keeps artificial response delays and chaos errors active under NODE_ENV=production.',
      hint: 'Remove mock.production (or set mock.delay: false and mock.errors: false) before serving real traffic; keep it only for chaos testing environments.',
      details: {
        delay,
        errorRate,
        production: true,
      },
    }];
  }

  return [{
    code: 'DOCTOR_MOCK_PRODUCTION_DISABLED',
    severity: 'info',
    source: 'doctor',
    message: 'Configured mock delay/error behavior is skipped automatically when NODE_ENV=production.',
    hint: 'Set mock.delay: false to silence this note, or mock.production: true to deliberately keep mock behavior in production.',
    details: {
      delay,
      errorRate,
      production: false,
    },
  }];
}

function storeConfigFindings(resources: DoctorResource[], config: DoctorConfig): DoctorFinding[] {
  return resources.flatMap((resource) => {
    const findings: DoctorFinding[] = [];
    const resourceConfig = resourceConfigValue(config.resources, resource.name);
    const storeName = resourceConfig?.store ?? config.stores?.default ?? 'json';
    const availableStores = configuredStoreNames(config);

    if (!availableStores.includes(storeName) && config.stores?.[storeName] === undefined) {
      findings.push({
        code: 'DOCTOR_STORE_NOT_FOUND',
        severity: 'error',
        source: 'doctor',
        resource: resource.name,
        message: `Resource "${resource.name}" is configured with missing store "${storeName}".`,
        hint: `Configure stores.${storeName}, choose stores.default, or use one of: ${availableStores.join(', ')}.`,
        details: {
          resource: resource.name,
          store: storeName,
          availableStores,
        },
      });
      return findings;
    }

    const driver = resolveStoreDriver(storeName, config);
    if (
      resource.kind === 'collection'
      && driver === 'json'
      && Array.isArray(resource.seed)
      && resource.seed.length > LARGE_JSON_STORE_RECORD_COUNT
      && !hasIndexMetadata(resourceConfig)
    ) {
      findings.push({
        code: 'DOCTOR_LARGE_JSON_STORE_WITHOUT_INDEXES',
        severity: 'warn',
        source: 'doctor',
        resource: resource.name,
        message: `Resource "${resource.name}" has ${resource.seed.length} records in the JSON store without index metadata.`,
        hint: `Add resources.${resource.name}.indexes for dashboard or range-query fields, or bind the resource to a store better suited for large collections.`,
        details: {
          resource: resource.name,
          store: driver,
          recordCount: resource.seed.length,
        },
      });
    }

    return findings;
  });
}

function configuredStoreNames(config: DoctorConfig): string[] {
  return [
    ...new Set([
      ...BUILTIN_STORES,
      ...Object.keys(config.stores ?? {}).filter((name) => name !== 'default'),
    ]),
  ];
}

function resolveStoreDriver(storeName: string, config: DoctorConfig): string {
  const configured = config.stores?.[storeName] ?? storeName;
  if (typeof configured === 'string') {
    return configured;
  }
  if (configured && typeof configured === 'object' && 'driver' in configured) {
    return configured.driver;
  }
  return storeName;
}

function hasIndexMetadata(resourceConfig: ResourceConfig | undefined): boolean {
  return Array.isArray(resourceConfig?.indexes) && resourceConfig.indexes.length > 0;
}

function summarizeFindings(findings: DoctorFinding[]): DoctorSummary {
  return findings.reduce((summary, finding) => {
    summary[finding.severity] = (summary[finding.severity] ?? 0) + 1;
    return summary;
  }, {
    error: 0,
    warn: 0,
    info: 0,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
