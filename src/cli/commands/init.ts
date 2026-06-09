import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../../config.js';
import { syncDb } from '../../sync.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printDiagnostic } from '../output.js';

type CliConfig = Record<string, unknown>;

type InitTemplate = 'data-first' | 'schema-first' | 'source-file';

type PlannedFile = {
  relativePath: string;
  action: 'create' | 'patch';
  description: string;
  content?: string;
};

type InitReceipt = {
  kind: 'db.initReceipt';
  version: 1;
  template: InitTemplate;
  cwd: string;
  dryRun: boolean;
  files: PlannedFile[];
  followUp: string[];
};

const SCRIPT_ENTRIES: Record<string, string> = {
  db: 'async-db',
  'db:sync': 'async-db sync',
  'db:serve': 'async-db serve',
  'db:types': 'async-db types',
};

const GITIGNORE_ENTRY = '.db/';

const USERS_FIXTURE = `[
  {
    "id": "u_1",
    "name": "Ada Lovelace",
    "email": "ada@example.com"
  }
]
`;

const USERS_SCHEMA = `{
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": { "type": "string", "required": true },
    "name": { "type": "string", "required": true },
    "email": {
      "type": "string",
      "required": true,
      "unique": true
    }
  },
  "seed": []
}
`;

const SOURCE_FILE_CONFIG = `// Swap to \`defineConfig\` from '@async/db/config' for editor autocomplete.
export default {
  stores: {
    default: 'sourceFile',
  },
};
`;

const APP_STATE_FIXTURE = `{
  "title": "My Local App",
  "note": "Saved directly to db/appState.json",
  "updatedAt": null
}
`;

export async function runInit(config: CliConfig, args: string[]): Promise<void> {
  if (isHelpRequested(args)) {
    return;
  }

  const cwd = String(config.cwd ?? process.cwd());
  const template = parseTemplate(args);
  const dryRun = args.includes('--dry-run');
  const json = args.includes('--json');
  const receipt = await planInit({ cwd, template, dryRun });

  if (json) {
    console.log(JSON.stringify(receipt, replaceContent, 2));
    if (dryRun) {
      return;
    }
  } else if (dryRun) {
    console.log(`async-db init --template ${template} (dry run)`);
    for (const file of receipt.files) {
      console.log(`  ${file.action} ${file.relativePath} — ${file.description}`);
    }
    console.log('');
    console.log('Follow-up:');
    for (const line of receipt.followUp) {
      console.log(`  ${line}`);
    }
    return;
  }

  await applyInitPlan(cwd, receipt.files);

  const syncConfig = await loadConfig({ cwd });
  const result = await syncDb(syncConfig as never);
  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }
  for (const line of result.logs) {
    console.log(line);
  }

  if (json) {
    return;
  }

  console.log(`Initialized ${template} project in ${cwd}`);
  console.log('');
  console.log('Next:');
  for (const line of receipt.followUp) {
    console.log(`  ${line}`);
  }
}

function parseTemplate(args: string[]): InitTemplate {
  const value = valueAfter(args, '--template') ?? 'data-first';
  if (value === 'data-first' || value === 'schema-first' || value === 'source-file') {
    return value;
  }

  throw new Error(`Unknown init template "${value}". Use data-first, schema-first, or source-file.`);
}

async function planInit(options: { cwd: string; template: InitTemplate; dryRun: boolean }): Promise<InitReceipt> {
  const files: PlannedFile[] = [];
  const packageJsonPath = path.join(options.cwd, 'package.json');
  const existingPackage = await readPackageJson(packageJsonPath);

  for (const file of templateFiles(options.template, existingPackage)) {
    await assertCanWrite(path.join(options.cwd, file.relativePath));
    files.push(file);
  }

  const gitignorePath = path.join(options.cwd, '.gitignore');
  if (await fileExists(gitignorePath)) {
    const current = await readFile(gitignorePath, 'utf8');
    if (!hasGitignoreEntry(current)) {
      files.push({
        relativePath: '.gitignore',
        action: 'patch',
        description: 'append .db/ ignore entry',
      });
    }
  } else {
    files.push({
      relativePath: '.gitignore',
      action: 'create',
      description: 'ignore generated .db/ output',
      content: `${GITIGNORE_ENTRY}\n`,
    });
  }

  if (existingPackage === null) {
    files.push({
      relativePath: 'package.json',
      action: 'create',
      description: 'minimal ESM package with db scripts',
      content: `${JSON.stringify({
        private: true,
        type: 'module',
        scripts: SCRIPT_ENTRIES,
      }, null, 2)}\n`,
    });
  } else {
    const missingScripts = Object.keys(SCRIPT_ENTRIES).filter((key) => !existingPackage.scripts?.[key]);
    if (missingScripts.length > 0) {
      files.push({
        relativePath: 'package.json',
        action: 'patch',
        description: 'add db CLI scripts',
      });
    }
  }

  return {
    kind: 'db.initReceipt',
    version: 1,
    template: options.template,
    cwd: options.cwd,
    dryRun: options.dryRun,
    files,
    followUp: buildFollowUp(options.template),
  };
}

