import { advancedRegistry, registry } from '../db.schema.js';
import { GITHUB_REPO, githubBlobPath } from './site-meta.js';

const ALLOWED_PAGE_IDS = new Set(Object.keys(registry));
const ALLOWED_ADVANCED_IDS = new Set(Object.keys(advancedRegistry));

/** Manual pages excluded from the site by design; their links resolve to GitHub. */
const EXCLUDED_DOC_IDS = new Set([
  'README',
  'architecture',
  'ci-and-release',
  'migration',
  'async-db-devex-gap-analysis',
]);

/**
 * @param {string} href
 * @param {{ currentPageId?: string; strict?: boolean; linkContext?: 'pages' | 'advanced' }} [options]
 */
export function rewriteMarkdownLink(href, options = {}) {
  const trimmed = String(href ?? '').trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return trimmed;
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) {
    return trimmed;
  }

  const linkContext = options.linkContext ?? 'pages';
  const [target, fragment = ''] = trimmed.split('#');
  const suffix = fragment ? `#${fragment}` : '';
  const decoded = decodeURIComponent(target);

  if (decoded.startsWith('../examples/')) {
    return `${githubBlobPath(decoded)}${suffix}`;
  }

  if (decoded.startsWith('./advanced/') && decoded.endsWith('.md')) {
    const pageId = decoded.slice('./advanced/'.length).replace(/\.md$/u, '');
    if (ALLOWED_ADVANCED_IDS.has(pageId)) {
      return linkContext === 'advanced'
        ? `./${pageId}.html${suffix}`
        : `./advanced/${pageId}.html${suffix}`;
    }
  }

  if (decoded.startsWith('../') && !decoded.startsWith('../examples/')) {
    const repoRelative = decoded.replace(/^\.\.\//, '');
    if (repoRelative.endsWith('.md')) {
      const pageId = repoRelative.replace(/^docs\/advanced\//, '').replace(/^docs\//, '').replace(/\.md$/u, '');
      if (repoRelative.startsWith('docs/advanced/') && ALLOWED_ADVANCED_IDS.has(pageId)) {
        return linkContext === 'advanced'
          ? `./${pageId}.html${suffix}`
          : `./advanced/${pageId}.html${suffix}`;
      }
      if (ALLOWED_PAGE_IDS.has(pageId)) {
        return linkContext === 'advanced'
          ? `../${pageId}.html${suffix}`
          : `./${pageId}.html${suffix}`;
      }
    }
    return `${githubBlobPath(repoRelative)}${suffix}`;
  }

  if (decoded.endsWith('.md')) {
    const pageId = decoded.replace(/^\.\//, '').replace(/\.md$/u, '');
    if (ALLOWED_ADVANCED_IDS.has(pageId) && linkContext === 'advanced') {
      return `./${pageId}.html${suffix}`;
    }
    if (ALLOWED_PAGE_IDS.has(pageId)) {
      return linkContext === 'advanced'
        ? `../${pageId}.html${suffix}`
        : `./${pageId}.html${suffix}`;
    }
    if (EXCLUDED_DOC_IDS.has(pageId)) {
      return `${githubBlobPath(`docs/${pageId}.md`)}${suffix}`;
    }
    if (options.strict) {
      throw new Error(`Link target is not a known docs page: ${trimmed}`);
    }
    return `${githubBlobPath(`docs/${pageId}.md`)}${suffix}`;
  }

  return trimmed;
}

/**
 * @param {string} html
 * @param {{ strict?: boolean }} [options]
 */
export function validateHtmlLinks(html, options = {}) {
  const failures = [];
  const hrefRe = /href="([^"]+)"/gu;
  for (const match of html.matchAll(hrefRe)) {
    const href = match[1];
    if (href.startsWith('#') || /^https?:/iu.test(href) || href.startsWith('mailto:')) {
      continue;
    }
    if (/\.md(?:#|$)/u.test(href)) {
      failures.push(`Unresolved markdown link: ${href}`);
      continue;
    }
    if (options.strict && href.startsWith('./') && !href.endsWith('.html') && !href.includes('#')) {
      failures.push(`Suspicious relative link: ${href}`);
    }
  }
  return failures;
}

export { ALLOWED_PAGE_IDS, ALLOWED_ADVANCED_IDS, GITHUB_REPO };
