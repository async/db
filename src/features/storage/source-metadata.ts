type SourceMetadataEntry = {
  path?: string | null;
  format?: unknown;
  hash?: unknown;
  updatedAt?: string;
};

export type SourceMetadata = {
  resources: Record<string, SourceMetadataEntry>;
};

type SourceMetadataConfig = {
  cwd: string;
};

type SourceMetadataResource = {
  name: string;
  dataHash?: unknown;
  dataPath?: string | null;
  dataFormat?: unknown;
};

export function updateSourceMetadataResource(
  sourceMetadata: SourceMetadata,
  config: SourceMetadataConfig,
  resource: SourceMetadataResource,
): void {
  if (!resource.dataHash) {
    return;
  }

  const previous = sourceMetadata.resources[resource.name];
  const next = {
    path: resource.dataPath ? relativePath(config, resource.dataPath) : null,
    format: resource.dataFormat,
    hash: resource.dataHash,
  };

  sourceMetadata.resources[resource.name] = {
    ...next,
    updatedAt: sameSource(previous, next) && previous.updatedAt
      ? previous.updatedAt
      : new Date().toISOString(),
  };
}

function sameSource(previous: SourceMetadataEntry | undefined, next: Omit<SourceMetadataEntry, 'updatedAt'>): boolean {
  return previous?.path === next.path
    && previous?.format === next.format
    && previous?.hash === next.hash;
}

function relativePath(config: SourceMetadataConfig, filePath: string): string {
  return filePath.startsWith(config.cwd) ? filePath.slice(config.cwd.length + 1).split('\\').join('/') : filePath;
}