function templateFiles(
  template: InitTemplate,
  existingPackage: { type?: string; scripts?: Record<string, string> } | null,
): PlannedFile[] {
  if (template === 'data-first') {
    return [{
      relativePath: 'db/users.json',
      action: 'create',
      description: 'starter fixture',
      content: USERS_FIXTURE,
    }];
  }

  if (template === 'schema-first') {
    return [{
      relativePath: 'db/users.schema.jsonc',
      action: 'create',
      description: 'schema-backed collection with empty seed',
      content: USERS_SCHEMA,
    }];
  }

  // JavaScript config files need ESM module context. Existing CommonJS
  // packages get db.config.mjs so init never flips a project's module type.
  const configFileName = existingPackage !== null && existingPackage.type !== 'module'
    ? 'db.config.mjs'
    : 'db.config.js';

  return [
    {
      relativePath: configFileName,
      action: 'create',
      description: 'sourceFile store config',
      content: SOURCE_FILE_CONFIG,
    },
    {
      relativePath: 'db/appState.json',
      action: 'create',
      description: 'app state saved directly to db/',
      content: APP_STATE_FIXTURE,
    },
  ];
}

function buildFollowUp(template: InitTemplate): string[] {
  const lines = [
    'npm run db:serve',
    'open http://127.0.0.1:7331/__db',
    'curl http://127.0.0.1:7331/db/users.json',
  ];

  if (template === 'source-file') {
    lines[2] = 'curl http://127.0.0.1:7331/db/appState.json';
  }

  if (template === 'schema-first') {
    lines.splice(2, 0, 'npm run db -- create users \'{"id":"u_1","name":"Ada Lovelace","email":"ada@example.com"}\'');
  }

  return lines;
}

async function applyInitPlan(cwd: string, files: PlannedFile[]): Promise<void> {
  for (const file of files) {
    const target = path.join(cwd, file.relativePath);

    if (file.action === 'create') {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content ?? '', 'utf8');
      continue;
    }

    if (file.relativePath === '.gitignore') {
      const current = await readFile(target, 'utf8');
      if (!hasGitignoreEntry(current)) {
        const separator = current.endsWith('\n') || current.length === 0 ? '' : '\n';
        await writeFile(target, `${current}${separator}${GITIGNORE_ENTRY}\n`, 'utf8');
      }
      continue;
    }

    if (file.relativePath === 'package.json') {
      const pkg = JSON.parse(await readFile(target, 'utf8')) as {
        scripts?: Record<string, string>;
      };
      pkg.scripts = { ...(pkg.scripts ?? {}) };
      for (const [key, command] of Object.entries(SCRIPT_ENTRIES)) {
        pkg.scripts[key] = pkg.scripts[key] ?? command;
      }
      await writeFile(target, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    }
  }
}

function hasGitignoreEntry(content: string): boolean {
  return content.split('\n').some((line) => line.trim() === GITIGNORE_ENTRY);
}

async function readPackageJson(packageJsonPath: string): Promise<{ type?: string; scripts?: Record<string, string> } | null> {
  try {
    return JSON.parse(await readFile(packageJsonPath, 'utf8')) as { type?: string; scripts?: Record<string, string> };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function replaceContent(key: string, value: unknown): unknown {
  return key === 'content' ? undefined : value;
}

async function assertCanWrite(filePath: string): Promise<void> {
  try {
    await access(filePath);
    throw new Error(`Refusing to overwrite existing file ${filePath}. Move or remove it first.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
