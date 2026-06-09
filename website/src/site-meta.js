export const GITHUB_REPO = 'https://github.com/async-framework/async-db';

export const TIER_ORDER = ['start', 'build', 'production', 'reference', 'advanced'];

export const TIER_LABELS = {
  start: 'Start',
  build: 'Build',
  production: 'Production',
  reference: 'Reference',
  advanced: 'Advanced',
};

export const EXAMPLE_CHIPS = {
  'data-first': { tier: 'starter', level: 'starter', order: 1 },
  basic: { tier: 'starter', level: 'starter', order: 2 },
  'schema-first': { tier: 'core', level: 'core', order: 1 },
  advanced: { tier: 'core', level: 'core', order: 2 },
  'production-json': { tier: 'production', level: 'production', order: 1 },
  'local-web-app': { tier: 'production', level: 'production', order: 2 },
  'schema-manifest': { tier: 'production', level: 'production', order: 3 },
  'schema-ui': { tier: 'production', level: 'production', order: 4 },
  'rest-client': { tier: 'pattern', level: 'pattern', order: 1 },
  'standard-schema': { tier: 'pattern', level: 'pattern', order: 2 },
  'content-collections': { tier: 'pattern', level: 'pattern', order: 3 },
  'hono-auth': { tier: 'pattern', level: 'pattern', order: 4 },
};

export const EXAMPLE_LEVEL_LABELS = {
  starter: 'Starter',
  core: 'Core',
  production: 'Production',
  pattern: 'Patterns',
};

export function githubBlobPath(relativePath) {
  const normalized = relativePath
    .replace(/^\.\//, '')
    .replace(/^\.\.\//, '')
    .split('/')
    .filter(Boolean)
    .join('/');
  return `${GITHUB_REPO}/blob/main/${normalized}`;
}

export function githubEditPath(relativePath) {
  return `${GITHUB_REPO}/edit/main/${relativePath.replace(/^\.\//, '')}`;
}

export function sortPages(pages) {
  return [...pages].sort((left, right) => {
    const tierDelta = TIER_ORDER.indexOf(left.tier) - TIER_ORDER.indexOf(right.tier);
    if (tierDelta !== 0) {
      return tierDelta;
    }
    return (left.navOrder ?? 999) - (right.navOrder ?? 999);
  });
}

export function pageNeighbors(sortedPages, currentId, currentSection = 'pages') {
  const index = sortedPages.findIndex(
    (page) => page.id === currentId && (page.section ?? 'pages') === currentSection,
  );
  return {
    previous: index > 0 ? sortedPages[index - 1] : null,
    next: index >= 0 && index < sortedPages.length - 1 ? sortedPages[index + 1] : null,
  };
}

export function groupPagesByTier(pages) {
  const grouped = new Map(TIER_ORDER.map((tier) => [tier, []]));
  for (const page of sortPages(pages)) {
    grouped.get(page.tier)?.push(page);
  }
  return grouped;
}

/**
 * @param {Array<{ id: string; body: string; section?: string }>} pages
 * @param {Array<{ id: string; body: string }>} advanced
 * @param {Record<string, { tier: string; order: number; description: string }>} pagesRegistry
 * @param {Record<string, { tier: string; order: number; description: string }>} advancedRegistry
 */
export function combineDocPages(pages, advanced, pagesRegistry, advancedRegistry) {
  const enrichedPages = pages.map((page) => enrichPage(page, pagesRegistry, 'pages'));
  const enrichedAdvanced = advanced.map((page) => enrichPage(page, advancedRegistry, 'advanced'));
  return sortPages([...enrichedPages, ...enrichedAdvanced]);
}

/**
 * @param {{ id: string; body: string }} page
 * @param {Record<string, { tier: string; order: number; description: string }>} sourceRegistry
 * @param {'pages' | 'advanced'} section
 */
export function enrichPage(page, sourceRegistry, section) {
  const meta = sourceRegistry[page.id] ?? { tier: section === 'advanced' ? 'advanced' : 'reference', order: 999, description: '' };
  return {
    ...page,
    section,
    title: extractTitleFromBody(page.body) || page.id,
    tier: meta.tier,
    navOrder: meta.order,
    description: meta.description,
  };
}

function extractTitleFromBody(body) {
  const match = String(body ?? '').match(/^#\s+(.+)$/m);
  return match?.[1]?.trim().replaceAll('`', '') ?? '';
}
