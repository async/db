export function normalizeFilesSource(source, options = {}) {
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

export function isFilesSource(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'files';
}

function normalizePatterns(value) {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [String(value)];
}
