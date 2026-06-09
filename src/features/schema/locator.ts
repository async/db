import path from 'node:path';
import { dbFileSystem, type DbFileSystem } from '../fs/index.js';

const SCHEMA_FILE_RE = /(?:^|[/\\])(?:db\.schema\.(?:mjs|js)|[^/\\]+\.schema\.(?:json|jsonc|mjs|js))$/;

export type SchemaLoadMode = 'schema' | 'data' | 'runtime';

export type SchemaLocator = {
  cwd: string;
  sourceDir: string;
  mode: 'project' | 'source-dir' | 'root-schema' | 'schema-file';
  file: string | null;
  baseDir: string;
  resourceName: string | null;
};

type ResolveSchemaLocatorOptions = {
  cwd?: string;
  from?: string | null;
  fs?: DbFileSystem;
};

type SchemaLocatorErrorOptions = {
  hint?: string;
  details?: unknown;
};

type NodeFsError = Error & {
  code?: string;
};

export async function resolveSchemaLocator(options: ResolveSchemaLocatorOptions | string = {}): Promise<SchemaLocator> {
  const input = typeof options === 'string' ? { from: options } : options ?? {};
  const fs = dbFileSystem(input);
  const baseCwd = path.resolve(input.cwd ?? process.cwd());
  const from = input.from === undefined || input.from === null || input.from === ''
    ? null
    : path.resolve(baseCwd, String(input.from));

  if (!from) {
    return projectLocator(baseCwd);
  }

  let stats;
  try {
    stats = await fs.stat(from);
  } catch (error) {
    const fsError = error as NodeFsError;
    if (fsError.code === 'ENOENT') {
      throw schemaLocatorError(
        'DB_SCHEMA_LOCATOR_NOT_FOUND',
        `Schema locator path does not exist: ${path.relative(baseCwd, from) || from}`,
        {
          hint: 'Pass from: "." for a project root, from: "./db" for a data folder, or from: "./db.schema.mjs" / "./db.schema.js" / "./db/users.schema.mjs" for a schema file.',
          details: {
            from: input.from,
            path: from,
          },
        },
      );
    }
    throw error;
  }

  if (stats.isDirectory()) {
    return directoryLocator(from, baseCwd);
  }

  if (stats.isFile()) {
    return fileLocator(from, baseCwd);
  }

  throw schemaLocatorError(
    'DB_SCHEMA_LOCATOR_UNSUPPORTED',
    `Schema locator must be a file or directory: ${path.relative(baseCwd, from) || from}`,
    {
      hint: 'Use a project root, a db folder, db.schema.mjs, db.schema.js, or a .schema.json/.schema.jsonc/.schema.mjs/.schema.js file.',
      details: {
        from: input.from,
        path: from,
      },
    },
  );
}

export function normalizeSchemaLoadMode(value: unknown = 'data'): SchemaLoadMode {
  if (value === undefined || value === null || value === '') {
    return 'data';
  }
  if (value === 'schema' || value === 'data' || value === 'runtime') {
    return value;
  }
  throw schemaLocatorError(
    'DB_SCHEMA_LOAD_MODE_INVALID',
    `Unsupported schema load mode "${value}".`,
    {
      hint: 'Use load: "schema", load: "data", or load: "runtime".',
      details: {
        load: value,
        allowed: ['schema', 'data', 'runtime'],
      },
    },
  );
}

function projectLocator(cwd: string): SchemaLocator {
  return {
    cwd,
    sourceDir: path.join(cwd, 'db'),
    mode: 'project',
    file: null,
    baseDir: cwd,
    resourceName: null,
  };
}

function directoryLocator(directory: string, fallbackCwd: string): SchemaLocator {
  const basename = path.basename(directory);
  const cwd = basename === 'db' ? path.dirname(directory) : directory;
  return {
    cwd: path.resolve(cwd || fallbackCwd),
    sourceDir: basename === 'db' ? directory : path.join(directory, 'db'),
    mode: basename === 'db' ? 'source-dir' : 'project',
    file: null,
    baseDir: directory,
    resourceName: null,
  };
}

function fileLocator(file: string, fallbackCwd: string): SchemaLocator {
  const normalized = file.split(path.sep).join('/');
  if (!SCHEMA_FILE_RE.test(normalized)) {
    throw schemaLocatorError(
      'DB_SCHEMA_LOCATOR_UNSUPPORTED',
      `Unsupported schema locator file: ${path.basename(file)}`,
      {
        hint: 'Use db.schema.mjs, db.schema.js, or a .schema.json/.schema.jsonc/.schema.mjs/.schema.js file.',
        details: {
          path: file,
        },
      },
    );
  }

  if (path.basename(file) === 'db.schema.mjs' || path.basename(file) === 'db.schema.js') {
    const cwd = path.dirname(file);
    return {
      cwd,
      sourceDir: path.join(cwd, 'db'),
      mode: 'root-schema',
      file,
      baseDir: cwd,
      resourceName: null,
    };
  }

  const sourceDir = inferSourceDirForSchemaFile(file);
  const cwd = path.basename(sourceDir) === 'db' ? path.dirname(sourceDir) : fallbackCwd;
  return {
    cwd,
    sourceDir,
    mode: 'schema-file',
    file,
    baseDir: path.dirname(file),
    resourceName: resourceNameForSchemaFile(file, sourceDir),
  };
}

function inferSourceDirForSchemaFile(file: string): string {
  const segments = file.split(path.sep);
  const dbIndex = segments.lastIndexOf('db');
  if (dbIndex >= 0) {
    return segments.slice(0, dbIndex + 1).join(path.sep) || path.sep;
  }
  return path.dirname(file);
}

function resourceNameForSchemaFile(file: string, sourceDir: string): string {
  const relative = path.relative(sourceDir, file).split(path.sep).join('/');
  if (relative.endsWith('/index.schema.mjs') || relative.endsWith('/index.schema.js')) {
    return path.basename(path.dirname(file));
  }
  return path.basename(relative).replace(/\.schema\.(?:json|jsonc|mjs|js)$/i, '');
}

function schemaLocatorError(code: string, message: string, options: SchemaLocatorErrorOptions = {}) {
  const error = new Error(message);
  return Object.assign(error, {
    code,
    hint: options.hint,
    details: options.details ?? {},
  });
}
