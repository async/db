import {
  access as nodeAccess,
  appendFile as nodeAppendFile,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  readdir as nodeReaddir,
  rename as nodeRename,
  rm as nodeRm,
  stat as nodeStat,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import { readFileSync as nodeReadFileSync } from 'node:fs';
import path from 'node:path';

type Encoding = BufferEncoding | null | undefined;

export type DbFileSystemDirent = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

export type DbFileSystemStats = {
  isDirectory(): boolean;
  isFile(): boolean;
};

export type DbFileSystem = {
  readFile(filePath: string, encoding?: Encoding): Promise<Buffer | string>;
  readFileSync(filePath: string, encoding?: Encoding): Buffer | string;
  writeFile(filePath: string, data: string | Buffer | Uint8Array, encoding?: BufferEncoding): Promise<void>;
  mkdir(filePath: string, options?: { recursive?: boolean }): Promise<unknown>;
  readdir(filePath: string, options?: { withFileTypes?: false }): Promise<string[]>;
  readdir(filePath: string, options: { withFileTypes: true }): Promise<DbFileSystemDirent[]>;
  stat(filePath: string): Promise<DbFileSystemStats>;
  access(filePath: string): Promise<void>;
  rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  /**
   * Flush a file or directory to stable storage. Optional: in-memory and other
   * custom file systems may omit it, and durability hooks become no-ops.
   */
  fsync?(filePath: string): Promise<void>;
  /** Append to a file, creating it when missing. Optional for custom file systems. */
  appendFile?(filePath: string, data: string | Buffer | Uint8Array, encoding?: BufferEncoding): Promise<void>;
};

type FsConfig = {
  fs?: DbFileSystem;
  [key: string]: unknown;
};

type MemoryFsInput = Record<string, string | Buffer | Uint8Array>;

type MemoryFileSystemOptions = {
  files?: MemoryFsInput;
  cwd?: string;
};

export const nodeFileSystem: DbFileSystem = {
  readFile: nodeReadFile as DbFileSystem['readFile'],
  readFileSync: nodeReadFileSync as DbFileSystem['readFileSync'],
  writeFile: nodeWriteFile as DbFileSystem['writeFile'],
  mkdir: nodeMkdir as DbFileSystem['mkdir'],
  readdir: nodeReaddir as DbFileSystem['readdir'],
  stat: nodeStat as DbFileSystem['stat'],
  access: nodeAccess,
  rm: nodeRm,
  rename: nodeRename,
  async fsync(filePath) {
    const handle = await nodeOpen(filePath, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  appendFile: nodeAppendFile as DbFileSystem['appendFile'],
};

export function dbFileSystem(config?: FsConfig | null): DbFileSystem {
  return config?.fs ?? nodeFileSystem;
}

export function createMemoryFs(options: MemoryFileSystemOptions | MemoryFsInput = {}): DbFileSystem {
  const rawFiles = isMemoryFileSystemOptions(options) ? options.files ?? {} : options;
  const cwd = isMemoryFileSystemOptions(options) ? path.resolve(options.cwd ?? process.cwd()) : process.cwd();
  const files = new Map<string, Buffer>();
  const directories = new Set<string>([path.parse(cwd).root, cwd]);

  for (const [filePath, value] of Object.entries(rawFiles)) {
    const absolutePath = normalizePath(cwd, filePath);
    ensureDirectory(path.dirname(absolutePath), directories);
    files.set(absolutePath, toBuffer(value));
  }

  const fs: DbFileSystem = {
    async readFile(filePath, encoding) {
      return readFileImpl(files, cwd, filePath, encoding);
    },
    readFileSync(filePath, encoding) {
      return readFileImpl(files, cwd, filePath, encoding);
    },
    async writeFile(filePath, data, encoding) {
      const absolutePath = normalizePath(cwd, filePath);
      ensureDirectory(path.dirname(absolutePath), directories);
      files.set(absolutePath, toBuffer(data, encoding));
    },
    async appendFile(filePath, data, encoding) {
      const absolutePath = normalizePath(cwd, filePath);
      ensureDirectory(path.dirname(absolutePath), directories);
      const existing = files.get(absolutePath);
      files.set(absolutePath, existing
        ? Buffer.concat([existing, toBuffer(data, encoding)])
        : toBuffer(data, encoding));
    },
    async mkdir(filePath, options = {}) {
      const absolutePath = normalizePath(cwd, filePath);
      if (files.has(absolutePath)) {
        throwFsError('ENOTDIR', `Path is not a directory: ${absolutePath}`);
      }
      if (!options.recursive && !directories.has(path.dirname(absolutePath))) {
        throwFsError('ENOENT', `Parent directory does not exist: ${absolutePath}`);
      }
      ensureDirectory(absolutePath, directories);
      return undefined;
    },
    readdir: (async (filePath: string, options: { withFileTypes?: boolean } = {}) => {
      const absolutePath = normalizePath(cwd, filePath);
      if (!directories.has(absolutePath)) {
        throwFsError('ENOENT', `Directory does not exist: ${absolutePath}`);
      }
      const entries = listDirectoryEntries(absolutePath, files, directories);
      if (options.withFileTypes) {
        return entries.map((entry) => ({
          name: entry.name,
          isDirectory: () => entry.kind === 'directory',
          isFile: () => entry.kind === 'file',
        }));
      }
      return entries.map((entry) => entry.name);
    }) as DbFileSystem['readdir'],
    async stat(filePath) {
      const absolutePath = normalizePath(cwd, filePath);
      if (files.has(absolutePath)) {
        return {
          isDirectory: () => false,
          isFile: () => true,
        };
      }
      if (directories.has(absolutePath)) {
        return {
          isDirectory: () => true,
          isFile: () => false,
        };
      }
      throwFsError('ENOENT', `Path does not exist: ${absolutePath}`);
    },
    async access(filePath) {
      const absolutePath = normalizePath(cwd, filePath);
      if (!files.has(absolutePath) && !directories.has(absolutePath)) {
        throwFsError('ENOENT', `Path does not exist: ${absolutePath}`);
      }
    },
    async rm(filePath, options = {}) {
      const absolutePath = normalizePath(cwd, filePath);
      if (files.delete(absolutePath)) {
        return;
      }
      if (!directories.has(absolutePath)) {
        if (options.force) {
          return;
        }
        throwFsError('ENOENT', `Path does not exist: ${absolutePath}`);
      }
      const childPaths = [...directories, ...files.keys()].filter((candidate) => isInsideOrEqualPath(absolutePath, candidate) && candidate !== absolutePath);
      if (childPaths.length > 0 && !options.recursive) {
        throwFsError('ENOTEMPTY', `Directory is not empty: ${absolutePath}`);
      }
      for (const childPath of childPaths) {
        files.delete(childPath);
        directories.delete(childPath);
      }
      directories.delete(absolutePath);
    },
    async rename(oldPath, newPath) {
      const oldAbsolutePath = normalizePath(cwd, oldPath);
      const newAbsolutePath = normalizePath(cwd, newPath);
      if (files.has(oldAbsolutePath)) {
        ensureDirectory(path.dirname(newAbsolutePath), directories);
        const value = files.get(oldAbsolutePath);
        if (value === undefined) {
          throwFsError('ENOENT', `Path does not exist: ${oldAbsolutePath}`);
        }
        files.delete(oldAbsolutePath);
        files.set(newAbsolutePath, value);
        return;
      }
      if (!directories.has(oldAbsolutePath)) {
        throwFsError('ENOENT', `Path does not exist: ${oldAbsolutePath}`);
      }
      ensureDirectory(path.dirname(newAbsolutePath), directories);
      for (const filePath of [...files.keys()]) {
        if (isInsideOrEqualPath(oldAbsolutePath, filePath)) {
          const relativePath = path.relative(oldAbsolutePath, filePath);
          const value = files.get(filePath);
          if (value === undefined) {
            continue;
          }
          files.delete(filePath);
          files.set(path.join(newAbsolutePath, relativePath), value);
        }
      }
      for (const directoryPath of [...directories]) {
        if (isInsideOrEqualPath(oldAbsolutePath, directoryPath)) {
          const relativePath = path.relative(oldAbsolutePath, directoryPath);
          directories.delete(directoryPath);
          directories.add(path.join(newAbsolutePath, relativePath));
        }
      }
    },
  };

  return fs;
}

function readFileImpl(files: Map<string, Buffer>, cwd: string, filePath: string, encoding?: Encoding): Buffer | string {
  const absolutePath = normalizePath(cwd, filePath);
  const value = files.get(absolutePath);
  if (value === undefined) {
    throwFsError('ENOENT', `File does not exist: ${absolutePath}`);
  }
  const copy = Buffer.from(value);
  return encoding ? copy.toString(encoding) : copy;
}

function isMemoryFileSystemOptions(value: unknown): value is MemoryFileSystemOptions {
  return Boolean(value)
    && typeof value === 'object'
    && !Buffer.isBuffer(value)
    && ('files' in value || 'cwd' in value);
}

function normalizePath(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(cwd, filePath);
}

function ensureDirectory(directory: string, directories: Set<string>): void {
  const parsed = path.parse(directory);
  let current = parsed.root;
  directories.add(current);
  for (const part of path.relative(parsed.root, directory).split(path.sep)) {
    if (!part) {
      continue;
    }
    current = path.join(current, part);
    directories.add(current);
  }
}

function toBuffer(value: string | Buffer | Uint8Array, encoding: BufferEncoding = 'utf8'): Buffer {
  return typeof value === 'string'
    ? Buffer.from(value, encoding)
    : Buffer.from(value);
}

function listDirectoryEntries(
  directory: string,
  files: Map<string, Buffer>,
  directories: Set<string>,
): Array<{ name: string; kind: 'directory' | 'file' }> {
  const entries = new Map<string, 'directory' | 'file'>();
  for (const directoryPath of directories) {
    if (directoryPath === directory || path.dirname(directoryPath) !== directory) {
      continue;
    }
    entries.set(path.basename(directoryPath), 'directory');
  }
  for (const filePath of files.keys()) {
    if (path.dirname(filePath) !== directory) {
      continue;
    }
    entries.set(path.basename(filePath), 'file');
  }
  return [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, kind]) => ({ name, kind }));
}

function isInsideOrEqualPath(parent: string, child: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(child));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function throwFsError(code: string, message: string): never {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  throw error;
}
