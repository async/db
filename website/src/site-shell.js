import { advancedRegistry, registry } from '../db.schema.js';
import {
  TIER_LABELS,
  combineDocPages,
  githubEditPath,
  groupPagesByTier,
  pageNeighbors,
} from './site-meta.js';
import { extractHeadings, extractTitle, renderMarkdown } from './render-md.js';
import {
  DocShell,
  EditLink,
  Header,
  PrevNext,
  Sidebar,
  Toc,
  docLinkPrefixes,
} from './components.js';

/**
 * @param {Array<{ id: string; body: string }>} pages
 * @param {Array<{ id: string; body: string }>} advanced
 * @param {{ id: string; body: string; section?: 'pages' | 'advanced' }} page
 * @param {{ strictLinks?: boolean }} [options]
 */
export function renderGuidePage(pages, advanced, page, options = {}) {
  const section = page.section ?? 'pages';
  const sourceRegistry = section === 'advanced' ? advancedRegistry : registry;
  const meta = sourceRegistry[page.id] ?? { tier: 'reference', order: 999, description: '' };
  const title = extractTitle(page.body) || page.id;
  const sorted = combineDocPages(pages, advanced, registry, advancedRegistry);
  const neighbors = pageNeighbors(sorted, page.id, section);
  const grouped = groupPagesByTier(sorted);
  const prefixes = docLinkPrefixes(section);
  const content = renderMarkdown(page.body, { ...options, linkContext: section });
  const toc = Toc(extractHeadings(page.body));
  const editPath = section === 'advanced' ? `docs/advanced/${page.id}.md` : `docs/${page.id}.md`;

  return DocShell({
    title: `${title} | @async/db`,
    description: meta.description,
    tierLabel: TIER_LABELS[meta.tier] ?? meta.tier,
    content,
    sidebar: Sidebar(grouped, page.id, prefixes, section),
    toc,
    prevNext: PrevNext(neighbors, prefixes),
    editLink: EditLink(githubEditPath(editPath)),
    header: Header(prefixes, section),
    homePrefix: prefixes.home,
  });
}

/** @deprecated Use combineDocPages from site-meta.js */
export function enrichPages(pages) {
  return pages.map((page) => {
    const meta = registry[page.id] ?? { tier: 'reference', order: 999, description: '' };
    return {
      ...page,
      section: 'pages',
      title: extractTitle(page.body) || page.id,
      tier: meta.tier,
      navOrder: meta.order,
      description: meta.description,
    };
  });
}
