import path from 'node:path';
import { dbError } from '../../errors.js';
import { writeText } from '../../fs-utils.js';
import { loadProjectSchema } from '../../schema.js';
import { renderHonoApp, renderServerEntry } from './app.js';
import { renderGraphqlRoutes } from './graphql.js';
import { renderPackageJson, renderTsconfig } from './package.js';
import { renderReadme } from './readme.js';
import { renderRepositoryTypes } from './repository.js';
import { renderRestRoutes } from './rest.js';
import { renderGeneratedSchema, renderSeedModule } from './schema.js';
import { renderInitialMigration, renderSqliteAdapter } from './sqlite.js';
import { renderValidators } from './validators.js';

const DEFAULT_OPTIONS = {
  outDir: './db-api',
  api: ['rest'],
  db: 'sqlite',
  app: 'standalone',
  runtime: 'node-sqlite',
  seed: false,
  allowWarnings: false,
};

type HonoDiagnostic = {
  severity: 'error' | 'warn' | 'info';
  message: string;
  [key: string]: unknown;
};

type HonoResource = {
  name: string;
  kind: string;
  idField?: string;
  fields: Record<string, { type?: string; required?: boolean; [key: string]: unknown }>;
  seed?: unknown;
};

type HonoProject = {
  resources: HonoResource[];
  diagnostics: HonoDiagnostic[];
  schema: {
    resources: unknown;
    graphql?: string;
    [key: string]: unknown;
  };
};

type HonoGenerateConfig = {
  cwd?: string;
  generate?: {
    hono?: Partial<HonoGenerateOptions>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type HonoGenerateOptions = {
  outDir: string;
  out?: string;
  api: string[] | string;
  db: string;
  app: string;
  runtime: string;
  seed: false | 'fixtures' | string | boolean;
  allowWarnings: boolean;
  [key: string]: unknown;
};

type ResolvedHonoGenerateOptions = {
  outDir: string;
  out?: string;
  api: string[];
  db: string;
  app: string;
  runtime: string;
  seed: false | 'fixtures' | string | boolean;
  allowWarnings: boolean;
  [key: string]: unknown;
};

type GeneratedFile = {
  path: string;
  content: string;
};

export async function generateHonoStarter(config: HonoGenerateConfig, options: Partial<HonoGenerateOptions> = {}) {
  const resolved = resolveGenerateOptions(config, options);
  const project = await loadProjectSchema(config) as HonoProject;
  assertGeneratable(project, resolved);

  const files = renderHonoStarter(project, resolved);
  for (const file of files) {
    await writeText(path.join(resolved.outDir, file.path), file.content);
  }

  return {
    outDir: resolved.outDir,
    files: files.map((file) => path.join(resolved.outDir, file.path)),
    diagnostics: project.diagnostics,
  };
}

export function renderHonoStarter(project: HonoProject, options: Partial<HonoGenerateOptions> = {}): GeneratedFile[] {
  const resolved: ResolvedHonoGenerateOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    api: normalizeApi(options.api ?? DEFAULT_OPTIONS.api),
  };
  const files = [
    generatedFile('src/schema.ts', renderGeneratedSchema(project)),
    generatedFile('src/repository.ts', renderRepositoryTypes()),
    generatedFile('src/validators.ts', renderValidators()),
    generatedFile('src/sqlite.ts', renderSqliteAdapter(project, resolved)),
    generatedFile('migrations/0001_initial.sql', renderInitialMigration(project.resources)),
    generatedFile('README.md', renderReadme(project, resolved)),
  ];

  if (resolved.seed === 'fixtures') {
    files.push(generatedFile('src/seed.ts', renderSeedModule()));
  }

  if (resolved.api.includes('rest')) {
    files.push(generatedFile('src/rest.ts', renderRestRoutes()));
  }

  if (resolved.api.includes('graphql')) {
    files.push(generatedFile('src/graphql.ts', renderGraphqlRoutes(project)));
  }

  if (resolved.api.length > 0) {
    files.push(generatedFile('src/app.ts', renderHonoApp(resolved)));
  }

  if (resolved.app === 'standalone') {
    files.push(
      generatedFile('src/server.ts', renderServerEntry()),
      generatedFile('package.json', renderPackageJson(resolved)),
      generatedFile('tsconfig.json', renderTsconfig()),
    );
  }

  return files;
}

function resolveGenerateOptions(config: HonoGenerateConfig, options: Partial<HonoGenerateOptions>): ResolvedHonoGenerateOptions {
  const fromConfig = config.generate?.hono ?? {};
  const definedOptions = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  const merged = {
    ...DEFAULT_OPTIONS,
    ...fromConfig,
    ...definedOptions,
  } as HonoGenerateOptions;
  merged.api = normalizeApi(merged.api);
  merged.outDir = path.resolve(config.cwd, merged.outDir ?? merged.out ?? DEFAULT_OPTIONS.outDir);
  merged.db = merged.db ?? 'sqlite';
  merged.app = merged.app ?? 'standalone';
  merged.runtime = merged.runtime ?? 'node-sqlite';
  merged.seed = merged.seed === true ? 'fixtures' : merged.seed;

  if (merged.db !== 'sqlite') {
    throw dbError(
      'GENERATE_UNSUPPORTED_DB',
      `Unsupported generated database "${merged.db}".`,
      {
        hint: 'Use --db sqlite for the v1 generator.',
        details: {
          db: merged.db,
        },
      },
    );
  }

  if (!['standalone', 'module'].includes(merged.app)) {
    throw dbError(
      'GENERATE_UNSUPPORTED_APP_SHAPE',
      `Unsupported generated app shape "${merged.app}".`,
      {
        hint: 'Use --app standalone or --app module.',
        details: {
          app: merged.app,
        },
      },
    );
  }

  return merged as ResolvedHonoGenerateOptions;
}

function normalizeApi(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? 'rest').split(',');
  const api = raw.map((item) => String(item).trim()).filter(Boolean);
  if (api.length === 1 && api[0] === 'none') {
    return [];
  }

  const unsupported = api.filter((item) => !['rest', 'graphql'].includes(item));
  if (unsupported.length > 0) {
    throw dbError(
      'GENERATE_UNSUPPORTED_API',
      `Unsupported generated API target "${unsupported[0]}".`,
      {
        hint: 'Use --api rest, --api graphql, --api rest,graphql, or --api none.',
        details: {
          api,
        },
      },
    );
  }

  return [...new Set(api)];
}

function assertGeneratable(project: HonoProject, options: ResolvedHonoGenerateOptions): void {
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = project.diagnostics.filter((diagnostic) => diagnostic.severity === 'warn');
  const blocking = options.allowWarnings ? errors : [...errors, ...warnings];

  if (blocking.length === 0) {
    return;
  }

  const error = dbError(
    'GENERATE_SCHEMA_DIAGNOSTICS',
    `Cannot generate Hono starter because schema diagnostics are present: ${blocking[0].message}`,
    {
      hint: options.allowWarnings
        ? 'Fix schema errors before generating production starter code.'
        : 'Fix schema warnings/errors, or pass --allow-warnings to generate while keeping warning diagnostics.',
      details: {
        diagnostics: blocking,
      },
    },
  );
  (error as Error & { diagnostics?: HonoDiagnostic[] }).diagnostics = blocking;
  throw error;
}

function generatedFile(filePath: string, content: string): GeneratedFile {
  return {
    path: filePath,
    content: content.endsWith('\n') ? content : `${content}\n`,
  };
}
