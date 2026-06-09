#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type PathPattern = string | RegExp;

export type ApiSurfaceCheckOptions = {
  changedFiles: string[];
  apiSurfacePath?: string;
};

export type ApiSurfaceCheckResult = {
  ok: boolean;
  apiSurfaceChanged: boolean;
  publicSurfaceFiles: string[];
  message: string;
};

type CliOptions = {
  cwd: string;
  base?: string;
  head: string;
  apiSurfacePath: string;
};

type ChangedFilesResult = {
  base: string;
  comparedBase: string;
  files: string[];
  warnings: string[];
};

const DEFAULT_API_SURFACE_PATH = 'API_SURFACE.md';
const PACKAGE_JSON_PUBLIC_KEYS = ['name', 'type', 'bin', 'exports', 'files', 'engines'] as const;

const PUBLIC_SURFACE_PATTERNS: PathPattern[] = [
  'package.json',
  'db.config.example.js',
  /^src\/[^/]+\.d\.ts$/,
  /^src\/(?:index|client|client-cache|config|config-public|db|runtime|server|request-handler|schema|schema-builders|schema-manifest|viewer-manifest|types|operations|json|hono|sqlite|sqlite-compat|postgres|kv|redis|vite)\.ts$/,
  /^src\/cli(?:\.ts|\/)/,
  /^src\/features\/(?:config|contracts|generate|http|integrate|operations|runtime|schema|sync|usage|viewer)\//,
  /^src\/(?:falcor|graphql|integrations|rest|web)\//,
];

const IGNORED_PUBLIC_SURFACE_PATTERNS: PathPattern[] = [
  /^src\/.*\.test\.ts$/,
  /^test\//,
  /^scripts\//,
  /^examples\//,
  /^docs\//,
];

export function evaluateApiSurfaceCheck(options: ApiSurfaceCheckOptions): ApiSurfaceCheckResult {
  const apiSurfacePath = normalizeGitPath(options.apiSurfacePath ?? DEFAULT_API_SURFACE_PATH);
  const changedFiles = [...new Set(options.changedFiles.map((file) => normalizeGitPath(file)).filter(Boolean))].sort();
  const apiSurfaceChanged = changedFiles.includes(apiSurfacePath);
  const publicSurfaceFiles = changedFiles.filter((file) => file !== apiSurfacePath && isPublicSurfaceFile(file));

  if (publicSurfaceFiles.length === 0) {
    return {
      ok: true,
      apiSurfaceChanged,
      publicSurfaceFiles,
      message: 'API surface check passed: no watched public-surface files changed.',
    };
  }

  if (apiSurfaceChanged) {
    return {
      ok: true,
      apiSurfaceChanged,
      publicSurfaceFiles,
      message: `API surface check passed: ${apiSurfacePath} changed alongside ${publicSurfaceFiles.length} public-surface file(s).`,
    };
  }

  return {
    ok: false,
    apiSurfaceChanged,
    publicSurfaceFiles,
    message: [
      'API surface check failed: watched public-surface files changed, but API_SURFACE.md did not change.',
      'Update API_SURFACE.md with the public contract change, or narrow the changed files if this is not public API.',
      '',
      'Changed public-surface files:',
      ...publicSurfaceFiles.map((file) => `- ${file}`),
    ].join('\n'),
  };
}

export function isPublicSurfaceFile(file: string): boolean {
  const normalized = normalizeGitPath(file);
  if (!normalized) {
    return false;
  }
  if (matchesAny(normalized, IGNORED_PUBLIC_SURFACE_PATTERNS)) {
    return false;
  }
  return matchesAny(normalized, PUBLIC_SURFACE_PATTERNS);
}

