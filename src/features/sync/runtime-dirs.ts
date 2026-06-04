import path from 'node:path';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';

type RuntimeDirsConfig = {
  stateDir: string;
  fs?: DbFileSystem;
};

export async function ensureRuntimeDirs(config: RuntimeDirsConfig): Promise<void> {
  const fs = dbFileSystem(config);
  await fs.mkdir(config.stateDir, { recursive: true });
  await fs.mkdir(path.join(config.stateDir, 'state'), { recursive: true });
  await fs.mkdir(path.join(config.stateDir, 'wal'), { recursive: true });
  await fs.mkdir(path.join(config.stateDir, 'migrations'), { recursive: true });
  await fs.mkdir(path.join(config.stateDir, 'types'), { recursive: true });
}
