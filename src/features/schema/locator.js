import { stat } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_FILE_RE = /(?:^|[/\\])(?:db\.schema\.mjs|[^/\\]+\.schema\.(?:json|jsonc|mjs))$/;

export async function resolveSchemaLocator(options = {}) {
  const input = typeof options === 'string' ? { from: options } : options ?? {};
  const baseCwd = path.resolve(input.cwd ?? process.cwd());
  const from = input.from === undefined || input.from === null || input.from === ''
    ? null
    : path.resolve(baseCwd, String(input.from));

  if (!from) {
    return projectLocator(baseCwd);
  }

  let stats;
  try {
    stats = await stat(from);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw schemaLocatorError(
        'DB_SCHEMA_LOCATOR_NOT_FOUND',
        `Schema locator path does not exist: ${path.relative(baseCwd, from) || from}`,
        {
          hint: 'Pass from: "." for a project root, from: "./db" for a fixture folder, or from: "./db.schema.mjs" / "./db/users.schema.mjs" for a schema file.',
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
      hint: 'Use a project root, a db folder, db.schema.mjs, or a .schema.json/.schema.jsonc/.schema.mjs file.',
      details: {
        from: input.from,
        path: from,
      },
    },
  );
}

export function normalizeSchemaLoadMode(value = 'data') {
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

function projectLocator(cwd) {
  return {
    cwd,
    sourceDir: path.join(cwd, 'db'),
    mode: 'project',
    file: null,
    baseDir: cwd,
    resourceName: null,
  };
}

function directoryLocator(directory, fallbackCwd) {
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

function fileLocator(file, fallbackCwd) {
  const normalized = file.split(path.sep).join('/');
  if (!SCHEMA_FILE_RE.test(normalized)) {
    throw schemaLocatorError(
      'DB_SCHEMA_LOCATOR_UNSUPPORTED',
      `Unsupported schema locator file: ${path.basename(file)}`,
      {
        hint: 'Use db.schema.mjs or a .schema.json/.schema.jsonc/.schema.mjs file.',
        details: {
          path: file,
        },
      },
    );
  }

  if (path.basename(file) === 'db.schema.mjs') {
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

function inferSourceDirForSchemaFile(file) {
  const segments = file.split(path.sep);
  const dbIndex = segments.lastIndexOf('db');
  if (dbIndex >= 0) {
    return segments.slice(0, dbIndex + 1).join(path.sep) || path.sep;
  }
  return path.dirname(file);
}

function resourceNameForSchemaFile(file, sourceDir) {
  const relative = path.relative(sourceDir, file).split(path.sep).join('/');
  if (relative.endsWith('/index.schema.mjs')) {
    return path.basename(path.dirname(file));
  }
  return path.basename(relative).replace(/\.schema\.(?:json|jsonc|mjs)$/i, '');
}

function schemaLocatorError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.hint = options.hint;
  error.details = options.details ?? {};
  return error;
}