export function normalizeGitPath(file: string): string {
  return file.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function collectChangedFiles(options: CliOptions): ChangedFilesResult {
  const warnings: string[] = [];
  const base = resolveBaseRef(options, warnings);
  const comparedBase = resolveMergeBase(options.cwd, base, options.head) ?? base;
  const files = new Set<string>();

  addGitOutput(files, options.cwd, ['diff', '--name-only', comparedBase, options.head]);
  addGitOutput(files, options.cwd, ['diff', '--name-only']);
  addGitOutput(files, options.cwd, ['diff', '--name-only', '--cached']);
  addGitOutput(files, options.cwd, ['ls-files', '--others', '--exclude-standard']);

  if (files.has('package.json') && !hasPackageJsonPublicSurfaceChange(options.cwd, comparedBase)) {
    files.delete('package.json');
  }

  return {
    base,
    comparedBase,
    files: [...files].map((file) => normalizeGitPath(file)).filter(Boolean).sort(),
    warnings,
  };
}

function resolveBaseRef(options: CliOptions, warnings: string[]): string {
  const explicitBase = options.base ?? process.env.API_SURFACE_BASE;
  if (explicitBase) {
    assertGitRef(options.cwd, explicitBase, 'API surface base');
    return explicitBase;
  }

  const candidates = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : '',
    'origin/main',
    'origin/master',
    'HEAD',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (hasGitRef(options.cwd, candidate)) {
      return candidate;
    }
  }

  warnings.push('Could not resolve a git base ref; checking only working tree changes.');
  return 'HEAD';
}

function resolveMergeBase(cwd: string, base: string, head: string): string | null {
  return runGit(cwd, ['merge-base', base, head], { allowFailure: true });
}

function assertGitRef(cwd: string, ref: string, label: string): void {
  if (!hasGitRef(cwd, ref)) {
    throw new Error(`${label} "${ref}" is not a valid git ref. Fetch it first or set API_SURFACE_BASE to a local ref.`);
  }
}

function hasGitRef(cwd: string, ref: string): boolean {
  return runGit(cwd, ['rev-parse', '--verify', ref], { allowFailure: true }) !== null;
}

function addGitOutput(files: Set<string>, cwd: string, args: string[]): void {
  const output = runGit(cwd, args, { allowFailure: true });
  if (!output) {
    return;
  }
  for (const file of output.split('\n')) {
    const normalized = normalizeGitPath(file);
    if (normalized) {
      files.add(normalized);
    }
  }
}

function hasPackageJsonPublicSurfaceChange(cwd: string, base: string): boolean {
  const before = readPackageJsonAtRef(cwd, base);
  const after = readPackageJsonFromWorktree(cwd);
  if (!before || !after) {
    return true;
  }

  return PACKAGE_JSON_PUBLIC_KEYS.some((key) => stableJson(before[key]) !== stableJson(after[key]));
}

function readPackageJsonAtRef(cwd: string, ref: string): Record<string, unknown> | null {
  const content = runGit(cwd, ['show', `${ref}:package.json`], { allowFailure: true });
  if (!content) {
    return null;
  }
  return parseJsonObject(content);
}

function readPackageJsonFromWorktree(cwd: string): Record<string, unknown> | null {
  try {
    return parseJsonObject(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function runGit(cwd: string, args: string[], options: { allowFailure?: boolean } = {}): string | null {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });

  if (result.status === 0) {
    return result.stdout.trim();
  }

  if (options.allowFailure) {
    return null;
  }

  throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
}

function matchesAny(file: string, patterns: PathPattern[]): boolean {
  return patterns.some((pattern) => typeof pattern === 'string' ? file === pattern : pattern.test(file));
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    cwd: process.cwd(),
    head: 'HEAD',
    apiSurfacePath: DEFAULT_API_SURFACE_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--cwd') {
      options.cwd = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--base') {
      options.base = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--head') {
      options.head = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--api-surface') {
      options.apiSurfacePath = normalizeGitPath(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }
    throw new Error(`Unknown option "${arg}". Run with --help for usage.`);
  }

  return options;
}

function readOptionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function printHelp(): void {
  console.log(`Usage: node scripts/check-api-surface.js [options]

Fails when watched public-surface files changed without API_SURFACE.md.

Options:
  --base <ref>          Base git ref. Defaults to API_SURFACE_BASE, GitHub PR base, origin/main, or HEAD.
  --head <ref>          Head git ref. Defaults to HEAD.
  --cwd <dir>           Repository root. Defaults to the current working directory.
  --api-surface <file>  API surface ledger path. Defaults to API_SURFACE.md.
`);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(path.resolve(entry)).href);
}

if (isMainModule()) {
  try {
    const options = parseCliOptions(process.argv.slice(2));
    const changed = collectChangedFiles(options);
    const result = evaluateApiSurfaceCheck({
      changedFiles: changed.files,
      apiSurfacePath: options.apiSurfacePath,
    });

    for (const warning of changed.warnings) {
      console.warn(`warning: ${warning}`);
    }

    console.log(result.message);
    console.log(`Compared base: ${changed.base} (${changed.comparedBase})`);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
