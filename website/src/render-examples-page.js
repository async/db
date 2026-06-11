import { LEVEL_BLURBS, LEVEL_LABELS, LEVEL_ORDER } from './examples-meta.js';
import {
  CODE_EXPLORER_SCRIPT,
  CodeExplorer,
  Header,
  HtmlPage,
  docLinkPrefixes,
} from './components.js';
import { rewriteLandingSourceLink } from './link-map.js';
import { escapeHtml, renderMarkdown } from './render-md.js';

/**
 * Standalone examples browser: top navbar, no docs sidebar, one IDE-style
 * file viewer per example, grouped by complexity tier.
 *
 * @param {Array<Awaited<ReturnType<import('./examples-loader.js').loadExample>>>} examples
 */
export function renderExamplesPage(examples) {
  const prefixes = docLinkPrefixes('pages');

  const tierPills = LEVEL_ORDER
    .filter((level) => examples.some((example) => example.level === level))
    .map((level) => `<a class="rounded-full border border-cyan-900/80 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-cyan-300 hover:text-cyan-100 [.light_&]:border-slate-300 [.light_&]:text-slate-700 [.light_&]:hover:border-cyan-700 [.light_&]:hover:text-cyan-900" href="#level-${escapeHtml(level)}">${escapeHtml(LEVEL_LABELS[level])}</a>`)
    .join('');

  const sections = LEVEL_ORDER.map((level) => {
    const levelExamples = examples.filter((example) => example.level === level);
    if (levelExamples.length === 0) {
      return '';
    }

    const blocks = levelExamples.map((example) => {
      const intro = example.intro
        ? `<div class="mt-3 max-w-3xl text-base leading-7 text-slate-300 [.light_&]:text-slate-700">${renderMarkdown(example.intro, { linkContext: 'pages' })}</div>`
        : '';
      return `
        <section id="example-${escapeHtml(example.id)}" class="scroll-mt-24">
          <h3 class="text-xl font-bold text-slate-50 [.light_&]:text-slate-950">${escapeHtml(example.title)}</h3>
          ${intro}
          <div class="mt-5">
            ${CodeExplorer(`example-${example.id}`, {
              title: `examples/${example.id}`,
              githubUrl: example.githubUrl,
              files: example.files,
            })}
          </div>
        </section>
      `;
    }).join('\n');

    return `
      <section id="level-${escapeHtml(level)}" class="scroll-mt-24">
        <h2 class="border-b border-cyan-950/80 pb-3 text-3xl font-black text-slate-50 [.light_&]:border-slate-200 [.light_&]:text-slate-950">${escapeHtml(LEVEL_LABELS[level])}</h2>
        <p class="mt-3 max-w-3xl text-base leading-7 text-slate-400 [.light_&]:text-slate-600">${escapeHtml(LEVEL_BLURBS[level] ?? '')}</p>
        <div class="mt-8 space-y-14">${blocks}</div>
      </section>
    `;
  }).join('\n');

  return HtmlPage({
    title: 'Examples | @async/db',
    description: 'All runnable example projects, ordered by complexity, with IDE-style file previews.',
    header: Header(prefixes, 'examples'),
    homePrefix: prefixes.home,
    extraScript: CODE_EXPLORER_SCRIPT,
    main: `
      <div class="mx-auto w-full max-w-6xl min-w-0 px-5 py-12 sm:px-8">
        <h1 class="text-4xl font-black text-slate-50 text-balance sm:text-5xl [.light_&]:text-slate-950">Examples</h1>
        <p class="mt-4 max-w-3xl text-lg leading-8 text-slate-300 [.light_&]:text-slate-700">Every runnable example project from the repo, ordered by complexity. Each editor shows the project files — start with the README, then read the data folder and config. Clone any example from GitHub to run it locally.</p>
        <div class="mt-6 flex flex-wrap gap-2">${tierPills}</div>
        <div class="mt-12 space-y-16">${sections}</div>
      </div>
    `,
  });
}

/**
 * @param {Awaited<ReturnType<import('./examples-loader.js').loadTeaserExample>>} example
 */
export function renderExamplesTeaser(example) {
  return `
    <div class="example-teaser">
      <div>
        <p class="eyebrow">runnable example</p>
        <h3>${escapeHtml(example.title)}</h3>
        <p>${escapeHtml(example.intro || 'Open a complete example project with the data files, config, and commands together.')}</p>
      </div>
      <div class="button-row">
        <a class="primary-link" href="./docs/examples.html">Browse examples</a>
        <a href="${escapeHtml(example.githubUrl)}" rel="noopener">Open on GitHub</a>
      </div>
    </div>
  `;
}

const TEASER_PLACEHOLDER = '<!-- @example-explorer -->';

export function renderLandingWithTeaser(landingHtml, teaserHtml) {
  if (!landingHtml.includes(TEASER_PLACEHOLDER)) {
    throw new Error(`Landing page is missing the ${TEASER_PLACEHOLDER} placeholder.`);
  }
  // Function replacements avoid String.replace's special "$" substitution
  // patterns, which could corrupt injected example file contents.
  const withTeaser = landingHtml.replace(TEASER_PLACEHOLDER, () => teaserHtml);
  const withPagesLinks = withTeaser.replace(/href="([^"]+)"/gu, (match, href) => (
    `href="${escapeHtml(rewriteLandingSourceLink(href))}"`
  ));
  return withPagesLinks;
}
