import path from 'node:path';
import { resourceConfigValue } from '../../names.js';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';

/**
 * Opt-in per-resource audit trail. With `resources.<name>.audit: true`, every
 * successful runtime write appends one JSON line to a `.audit/<resource>.jsonl`
 * file beside the resource state. Entries record what changed (op, id, field
 * names) but not values by default; `audit: { values: true }` includes
 * before/after snapshots for full forensic trails.
 *
 * Audit writes are append-only and never fail the data write: failures emit a
 * process warning instead of breaking the request.
 */
export type AuditConfig = boolean | {
  values?: boolean;
};

export type AuditEntry = {
  at: string;
  resource: string;
  kind: 'collection' | 'document';
  op: string;
  id?: unknown;
  fields?: string[];
  before?: unknown;
  after?: unknown;
};

type AuditRuntimeConfig = {
  resources?: Record<string, unknown>;
  fs?: DbFileSystem;
  [key: string]: unknown;
};

const warnedResources = new Set<string>();

export function auditConfigFor(config: AuditRuntimeConfig, resourceName: string): AuditConfig | undefined {
  const resourceConfig = resourceConfigValue(config.resources, resourceName) as { audit?: AuditConfig } | undefined;
  return resourceConfig?.audit;
}

export function auditLogPath(statePath: string, resourceName: string): string {
  return path.join(path.dirname(statePath), '.audit', `${resourceName}.jsonl`);
}

export async function recordAuditEntry(
  config: AuditRuntimeConfig,
  statePath: unknown,
  entry: AuditEntry,
): Promise<void> {
  const audit = auditConfigFor(config, entry.resource);
  if (!audit || typeof statePath !== 'string') {
    return;
  }

  const includeValues = typeof audit === 'object' && audit.values === true;
  const line = {
    ...entry,
    before: includeValues ? entry.before : undefined,
    after: includeValues ? entry.after : undefined,
  };

  const fs = dbFileSystem(config);
  if (!fs.appendFile) {
    warnAuditOnce(entry.resource, 'the configured file system does not support appendFile');
    return;
  }

  try {
    const filePath = auditLogPath(statePath, entry.resource);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(line)}\n`, 'utf8');
  } catch (error) {
    warnAuditOnce(entry.resource, (error as Error).message);
  }
}

function warnAuditOnce(resource: string, reason: string): void {
  if (warnedResources.has(resource)) {
    return;
  }
  warnedResources.add(resource);
  process.emitWarning(
    `Audit log write failed for resource "${resource}": ${reason}. Data writes continue; audit entries are skipped.`,
    { code: 'ASYNC_DB_AUDIT_FAILED', type: 'AsyncDbAuditWarning' },
  );
}
