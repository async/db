import { loadProjectSchema } from '../../schema.js';
import { forkSourceExists, isValidForkName } from '../config/forks.js';
import { resourceConfigValue } from '../../names.js';
import { duplicateIdFindings, mixedIdTypeFindings } from './duplicate-ids.js';
import { inconsistentFieldTypeFindings } from './field-consistency.js';
import { relationSuggestionFindings } from './relations.js';
import { schemaGuidanceFindings } from './schema-guidance.js';

const BUILTIN_STORES = ['json', 'memory', 'sourceFile', 'static'];
const LARGE_JSON_STORE_RECORD_COUNT = 1000;

export async function runDbDoctor(config) {
  const project = await loadProjectSchema(config);
  const inferredProject = await loadProjectSchema({
    ...config,
    schema: {
      ...config.schema,
      source: 'data',
    },
  });
  const findings = [
    ...project.diagnostics.map((diagnostic) => ({
      source: 'schema',
      ...diagnostic,
      severity: diagnostic.severity ?? 'warn',
    })),
    ...doctorResourceFindings(project.resources, config),
    ...schemaGuidanceFindings(project, inferredProject),
    ...await doctorForkFindings(config),
  ];

  return {
    summary: summarizeFindings(findings),
    findings,
  };
}

async function doctorForkFindings(config) {
  const findings = [];
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
        message: `db fork "${forkName}" source folder does not exist: ${forkConfig.sourceDir}`,
        hint: `Create db.forks/${forkName}/ or update forks["${forkName}"] in db.config.mjs.`,
        details: {
          fork: forkName,
          sourceDir: forkConfig.sourceDir,
        },
      });
      continue;
    }

    try {
      const project = await loadProjectSchema(forkConfig);
      findings.push(
        ...project.diagnostics.map((diagnostic) => annotateForkFinding(forkName, 'schema', diagnostic)),
        ...doctorResourceFindings(project.resources, forkConfig).map((finding) => annotateForkFinding(forkName, 'doctor', finding)),
      );
    } catch (error) {
      findings.push({
        code: 'FORK_SCHEMA_INVALID',
        severity: 'error',
        source: 'doctor',
        message: `db fork "${forkName}" could not be loaded: ${error.message}`,
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

function annotateForkFinding(forkName, source, finding) {
  return {
    ...finding,
    source,
    message: `Fork "${forkName}": ${finding.message}`,
    details: {
      ...(finding.details ?? {}),
      fork: forkName,
    },
  };
}

function doctorResourceFindings(resources, config) {
  const collections = resources.filter((resource) => resource.kind === 'collection' && Array.isArray(resource.seed));
  return [
    ...storeConfigFindings(resources, config),
    ...collections.flatMap((resource) => [
      ...duplicateIdFindings(resource),
      ...mixedIdTypeFindings(resource),
      ...inconsistentFieldTypeFindings(resource),
    ]),
    ...relationSuggestionFindings(collections),
  ];
}

function storeConfigFindings(resources, config) {
  return resources.flatMap((resource) => {
    const findings = [];
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

function configuredStoreNames(config) {
  return [
    ...new Set([
      ...BUILTIN_STORES,
      ...Object.keys(config.stores ?? {}).filter((name) => name !== 'default'),
    ]),
  ];
}

function resolveStoreDriver(storeName, config) {
  const configured = config.stores?.[storeName] ?? storeName;
  if (typeof configured === 'string') {
    return configured;
  }
  if (configured && typeof configured === 'object' && 'driver' in configured) {
    return configured.driver;
  }
  return storeName;
}

function hasIndexMetadata(resourceConfig) {
  return Array.isArray(resourceConfig?.indexes) && resourceConfig.indexes.length > 0;
}

function summarizeFindings(findings) {
  return findings.reduce((summary, finding) => {
    summary[finding.severity] = (summary[finding.severity] ?? 0) + 1;
    return summary;
  }, {
    error: 0,
    warn: 0,
    info: 0,
  });
}
