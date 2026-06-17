import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { EXPLORER_FILE_CAP, LEVEL_ORDER, TEASER_EXAMPLE_ID } from './examples-meta.js';
import { GITHUB_REPO } from './site-meta.js';

const SKIP_DIRS = new Set(['node_modules', '.db', 'generated', 'dist', 'examples']);
const SKIP_FILES = new Set(['example.json', 'package.json', 'package-lock.json', 'serve-example.js', '.DS_Store', '.gitignore']);
const INCLUDE_EXTENSIONS = new Set(['.json', '.jsonc', '.js', '.mjs', '.ts', '.csv', '.md', '.mdx', '.html']);

/**
 * @param {string} repoRoot
 */
export async function discoverExampleIds(repoRoot) {
  const examplesDir = path.join(repoRoot, 'examples');
  const entries = await readdir(examplesDir, { withFileTypes: true });
  const ids = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      await readFile(path.join(examplesDir, entry.name, 'example.json'), 'utf8');
      ids.push(entry.name);
    } catch {
      // folders without example.json are not showcased
    }
  }
  return ids.sort();
}

/**
 * @param {string} repoRoot
 * @param {string} exampleId
 */
export async function loadExample(repoRoot, exampleId) {
  const exampleDir = path.join(repoRoot, 'examples', exampleId);

  let meta = { title: exampleId, description: '', level: 'core', order: 999 };
  try {
    meta = { ...meta, ...JSON.parse(await readFile(path.join(exampleDir, 'example.json'), 'utf8')) };
  } catch {
    // keep defaults
  }

  const relativePaths = await listExampleFiles(exampleDir);
  const files = await Promise.all(relativePaths.map(async (relativePath) => {
    try {
      const content = await readFile(path.join(exampleDir, relativePath), 'utf8');
      return { path: relativePath, content };
    } catch {
      return null;
    }
  }));

  const loadedFiles = files.filter(Boolean);
  const readme = loadedFiles.find((file) => file.path === 'README.md');

  return {
    id: exampleId,
    title: meta.title,
    level: LEVEL_ORDER.includes(meta.level) ? meta.level : 'core',
    order: typeof meta.order === 'number' ? meta.order : 999,
    intro: extractReadmeIntro(readme?.content ?? '') || meta.description || '',
    githubUrl: `${GITHUB_REPO}/tree/main/examples/${exampleId}`,
    files: loadedFiles,
  };
}

/**
 * Discover and load every example, sorted by complexity level then order.
 *
 * @param {string} repoRoot
 */
export async function loadAllExamples(repoRoot) {
  const ids = await discoverExampleIds(repoRoot);
  const examples = await Promise.all(ids.map((id) => loadExample(repoRoot, id)));
  return examples.sort((left, right) => {
    const levelDelta = LEVEL_ORDER.indexOf(left.level) - LEVEL_ORDER.indexOf(right.level);
    if (levelDelta !== 0) {
      return levelDelta;
    }
    return left.order - right.order;
  });
}

/**
 * @param {string} repoRoot
 * @param {string} [exampleId]
 */
export async function loadTeaserExample(repoRoot, exampleId = TEASER_EXAMPLE_ID) {
  return loadExample(repoRoot, exampleId);
}

/** Walk one example folder and return display-ordered relative file paths. */
async function listExampleFiles(exampleDir) {
  const entries = await readdir(exampleDir, { withFileTypes: true, recursive: true });
  const paths = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const parent = entry.parentPath ?? exampleDir;
    const relative = path.relative(exampleDir, path.join(parent, entry.name));
    const parts = relative.split(path.sep);
    if (parts.slice(0, -1).some((part) => SKIP_DIRS.has(part))) {
      continue;
    }
    if (SKIP_FILES.has(entry.name) || entry.name.endsWith('.d.ts')) {
      continue;
    }
    if (!INCLUDE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    paths.push(parts.join('/'));
  }

  paths.sort((left, right) => {
    const groupDelta = fileGroup(left) - fileGroup(right);
    if (groupDelta !== 0) {
      return groupDelta;
    }
    return left.localeCompare(right);
  });

  return paths.slice(0, EXPLORER_FILE_CAP);
}

function fileGroup(relativePath) {
  if (relativePath === 'README.md') {
    return 0;
  }
  if (relativePath === 'db.config.js' || relativePath === 'db.config.mjs' || relativePath === 'deno.json') {
    return 1;
  }
  if (relativePath.startsWith('db/')) {
    return 2;
  }
  if (relativePath.startsWith('src/')) {
    return 3;
  }
  return 4;
}

/**
 * First explanatory paragraph from an example README. Prefers the
 * "What This Teaches" section, then any paragraph after the title.
 */
export function extractReadmeIntro(markdown) {
  const teachSection = markdown.split(/^## What This Teaches\s*$/mu)[1];
  const source = teachSection ?? String(markdown).replace(/^# .+$/mu, '');
  for (const block of source.split(/\n{2,}/u)) {
    const text = block.trim();
    if (!text || /^[#>`|-]/u.test(text)) {
      continue;
    }
    return text.replace(/\n/gu, ' ');
  }
  return '';
}
