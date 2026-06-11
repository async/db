import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllExamples } from './examples-loader.js';
import { renderExamplesPage, renderLandingPage } from './render-examples-page.js';

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(websiteRoot, '..');

export async function buildExamplesPage() {
  const examples = await loadAllExamples(repoRoot);
  return renderExamplesPage(examples);
}

export async function buildLandingPageHtml() {
  const landingPath = path.join(websiteRoot, 'pages', 'index.html');
  const landingHtml = await readFile(landingPath, 'utf8');
  return renderLandingPage(landingHtml);
}
