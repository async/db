export type GitRemoteMode = 'app' | 'actions-pull' | 'actions-dispatch' | 'token';

export type GitSourceRead = 'frontmatter' | 'md' | 'mdx' | 'json' | 'jsonc' | 'text' | string;

export type GitSnapshotFile = {
  path: string;
  content?: string;
  text?: string;
  sha?: string;
  encoding?: string;
};

export type GitSnapshotContext = {
  remote: GitHubRemoteDefinition;
  source: GitFilesSourceDefinition;
  resourceName: string;
  paths: string[];
};

export type GitSnapshotProvider =
  | readonly GitSnapshotFile[]
  | ((context: GitSnapshotContext) => readonly GitSnapshotFile[] | Promise<readonly GitSnapshotFile[]>);

export type GitHubRemoteOptions = {
  repo: string;
  branch?: string;
  mode?: GitRemoteMode;
  baseUrl?: string;
  token?: string;
  tokenEnv?: string;
  client?: {
    getTreeSnapshot?: (options: GitSnapshotContext) => readonly GitSnapshotFile[] | Promise<readonly GitSnapshotFile[]>;
    [key: string]: unknown;
  };
  /**
   * Test and bridge integration hook. Production GitHub App, Actions, branch,
   * commit, PR, webhook, and receipt mechanics belong to @async/github-app.
   */
  snapshot?: GitSnapshotProvider;
  [key: string]: unknown;
};

export type GitHubRemoteDefinition = GitHubRemoteOptions & {
  kind: 'github';
  type: 'github';
  branch: string;
  mode: GitRemoteMode;
};

export type GitFilesSourceDefinition = {
  kind: 'git-files';
  shape: 'files' | 'file' | 'collection-file';
  remote: string;
  patterns: readonly string[];
  read: GitSourceRead;
  idField?: string;
  bodyField?: string;
  allowJsoncWrites?: boolean;
  components?: readonly string[];
};

export type GitFilesSourceOptions = {
  remote: string;
  read?: GitSourceRead;
  idField?: string;
  bodyField?: string;
  allowJsoncWrites?: boolean;
  components?: readonly string[];
};

export function githubRemote(options: GitHubRemoteOptions): GitHubRemoteDefinition {
  return {
    kind: 'github',
    type: 'github',
    branch: 'main',
    mode: 'app',
    ...options,
  };
}

export function gitFiles(pattern: string, options: GitFilesSourceOptions): GitFilesSourceDefinition {
  return gitSource('files', pattern, {
    read: 'frontmatter',
    ...options,
  });
}

export function gitFile(path: string, options: GitFilesSourceOptions): GitFilesSourceDefinition {
  return gitSource('file', path, {
    read: 'json',
    ...options,
  });
}

export function gitCollectionFile(path: string, options: GitFilesSourceOptions): GitFilesSourceDefinition {
  return gitSource('collection-file', path, {
    read: 'json',
    ...options,
  });
}

function gitSource(
  shape: GitFilesSourceDefinition['shape'],
  pattern: string,
  options: GitFilesSourceOptions,
): GitFilesSourceDefinition {
  const definition: GitFilesSourceDefinition = {
    kind: 'git-files',
    shape,
    remote: options.remote,
    patterns: [pattern],
    read: options.read ?? (shape === 'files' ? 'frontmatter' : 'json'),
  };
  const placeholder = firstPathPlaceholder(pattern);
  if (options.idField ?? placeholder) {
    definition.idField = options.idField ?? placeholder;
  }
  if (options.bodyField) {
    definition.bodyField = options.bodyField;
  }
  if (options.allowJsoncWrites === true) {
    definition.allowJsoncWrites = true;
  }
  if (Array.isArray(options.components)) {
    definition.components = options.components.map(String);
  }
  return definition;
}

function firstPathPlaceholder(pattern: string): string | undefined {
  const match = /\{([A-Za-z_$][A-Za-z0-9_$]*)\}/.exec(pattern);
  return match?.[1];
}
