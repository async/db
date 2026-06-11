import { createHash } from 'node:crypto';
import path from 'node:path';
import { dbFileSystem, nodeFileSystem, type DbFileSystem } from '../fs/index.js';

/**
 * Write-ahead log for the JSON store ("Redis guarantees for a JSON file").
 *
 * A write is acknowledged after its op line is appended (and fsynced per
 * policy) to a hidden per-resource JSONL log. The pretty canonical JSON file
 * is rewritten shortly after (the checkpoint), so the file stays human-fresh
 * while acknowledged writes survive a crash between ack and rewrite. Reads
 * and boot replay the log tail onto the checkpoint, so they are never stale.
 *
 * The first line of every log generation is a base marker carrying the hash
 * of the checkpoint it applies to. If the canonical file changes underneath
 * the log (a human edit), the hashes disagree and the log is ignored and then
 * rotated: the file you can see always supersedes machinery you cannot.
 */
export type WalFsyncPolicy = 'always' | 'everysec' | 'no';

export type WalDelta =
  | { op: 'put-record'; idField: string; record: Record<string, unknown> }
  | { op: 'delete-record'; idField: string; id: unknown }
  | { op: 'replace-all'; value: unknown };

export type WalEntry = WalDelta & {
  seq: number;
  at: string;
  source?: 'runtime' | 'external' | 'refresh' | string;
};

type WalBaseLine = {
  op: 'base';
  hash: string | null;
  seq: number;
};

export type WalReadResult = {
  baseHash: string | null;
  baseSeq: number;
  entries: WalEntry[];
};

export function walPathFor(walDir: string, resourceName: string): string {
  return path.join(walDir, `${resourceName}.jsonl`);
}

/** Stable content hash used to bind a log generation to its checkpoint file. */
export function walContentHash(text: string | null): string | null {
  if (text === null) {
    return null;
  }
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 24);
}

export async function appendWalEntry(
  walPath: string,
  entry: WalEntry,
  options: { fsync?: WalFsyncPolicy; fs?: DbFileSystem } = {},
): Promise<void> {
  const fs = options.fs ?? dbFileSystem();
  await fs.mkdir(path.dirname(walPath), { recursive: true });
  if (!fs.appendFile) {
    throw new Error('WAL durability requires a file system with appendFile support.');
  }
  await fs.appendFile(walPath, `${JSON.stringify(entry)}\n`, 'utf8');
  await applyWalFsyncPolicy(walPath, options.fsync ?? 'everysec', fs);
}

export async function readWal(walPath: string, fs: DbFileSystem = dbFileSystem()): Promise<WalReadResult> {
  let text: string;
  try {
    text = await fs.readFile(walPath, 'utf8') as string;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { baseHash: null, baseSeq: 0, entries: [] };
    }
    throw error;
  }

  const result: WalReadResult = { baseHash: null, baseSeq: 0, entries: [] };
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    let parsed: WalEntry | WalBaseLine;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A torn final line is the expected crash artifact: the write it held
      // was never acknowledged, so dropping it is correct. A torn line in the
      // middle would make later entries ambiguous; stop replay there too.
      break;
    }
    if (parsed.op === 'base') {
      result.baseHash = (parsed as WalBaseLine).hash;
      result.baseSeq = Number((parsed as WalBaseLine).seq) || 0;
      result.entries = [];
      continue;
    }
    result.entries.push(parsed as WalEntry);
  }
  return result;
}

/**
 * Start a fresh log generation bound to the checkpoint with `baseHash`.
 * Written atomically (temp + rename) so a crash mid-rotation leaves either
 * the old complete log or the new empty one, never a hybrid.
 */
export async function rotateWal(
  walPath: string,
  baseHash: string | null,
  baseSeq: number,
  fs: DbFileSystem = dbFileSystem(),
): Promise<void> {
  await fs.mkdir(path.dirname(walPath), { recursive: true });
  const tempPath = `${walPath}.${process.pid}.${Date.now()}.rotate`;
  await fs.writeFile(tempPath, `${JSON.stringify({ op: 'base', hash: baseHash, seq: baseSeq })}\n`, 'utf8');
  await fs.fsync?.(tempPath);
  await fs.rename(tempPath, walPath);
}

/** Apply log entries onto a checkpoint value. Idempotent by construction. */
export function replayWal(checkpoint: unknown, entries: WalEntry[]): unknown {
  let value = checkpoint;
  for (const entry of entries) {
    if (entry.op === 'replace-all') {
      value = entry.value;
      continue;
    }
    const records = Array.isArray(value) ? [...value] as Array<Record<string, unknown>> : [];
    if (entry.op === 'put-record') {
      const index = records.findIndex((record) => idMatches(record?.[entry.idField], entry.record?.[entry.idField]));
      if (index === -1) {
        records.push(entry.record);
      } else {
        records[index] = entry.record;
      }
      value = records;
      continue;
    }
    if (entry.op === 'delete-record') {
      value = records.filter((record) => !idMatches(record?.[entry.idField], entry.id));
    }
  }
  return value;
}

function idMatches(left: unknown, right: unknown): boolean {
  return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
}

/**
 * The Redis appendfsync trade: 'always' flushes per append (lose nothing),
 * 'everysec' batches flushes on a shared one-second timer (lose at most ~1s
 * on power loss), 'no' leaves flushing to the OS.
 */
const pendingEverysecFsyncs = new Set<string>();
let everysecTimer: NodeJS.Timeout | null = null;

async function applyWalFsyncPolicy(walPath: string, policy: WalFsyncPolicy, fs: DbFileSystem): Promise<void> {
  if (policy === 'no' || !fs.fsync) {
    return;
  }
  if (policy === 'always') {
    await fs.fsync(walPath);
    return;
  }

  pendingEverysecFsyncs.add(walPath);
  if (everysecTimer) {
    return;
  }
  everysecTimer = setInterval(() => {
    const paths = [...pendingEverysecFsyncs];
    pendingEverysecFsyncs.clear();
    if (paths.length === 0 && everysecTimer) {
      clearInterval(everysecTimer);
      everysecTimer = null;
      return;
    }
    for (const pending of paths) {
      void nodeFileSystem.fsync?.(pending).catch(() => {
        // A failed background flush retries implicitly with the next append.
      });
    }
  }, 1000);
  everysecTimer.unref?.();
}

/** Flush any pending everysec fsyncs immediately (used by close/checkpoint). */
export async function flushWalFsyncs(): Promise<void> {
  const paths = [...pendingEverysecFsyncs];
  pendingEverysecFsyncs.clear();
  if (everysecTimer) {
    clearInterval(everysecTimer);
    everysecTimer = null;
  }
  await Promise.all(paths.map((pending) => nodeFileSystem.fsync?.(pending).catch(() => {})));
}
