type FilesSourceInput = string | readonly string[] | {
  kind?: string;
  patterns?: string | readonly string[];
  pattern?: string | readonly string[];
  glob?: string | readonly string[];
  source?: string | readonly string[];
  read?: string;
};

export type FilesSourceDefinition = {
  kind: 'files';
  patterns: string[];
  read: string;
};

type FilesSourceOptions = {
  read?: string;
};

export function normalizeFilesSource(
  source: FilesSourceInput | null | undefined,
  options: FilesSourceOptions = {},
): FilesSourceDefinition | null {
  if (!source) {
    return null;
  }

  if (isFilesSource(source)) {
    return {
      kind: 'files',
      patterns: normalizePatterns(source.patterns ?? source.pattern ?? source.glob ?? source.source),
      read: source.read ?? options.read ?? 'frontmatter',
    };
  }

  return {
    kind: 'files',
    patterns: normalizePatterns(source),
    read: options.read ?? 'frontmatter',
  };
}

export function isFilesSource(value: unknown): value is Extract<FilesSourceInput, { kind?: string }> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && (value as { kind?: unknown }).kind === 'files';
}

function normalizePatterns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [String(value)];
}
