import { syncJsonResourceState } from '../storage/json.js';

type SyncConfig = {
  cwd: string;
  stateDir: string;
  [key: string]: unknown;
};

type SyncResource = {
  name: string;
  [key: string]: unknown;
};

type SourceMetadata = {
  resources: Record<string, unknown>;
};

export async function syncStateResource(config: SyncConfig, resource: SyncResource, sourceMetadata: SourceMetadata): Promise<void> {
  await syncJsonResourceState(config, resource, sourceMetadata);
}
