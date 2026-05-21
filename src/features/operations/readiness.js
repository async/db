import { readFile } from 'node:fs/promises';
import { normalizeOperationTemplate } from '../../shared/operations.js';
import { buildOperationRegistry } from './index.js';

export const OPERATIONS_STRICT_MODE_CODE = 'OPERATIONS_STRICT_MODE_WITHOUT_OPERATIONS';
const ACCEPT_REFS_RECOMMENDATION_CODE = 'OPERATIONS_STRICT_MODE_ACCEPT_REFS_RECOMMENDED';

export async function operationStrictModeFindings(config, options = {}) {
  if (config.server?.expose?.rest !== 'registered-only') {
    return [];
  }

  const includeGuidance = options.includeGuidance !== false;
  const readiness = await operationStrictModeReadiness(config);
  if (!readiness.ready) {
    return [operationStrictModeDiagnostic(readiness)];
  }

  if (includeGuidance && (config.operations?.acceptRefs ?? 'both') !== 'ref') {
    return [operationAcceptRefsRecommendation(config)];
  }

  return [];
}

export async function assertOperationStrictModeReady(config) {
  const findings = await operationStrictModeFindings(config, {
    includeGuidance: false,
  });
  const errors = findings.filter((finding) => finding.severity === 'error');
  if (errors.length === 0) {
    return;
  }

  const error = new Error(errors.map((finding) => finding.message).join('\n'));
  error.code = errors[0].code;
  error.hint = errors[0].hint;
  error.details = errors[0].details;
  error.diagnostics = errors;
  throw error;
}

async function operationStrictModeReadiness(config) {
  const operations = config.operations ?? {};
  const details = {
    restExposure: 'registered-only',
    operationsEnabled: operations.enabled === true,
    registry: inlineRegistryDetails(operations),
    outFile: operations.outFile ? { configured: true, path: String(operations.outFile) } : { configured: false },
    resolveRef: { configured: typeof operations.resolveRef === 'function' },
    sourceDir: operations.sourceDir ? { configured: true, path: String(operations.sourceDir) } : { configured: false },
  };

  if (operations.enabled !== true) {
    return {
      ready: false,
      reason: 'disabled',
      details,
    };
  }

  if (details.registry.count > 0) {
    return {
      ready: true,
      source: 'registry',
      details,
    };
  }

  if (operations.outFile) {
    const registryFile = await inspectOperationRegistryFile(operations.outFile);
    details.outFile = {
      ...details.outFile,
      ...registryFile.details,
    };
    return registryFile.ready
      ? {
          ready: true,
          source: 'outFile',
          details,
        }
      : {
          ready: false,
          reason: registryFile.reason,
          details,
        };
  }

  if (typeof operations.resolveRef === 'function') {
    return {
      ready: true,
      source: 'resolveRef',
      details,
    };
  }

  if (operations.sourceDir) {
    const sourceDir = await inspectOperationSourceDir(config);
    details.sourceDir = {
      ...details.sourceDir,
      ...sourceDir.details,
    };
    if (sourceDir.ready) {
      return {
        ready: true,
        source: 'sourceDir',
        details,
      };
    }
    if (sourceDir.reason !== 'source-empty') {
      return {
        ready: false,
        reason: sourceDir.reason,
        details,
      };
    }
  }

  return {
    ready: false,
    reason: 'no-source',
    details,
  };
}

function inlineRegistryDetails(operations) {
  const count = operations.registry && typeof operations.registry === 'object'
    ? Object.keys(operations.registry).length
    : 0;
  return {
    configured: count > 0,
    count,
  };
}

async function inspectOperationRegistryFile(outFile) {
  try {
    const manifest = JSON.parse(await readFile(outFile, 'utf8'));
    const entries = Object.entries(manifest.operations ?? {});
    for (const [, operation] of entries) {
      normalizeOperationTemplate(operation);
    }
    if (entries.length === 0) {
      return {
        ready: false,
        reason: 'registry-empty',
        details: {
          reason: 'empty',
          count: 0,
        },
      };
    }
    return {
      ready: true,
      details: {
        count: entries.length,
      },
    };
  } catch (error) {
    return {
      ready: false,
      reason: 'registry-load-failed',
      details: {
        reason: operationRegistryLoadReason(error),
        error: error.message,
      },
    };
  }
}

async function inspectOperationSourceDir(config) {
  try {
    const registry = await buildOperationRegistry(config, {
      createDirectory: false,
    });
    const count = Object.keys(registry).length;
    return count > 0
      ? {
          ready: true,
          details: {
            count,
          },
        }
      : {
          ready: false,
          reason: 'source-empty',
          details: {
            reason: 'empty',
            count: 0,
          },
        };
  } catch (error) {
    return {
      ready: false,
      reason: 'source-load-failed',
      details: {
        reason: operationRegistryLoadReason(error),
        error: error.message,
      },
    };
  }
}

function operationStrictModeDiagnostic(readiness) {
  return {
    code: OPERATIONS_STRICT_MODE_CODE,
    severity: 'error',
    source: 'doctor',
    message: strictModeMessage(readiness.reason),
    hint: 'Set operations.enabled: true and provide outputs.operationRegistry, operations.registry, operations.resolveRef, or operation source files; or use server.expose.rest: "open" for local REST routes.',
    details: {
      ...readiness.details,
      reason: readiness.reason,
    },
  };
}

function strictModeMessage(reason) {
  if (reason === 'disabled') {
    return 'server.expose.rest: "registered-only" requires registered operations to be enabled.';
  }

  return 'server.expose.rest: "registered-only" requires registered operations to be enabled and resolvable.';
}

function operationAcceptRefsRecommendation(config) {
  return {
    code: ACCEPT_REFS_RECOMMENDATION_CODE,
    severity: 'info',
    source: 'doctor',
    message: 'Operation-only REST exposure is easiest to review when public clients use operations.acceptRefs: "ref".',
    hint: 'Set operations.acceptRefs: "ref" for public operation-only APIs, or keep the current value for readable local/internal refs.',
    details: {
      acceptRefs: config.operations?.acceptRefs ?? 'both',
      restExposure: 'registered-only',
    },
  };
}

function operationRegistryLoadReason(error) {
  if (error?.code === 'ENOENT') {
    return 'missing';
  }
  if (error instanceof SyntaxError) {
    return 'invalid-json';
  }
  return 'read-failed';
}
