#!/usr/bin/env node
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDb } from '../dist/index.js';
import { advancedRegistry, registry } from './db.schema.js';
import { ALLOWED_ADVANCED_IDS, ALLOWED_PAGE_IDS, validateHtmlLinks } from './src/link-map.js';
import { buildExamplesPage, buildLandingPageHtml } from './src/landing.js';
import { renderGuidePage } from './src/site-shell.js';

const websiteRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(websiteRoot, '..');

const DOCS_REDIRECT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=./getting-started.html">
    <link rel="canonical" href="./getting-started.html">
    <title>Redirecting…</title>
  </head>
  <body>
    <p>Redirecting to <a href="./getting-started.html">Getting started</a>.</p>
  </body>
</html>`;

/**
 * @param {string[]} argv
 */
export async function runDocsBuild(argv = process.argv.slice(2)) {
  const checkOnly = argv.includes('--check');
  const outDir = checkOnly
    ? path.join(repoRoot, '.tmp', 'docs-site-check')
    : path.join(websiteRoot, 'dist');

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const docsOutDir = path.join(outDir, 'docs');
  const advancedOutDir = path.join(docsOutDir, 'advanced');
  await mkdir(advancedOutDir, { recursive: true });

  const db = await openDb({ cwd: websiteRoot, syncOnOpen: true });
  await db.runtime.hydrate();
  const pages = await db.collection('pages').all();
  const advanced = await db.collection('advanced').all();
  const failures = [];

  if (pages.length !== ALLOWED_PAGE_IDS.size) {
    failures.push(`Expected ${ALLOWED_PAGE_IDS.size} allowlisted pages, got ${pages.length}.`);
  }
  if (advanced.length !== ALLOWED_ADVANCED_IDS.size) {
    failures.push(`Expected ${ALLOWED_ADVANCED_IDS.size} advanced pages, got ${advanced.length}.`);
  }

  for (const page of pages) {
    const html = renderGuidePage(pages, advanced, { ...page, section: 'pages' }, { strictLinks: true });
    failures.push(...validateHtmlLinks(html, { strict: true }));
    await writeFile(path.join(docsOutDir, `${page.id}.html`), html, 'utf8');
  }

  for (const page of advanced) {
    const html = renderGuidePage(pages, advanced, { ...page, section: 'advanced' }, { strictLinks: true });
    failures.push(...validateHtmlLinks(html, { strict: true }));
    await writeFile(path.join(advancedOutDir, `${page.id}.html`), html, 'utf8');
  }

  await writeFile(path.join(docsOutDir, 'index.html'), DOCS_REDIRECT_HTML, 'utf8');

  const examplesHtml = await buildExamplesPage();
  failures.push(...validateHtmlLinks(examplesHtml, { strict: true }));
  await writeFile(path.join(docsOutDir, 'examples.html'), examplesHtml, 'utf8');

  await writeLandingPage(outDir, failures);
  await validateBuiltSite(outDir, failures);
  await db.close();

  if (failures.length > 0) {
    throw new Error(`Docs build failed:\n${failures.map((item) => `- ${item}`).join('\n')}`);
  }

  if (checkOnly) {
    await rm(outDir, { recursive: true, force: true });
  }

  return { ok: true, pages: pages.length, advanced: advanced.length, examples: 1, outDir };
}

async function writeLandingPage(outDir, failures) {
  const html = await buildLandingPageHtml();
  await writeFile(path.join(outDir, 'index.html'), html, 'utf8');
  failures.push(...validateHtmlLinks(html, { strict: true }));
}

/** Existence-check every site-local href across all built HTML files. */
async function validateBuiltSite(outDir, failures) {
  for (const file of await listHtmlFiles(outDir)) {
    const html = await readFile(file, 'utf8');
    failures.push(...await validateLocalHrefs(html, file, outDir));
  }
}

async function listHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => path.join(entry.parentPath ?? directory, entry.name));
}

/** Verify every site-local href resolves to a file inside the build output. */
async function validateLocalHrefs(html, filePath, outDir) {
  const failures = [];
  const hrefRe = /href="([^"]+)"/gu;
  for (const match of html.matchAll(hrefRe)) {
    const href = match[1];
    if (href.startsWith('#') || /^https?:/iu.test(href) || href.startsWith('mailto:')) {
      continue;
    }
    if (/\.md(?:#|$)/u.test(href)) {
      failures.push(`${path.relative(outDir, filePath)}: unresolved markdown href ${href}`);
      continue;
    }
    const targetPath = href.split('#')[0];
    if (!targetPath) {
      continue;
    }
    const resolved = targetPath.startsWith('/')
      ? path.join(outDir, targetPath)
      : path.resolve(path.dirname(filePath), targetPath);
    if (!resolved.startsWith(outDir)) {
      failures.push(`${path.relative(outDir, filePath)}: link escapes the site root ${href}`);
      continue;
    }
    try {
      await access(resolved);
    } catch {
      failures.push(`${path.relative(outDir, filePath)}: broken link ${href}`);
    }
  }
  return failures;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runDocsBuild().then((result) => {
    console.log(`Built ${result.pages} guide pages, ${result.advanced} advanced pages, and ${result.examples} examples page to ${result.outDir}`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { registry, advancedRegistry };
