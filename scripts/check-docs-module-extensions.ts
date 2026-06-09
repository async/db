#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export type DocsModuleExtensionViolation = {
  file: string;
  line: number;
  column: number;
  match: string;
};

export type DocsModuleExtensionCheckResult = {
  ok: boolean;
  checkedFiles: string[];
  violations: DocsModuleExtensionViolation[];
  message: string;
};

export type DocsModuleExtensionCheckOptions = {
  cwd?: string;
  files?: Record<string, string>;
  allowedCompatibilityPath?: string;
  allowedCompatibilityHeading?: string;
};

const POLICY_MESSAGE = 'Docs should default to .js ESM files under package.json "type": "module". This repo and most developer repos can safely assume that package boundary. Keep .mjs/.mts support discussion only in docs/typescript-schema-sources.md.';
const DEFAULT_ALLOWED_COMPATIBILITY_PATH = 'docs/typescript-schema-sources.md';
const DEFAULT_ALLOWED_COMPATIBILITY_HEADING = 'Compatibility Extensions';
const TOP_LEVEL_MARKDOWN_FILES = new Set([
  'README.md',
  'SPEC.md',
  'API_SURFACE.md',
]);
const SCANNED_DIRECTORIES = new Set([
  'docs',
  'examples',
]);
const IGNORED_DIRECTORIES = new Set([
  '.db',
  '.git',
  '.tmp',
  'dist',
  'node_modules',
]);
const MODULE_EXTENSION_RE = /\.(?:mjs|mts)\b|(?<![\w.])(?:mjs|mts)\b/giu;

export async function checkDocsModuleExtensions(options: DocsModuleExtensionCheckOptions = {}): Promise<DocsModuleExtensionCheckResult> {
  const cwd = options.cwd ?? process.cwd();
  const allowedCompatibilityPath = normalizePath(options.allowedCompatibilityPath ?? DEFAULT_ALLOWED_COMPATIBILITY_PATH);
  const allowedCompatibilityHeading = options.allowedCompatibilityHeading ?? DEFAULT_ALLOWED_COMPATIBILITY_HEADING;
  const files = options.files ?? await readMarkdownFiles(cwd);
  return evaluateDocsModuleExtensionPolicy(files, { allowedCompatibilityPath, allowedCompatibilityHeading });
}

export function evaluateDocsModuleExtensionPolicy(
  files: Record<string, string>,
  options: { allowedCompatibilityPath?: string; allowedCompatibilityHeading?: string } = {},
): DocsModuleExtensionCheckResult {
  const allowedCompatibilityPath = normalizePath(options.allowedCompatibilityPath ?? DEFAULT_ALLOWED_COMPATIBILITY_PATH);
  const allowedCompatibilityHeading = options.allowedCompatibilityHeading ?? DEFAULT_ALLOWED_COMPATIBILITY_HEADING;
  const normalizedFiles = normalizeFiles(files);
  const checkedFiles = Object.keys(normalizedFiles).sort();
  const violations: DocsModuleExtensionViolation[] = [];

  for (const file of checkedFiles) {
    const content = normalizedFiles[file] ?? '';
    const allowedSection = file === allowedCompatibilityPath
      ? markdownSectionRange(content, allowedCompatibilityHeading)
      : null;

    for (const violation of moduleExtensionViolations(file, content)) {
      if (allowedSection && violation.line >= allowedSection.start && violation.line <= allowedSection.end) {
        continue;
      }
      violations.push(violation);
    }
  }

  violations.sort((left, right) => (
    left.file.localeCompare(right.file)
    || left.line - right.line
    || left.column - right.column
  ));

  return {
    ok: violations.length === 0,
    checkedFiles,
    violations,
    message: formatDocsModuleExtensionMessage(violations),
  };
}

function moduleExtensionViolations(file: string, content: string): DocsModuleExtensionViolation[] {
  const violations: DocsModuleExtensionViolation[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    MODULE_EXTENSION_RE.lastIndex = 0;
    for (const match of line.matchAll(MODULE_EXTENSION_RE)) {
      violations.push({
        file,
        line: index + 1,
        column: (match.index ?? 0) + 1,
        match: match[0],
      });
    }
  });

  return violations;
}

function markdownSectionRange(content: string, heading: string): { start: number; end: number } | null {
  const lines = content.split('\n');
  const normalizedHeading = normalizeHeadingText(heading);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (!match || normalizeHeadingText(match[2]) !== normalizedHeading) {
      continue;
    }

    const level = match[1].length;
    const start = index + 1;
    let end = lines.length;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const next = lines[nextIndex].match(/^(#{1,6})\s+/u);
      if (next && next[1].length <= level) {
        end = nextIndex;
        break;
      }
    }
    return { start, end };
  }

  return null;
}

function normalizeHeadingText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function formatDocsModuleExtensionMessage(violations: DocsModuleExtensionViolation[]): string {
  if (violations.length === 0) {
    return `Docs module extension check passed: ${POLICY_MESSAGE}`;
  }

  return [
    `Docs module extension check failed: ${POLICY_MESSAGE}`,
    '',
    'Disallowed docs references:',
    ...violations.map((violation) => `- ${violation.file}:${violation.line}:${violation.column} ${violation.match}`),
  ].join('\n');
}

async function readMarkdownFiles(cwd: string): Promise<Record<string, string>> {
  const files = await listMarkdownFiles(cwd);
  const entries = await Promise.all(files.map(async (file) => [
    file,
    await readFile(path.join(cwd, file), 'utf8'),
  ] as const));
  return Object.fromEntries(entries);
}

async function listMarkdownFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];

  for (const file of TOP_LEVEL_MARKDOWN_FILES) {
    files.push(file);
  }

  for (const directory of SCANNED_DIRECTORIES) {
    files.push(...await listMarkdownFilesInDirectory(cwd, directory));
  }

  return [...new Set(files.map(normalizePath))].sort();
}

async function listMarkdownFilesInDirectory(cwd: string, directory: string): Promise<string[]> {
  const entries = await readdir(path.join(cwd, directory), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = normalizePath(path.join(directory, entry.name));

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name) || relativePath === 'docs/goals') {
        continue;
      }
      files.push(...await listMarkdownFilesInDirectory(cwd, relativePath));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function normalizePath(file: string): string {
  return file.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeFiles(files: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [file, content] of Object.entries(files)) {
    normalized[normalizePath(file)] = content;
  }
  return normalized;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const result = await checkDocsModuleExtensions();
  if (!result.ok) {
    console.error(result.message);
    process.exitCode = 1;
  }
}
