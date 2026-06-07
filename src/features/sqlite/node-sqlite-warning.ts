const NODE_SQLITE_EXPERIMENTAL_WARNING = 'SQLite is an experimental feature';

type EmitWarning = typeof process.emitWarning;

export function suppressNodeSqliteExperimentalWarning<T>(load: () => T): T {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = filteredEmitWarning(originalEmitWarning);
  try {
    return load();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

export async function suppressNodeSqliteExperimentalWarningAsync<T>(load: () => Promise<T>): Promise<T> {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = filteredEmitWarning(originalEmitWarning);
  try {
    return await load();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function filteredEmitWarning(originalEmitWarning: EmitWarning): EmitWarning {
  return ((warning: string | Error, ...args: unknown[]) => {
    if (isNodeSqliteExperimentalWarning(warning, args)) {
      return;
    }
    return (originalEmitWarning as (...emitArgs: unknown[]) => void).call(process, warning, ...args);
  }) as EmitWarning;
}

function isNodeSqliteExperimentalWarning(warning: string | Error, args: unknown[]): boolean {
  const message = warning instanceof Error ? warning.message : String(warning);
  const name = warning instanceof Error ? warning.name : undefined;
  const type = warningType(args[0]);
  return message.includes(NODE_SQLITE_EXPERIMENTAL_WARNING)
    && (name === 'ExperimentalWarning' || type === 'ExperimentalWarning');
}

function warningType(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && 'type' in value) {
    const type = (value as { type?: unknown }).type;
    return typeof type === 'string' ? type : undefined;
  }
  return undefined;
}
