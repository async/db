import { loadProjectSchema } from '../../schema.js';
import { forkSourceExists, isValidForkName } from '../config/forks.js';
import { resourceConfigValue } from '../../names.js';
import { duplicateIdFindings, mixedIdTypeFindings } from './duplicate-ids.js';
import { inconsistentFieldTypeFindings } from './field-consistency.js';
import { operationStrictModeFindings } from '../operations/readiness.js';
import { relationSuggestionFindings } from './relations.js';
import { schemaGuidanceFindings } from './schema-guidance.js';

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

type ForkConfig = DoctorConfig & {
  sourceDir: string;
};

type DoctorConfig = {
  doctor?: {
    production?: boolean;
  };
  schema?: Record<string, unknown>;
  resources?: Record<string, ResourceConfig>;
  stores?: Record<string, StoreConfig> & {
    default?: string;
  };
  templates?: Record<string, ForkConfig>;
  forks?: Record<string, ForkConfig>;
  [key: string]: unknown;
};

type DoctorResult = {
  summary: DoctorSummary;
  findings: DoctorFinding[];
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
  const findings: DoctorFinding[] = [
    ...project.diagnostics.map((diagnostic) => diagnosticToFinding(diagnostic, 'schema')),
    ...doctorResourceFindings(project.resources, config),
    ...schemaGuidanceFindings(project, inferredProject),
    ...await operationStrictModeFindings(config),
    ...await doctorForkFindings(config),
  ];

  return {
    summary: summarizeFindings(findings),
    findings,
  };
}

async function doctorForkFindings(config: DoctorConfig): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  for (const [forkName, forkConfig] of Object.entries(config.forks ?? {})) {
    if (!isValidForkName(forkName)) {
      findings.push({
        code: 'FORK_NAME_INVALID',
        severity: 'error',
        source: 'doctor',
        message: `Invalid db fork name "${forkName}".`,
        hint: 'Use a folder-style name with letters, numbers, underscores, or hyphens, such as "legacy-demo".',
        details: {
          fork: forkName,
        },
      });
      continue;
    }

    if (!await forkSourceExists(forkConfig)) {
      findings.push({
        code: 'FORK_SOURCE_MISSING',
        severity: 'error',
        source: 'doctor',
        message: `fixture template "${forkName}" source folder does not exist: ${forkConfig.sourceDir}`,
        hint: `Create db.templates/${forkName}/ or update templates["${forkName}"] in db.config.mjs.`,
        details: {
          fork: forkName,
          sourceDir: forkConfig.sourceDir,
        },
      });
      continue;
    }

    try {
      const project = await loadProjectSchema(forkConfig) as DoctorProject;
      findings.push(
        ...project.diagnostics.map((diagnostic) => annotateForkFinding(forkName, 'schema', diagnostic)),
        ...doctorResourceFindings(project.resources, forkConfig).map((finding) => annotateForkFinding(forkName, 'doctor', finding)),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      findings.push({
        code: 'FORK_SCHEMA_INVALID',
        severity: 'error',
        source: 'doctor',
        message: `db fork "${forkName}" could not be loaded: ${message}`,
        hint: `Fix the fork source files in ${forkConfig.sourceDir}.`,
        details: {
          fork: forkName,
          sourceDir: forkConfig.sourceDir,
        },
      });
    }
  }

  return findings;
}

function annotateForkFinding(forkName: string, source: string, finding: DoctorDiagnostic): DoctorFinding {
  const normalized = diagnosticToFinding(finding, source);
  return {
    ...normalized,
    source,
    message: `Fork "${forkName}": ${normalized.message}`,
    details: {
      ...normalized.details,
      fork: forkName,
    },
  };
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
    ...collections.flatMap((resource) => [
      ...duplicateIdFindings(resource),
      ...mixedIdTypeFindings(resource),
      ...inconsistentFieldTypeFindings(resource),
    ]),
    ...relationSuggestionFindings(collections),
  ];
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
