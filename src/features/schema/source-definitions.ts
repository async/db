type FilesSourceInput = string | readonly string[] | {
  kind?: string;
  patterns?: string | readonly string[];
  pattern?: string | readonly string[];
  glob?: string | readonly string[];
  source?: string | readonly string[];
  read?: string;
  components?: readonly string[];
};

type GitFilesSourceInput = {
  kind?: string;
  shape?: string;
  remote?: string;
  patterns?: string | readonly string[];
  pattern?: string | readonly string[];
  path?: string | readonly string[];
  read?: string;
  idField?: string;
  bodyField?: string;
  allowJsoncWrites?: boolean;
  components?: readonly string[];
};

export type FilesSourceDefinition = {
  kind: 'files';
  patterns: string[];
  read: string;
  components?: string[];
};

export type GitFilesSourceShape = 'files' | 'file' | 'collection-file';

export type GitFilesSourceDefinition = {
  kind: 'git-files';
  shape: GitFilesSourceShape;
  remote: string;
  patterns: string[];
  read: string;
  idField?: string;
  bodyField?: string;
  allowJsoncWrites?: boolean;
  components?: string[];
};

export type ResourceSourceDefinition = FilesSourceDefinition | GitFilesSourceDefinition;

type FilesSourceOptions = {
  read?: string;
  components?: readonly string[];
};

export function normalizeFilesSource(
  source: FilesSourceInput | null | undefined,
  options: FilesSourceOptions = {},
): FilesSourceDefinition | null {
  if (!source) {
    return null;
  }

  if (isFilesSource(source)) {
    return withComponents({
      kind: 'files',
      patterns: normalizePatterns(source.patterns ?? source.pattern ?? source.glob ?? source.source),
      read: source.read ?? options.read ?? 'frontmatter',
    }, source.components ?? options.components);
  }

  return withComponents({
    kind: 'files',
    patterns: normalizePatterns(source),
    read: options.read ?? 'frontmatter',
  }, options.components);
}

export function normalizeGitSource(
  source: GitFilesSourceInput | null | undefined,
  options: FilesSourceOptions = {},
): GitFilesSourceDefinition | null {
  if (!source) {
    return null;
  }

  const shape = normalizeGitSourceShape(source.shape);
  const definition: GitFilesSourceDefinition = {
    kind: 'git-files',
    shape,
    remote: String(source.remote ?? ''),
    patterns: normalizePatterns(source.patterns ?? source.pattern ?? source.path),
    read: source.read ?? options.read ?? defaultGitRead(shape),
  };

  if (source.idField) {
    definition.idField = String(source.idField);
  }
  if (source.bodyField) {
    definition.bodyField = String(source.bodyField);
  }
  if (source.allowJsoncWrites === true) {
    definition.allowJsoncWrites = true;
  }

  return withGitComponents(definition, source.components ?? options.components);
}

export function normalizeResourceSource(
  source: FilesSourceInput | GitFilesSourceInput | null | undefined,
  options: FilesSourceOptions = {},
): ResourceSourceDefinition | null {
  if (isGitSource(source)) {
    return normalizeGitSource(source, options);
  }
  return normalizeFilesSource(source as FilesSourceInput | null | undefined, options);
}

function withComponents(definition: FilesSourceDefinition, components: readonly string[] | undefined): FilesSourceDefinition {
  if (Array.isArray(components)) {
    definition.components = components.map(String);
  }
  return definition;
}

function withGitComponents(definition: GitFilesSourceDefinition, components: readonly string[] | undefined): GitFilesSourceDefinition {
  if (Array.isArray(components)) {
    definition.components = components.map(String);
  }
  return definition;
}

export function isFilesSource(value: unknown): value is Extract<FilesSourceInput, { kind?: string }> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && (value as { kind?: unknown }).kind === 'files';
}

export function isGitSource(value: unknown): value is GitFilesSourceDefinition {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && (value as { kind?: unknown }).kind === 'git-files';
}

function normalizeGitSourceShape(value: unknown): GitFilesSourceShape {
  if (value === 'file' || value === 'collection-file') {
    return value;
  }
  return 'files';
}

function defaultGitRead(shape: GitFilesSourceShape): string {
  return shape === 'files' ? 'frontmatter' : 'json';
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
