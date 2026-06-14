import { escapeHtml } from './render-md.js';
import { GITHUB_REPO, TIER_LABELS, TIER_ORDER } from './site-meta.js';

/** Blocking head script: resolve system/light/dark preference before paint. */
export const THEME_SCRIPT = `
const requestedTheme = new URLSearchParams(location.search).get("theme");
const storedTheme = localStorage.getItem("async-db-docs-theme");
const themePreference = requestedTheme === "light" || requestedTheme === "dark"
  ? requestedTheme
  : (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system" ? storedTheme : "dark");
const systemPrefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
if (themePreference === "light" || (themePreference === "system" && systemPrefersLight)) {
  document.documentElement.classList.add("light");
}
`.trim();

export const SITE_SCRIPT = `
const THEME_KEY = "async-db-docs-theme";
function themePreference() {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
}
function applyThemePreference() {
  const preference = themePreference();
  const systemLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  const isLight = preference === "light" || (preference === "system" && systemLight);
  document.documentElement.classList.toggle("light", isLight);
  document.querySelectorAll("[data-theme-menu]").forEach((menu) => {
    menu.querySelectorAll("[data-theme-icon]").forEach((icon) => {
      icon.classList.toggle("hidden", icon.getAttribute("data-theme-icon") !== preference);
    });
    menu.querySelectorAll("[data-theme-choice]").forEach((choice) => {
      choice.setAttribute("aria-checked", String(choice.getAttribute("data-theme-choice") === preference));
    });
  });
}
document.querySelectorAll("[data-theme-menu]").forEach((menu) => {
  const trigger = menu.querySelector("[data-theme-trigger]");
  const options = menu.querySelector("[data-theme-options]");
  if (!trigger || !options) {
    return;
  }
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = options.classList.toggle("hidden") === false;
    trigger.setAttribute("aria-expanded", String(open));
  });
  menu.querySelectorAll("[data-theme-choice]").forEach((choice) => {
    choice.addEventListener("click", () => {
      localStorage.setItem(THEME_KEY, choice.getAttribute("data-theme-choice"));
      applyThemePreference();
      options.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
    });
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll("[data-theme-options]").forEach((options) => options.classList.add("hidden"));
  document.querySelectorAll("[data-theme-trigger]").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
});
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (themePreference() === "system") {
    applyThemePreference();
  }
});
const sidebarToggle = document.querySelector("[data-sidebar-toggle]");
const sidebarPanel = document.querySelector("[data-sidebar-panel]");
if (sidebarToggle && sidebarPanel) {
  sidebarToggle.addEventListener("click", () => {
    const open = sidebarPanel.dataset.open !== "true";
    sidebarPanel.dataset.open = String(open);
    sidebarToggle.setAttribute("aria-expanded", String(open));
  });
}
applyThemePreference();
`.trim();

const THEME_ICONS = {
  system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="size-4" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8m-4-4v4"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="size-4" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.3 11.3 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="size-4" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
};

/** Theme picker: icon trigger with a system/light/dark dropdown. */
export function ThemeMenu() {
  const icons = Object.entries(THEME_ICONS).map(([preference, svg]) => (
    `<span class="hidden" data-theme-icon="${preference}">${svg}</span>`
  )).join('');
  const choices = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([preference, label]) => (
    `<button class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-slate-300 hover:bg-slate-800 hover:text-cyan-100 aria-checked:bg-cyan-300/10 aria-checked:text-cyan-100 [.light_&]:text-slate-700 [.light_&]:hover:bg-slate-100 [.light_&]:aria-checked:bg-cyan-50 [.light_&]:aria-checked:text-cyan-900" type="button" role="menuitemradio" aria-checked="false" data-theme-choice="${preference}">${THEME_ICONS[preference]}${label}</button>`
  )).join('');

  return `
    <div class="relative shrink-0" data-theme-menu>
      <button class="flex items-center justify-center rounded-full border border-cyan-400/70 p-2.5 text-cyan-100 transition hover:bg-cyan-300 hover:text-slate-950 focus:outline-2 focus:outline-offset-2 focus:outline-cyan-300 [.light_&]:border-cyan-700 [.light_&]:text-cyan-900 [.light_&]:hover:bg-cyan-700 [.light_&]:hover:text-white" type="button" data-theme-trigger aria-haspopup="menu" aria-expanded="false" aria-label="Color theme">${icons}</button>
      <div class="absolute right-0 z-50 mt-2 hidden w-36 rounded-lg border border-cyan-900/80 bg-[#071427] p-1 text-sm shadow-xl shadow-cyan-950/30 [.light_&]:border-slate-200 [.light_&]:bg-white" role="menu" data-theme-options>${choices}</div>
    </div>
  `;
}

/**
 * @param {'pages' | 'advanced'} section
 */
export function docLinkPrefixes(section) {
  if (section === 'advanced') {
    return { home: '../../', docs: '../', page: '../', advanced: './' };
  }
  return { home: '../', docs: './', page: './', advanced: './advanced/' };
}

/**
 * @param {{ id: string; section?: 'pages' | 'advanced' }} page
 * @param {ReturnType<typeof docLinkPrefixes>} prefixes
 */
export function pageHref(page, prefixes) {
  if (page.section === 'advanced') {
    return `${prefixes.advanced}${page.id}.html`;
  }
  return `${prefixes.page}${page.id}.html`;
}

/**
 * @param {ReturnType<typeof docLinkPrefixes>} prefixes
 * @param {'pages' | 'advanced' | 'examples'} [section]
 */
export function Header(prefixes, section = 'pages') {
  const homeHref = `${prefixes.home}index.html`;
  const activeClasses = 'rounded-full px-4 py-2 text-cyan-100 [.light_&]:text-cyan-900';
  const idleClasses = 'rounded-full px-4 py-2 hover:bg-slate-800 hover:text-cyan-100 focus:outline-2 focus:outline-offset-2 focus:outline-cyan-300 [.light_&]:hover:bg-slate-100 [.light_&]:hover:text-slate-950';
  const navLinks = [
    { label: 'Docs', href: `${prefixes.docs}getting-started.html`, active: section === 'pages' || section === 'advanced' },
    { label: 'Examples', href: `${prefixes.docs}examples.html`, active: section === 'examples' },
    { label: 'GitHub', href: GITHUB_REPO, active: false },
  ].map((link) => `<a class="${link.active ? activeClasses : idleClasses}" href="${escapeHtml(link.href)}"${link.href.startsWith('http') ? ' rel="noopener"' : ''}>${escapeHtml(link.label)}</a>`).join('');
  const sidebarToggle = section === 'examples'
    ? ''
    : '<button class="rounded-md border border-cyan-900/80 px-2.5 py-2 text-xs font-semibold text-slate-300 lg:hidden [.light_&]:border-slate-200 [.light_&]:text-slate-700" type="button" data-sidebar-toggle aria-expanded="false" aria-controls="docs-sidebar">Menu</button>';

  return `
    <header class="sticky top-0 z-40 w-full max-w-full border-b border-cyan-950/80 bg-[#020917]/95 backdrop-blur [.light_&]:border-slate-200 [.light_&]:bg-white/95">
      <div class="mx-auto flex w-full max-w-7xl min-w-0 items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div class="flex min-w-0 items-center gap-3">
          ${sidebarToggle}
          <a class="flex min-w-0 items-center gap-3 text-slate-50 [.light_&]:text-slate-950" href="${escapeHtml(homeHref)}" aria-label="@async/db docs home">
            <span class="grid size-8 shrink-0 grid-cols-2 gap-1" aria-hidden="true"><span class="rounded-sm border border-cyan-300"></span><span class="rounded-sm border border-emerald-300"></span><span class="rounded-sm border border-amber-300"></span><span class="rounded-sm border border-sky-500"></span></span>
            <span class="truncate text-base font-semibold">@async/db</span>
          </a>
        </div>
        <nav class="hidden items-center gap-1 text-sm font-medium text-slate-300 md:flex [.light_&]:text-slate-700" aria-label="Primary">${navLinks}</nav>
        ${ThemeMenu()}
      </div>
    </header>
  `;
}

/**
 * @param {Map<string, Array<{ id: string; title: string; section?: string }>>} grouped
 * @param {string} currentId
 * @param {ReturnType<typeof docLinkPrefixes>} prefixes
 * @param {'pages' | 'advanced'} currentSection
 */
export function Sidebar(grouped, currentId, prefixes, currentSection) {
  const sections = TIER_ORDER.map((tier) => {
    const pages = grouped.get(tier) ?? [];
    if (pages.length === 0) {
      return '';
    }
    const links = pages.map((page) => {
      const active = page.id === currentId && (page.section ?? 'pages') === currentSection;
      const classes = active
        ? 'block rounded-md bg-cyan-300/10 px-3 py-2 font-semibold text-cyan-100 [.light_&]:bg-cyan-50 [.light_&]:text-cyan-900'
        : 'block rounded-md px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-cyan-100 [.light_&]:text-slate-700 [.light_&]:hover:bg-slate-100 [.light_&]:hover:text-slate-950';
      const href = pageHref(page, prefixes);
      return `<a class="${classes}" href="${escapeHtml(href)}">${escapeHtml(page.title)}</a>`;
    }).join('');
    return `
      <div>
        <p class="mb-2 px-3 text-xs font-bold uppercase tracking-wide text-slate-500">${escapeHtml(TIER_LABELS[tier])}</p>
        <div class="space-y-1">${links}</div>
      </div>
    `;
  }).join('');

  return `
    <aside class="min-w-0 lg:sticky lg:top-24 lg:self-start">
      <details class="group mb-4 rounded-lg border border-cyan-900/80 bg-[#071427] lg:hidden [.light_&]:border-slate-200 [.light_&]:bg-white" data-sidebar-panel data-open="false">
        <summary class="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-200 marker:content-none [.light_&]:text-slate-800">Browse docs</summary>
        <nav class="space-y-6 border-t border-cyan-900/80 p-4 text-sm [.light_&]:border-slate-200" aria-label="Guide navigation">${sections}</nav>
      </details>
      <nav id="docs-sidebar" class="hidden space-y-6 text-sm lg:block" aria-label="Guide navigation">${sections}</nav>
    </aside>
  `;
}

/**
 * @param {Array<{ level: number; text: string; id: string }>} headings
 */
export function Toc(headings) {
  if (headings.length === 0) {
    return '<aside class="hidden xl:block"></aside>';
  }
  const links = headings.map((heading) => {
    const indent = heading.level === 3 ? 'pl-3' : '';
    return `<a class="block ${indent} rounded px-2 py-1 text-slate-400 hover:text-cyan-200 [.light_&]:text-slate-600 [.light_&]:hover:text-cyan-800" href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`;
  }).join('');
  return `
    <aside class="hidden xl:block">
      <nav class="sticky top-24 text-sm" aria-label="On this page">
        <p class="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">On this page</p>
        <div class="space-y-1">${links}</div>
      </nav>
    </aside>
  `;
}

/**
 * @param {{ previous: object | null; next: object | null }} neighbors
 * @param {ReturnType<typeof docLinkPrefixes>} prefixes
 */
export function PrevNext(neighbors, prefixes) {
  const { previous, next } = neighbors;
  if (!previous && !next) {
    return '';
  }
  const prevLink = previous
    ? `<a class="rounded-lg border border-cyan-900/80 p-4 hover:border-cyan-300 [.light_&]:border-slate-200 [.light_&]:hover:border-cyan-700" href="${escapeHtml(pageHref(previous, prefixes))}"><span class="text-xs font-semibold uppercase text-slate-500">Previous</span><span class="mt-1 block font-bold text-slate-100 [.light_&]:text-slate-900">${escapeHtml(previous.title)}</span></a>`
    : '<span></span>';
  const nextLink = next
    ? `<a class="rounded-lg border border-cyan-900/80 p-4 hover:border-cyan-300 [.light_&]:border-slate-200 [.light_&]:hover:border-cyan-700" href="${escapeHtml(pageHref(next, prefixes))}"><span class="text-xs font-semibold uppercase text-slate-500">Next</span><span class="mt-1 block font-bold text-slate-100 [.light_&]:text-slate-900">${escapeHtml(next.title)}</span></a>`
    : '<span></span>';
  return `
    <nav class="mt-12 grid gap-3 border-t border-cyan-950/80 pt-6 sm:grid-cols-2 [.light_&]:border-slate-200" aria-label="Previous and next pages">
      ${prevLink}
      ${nextLink}
    </nav>
  `;
}

/**
 * @param {string} editUrl
 */
export function EditLink(editUrl) {
  return `<p class="mt-10 text-sm text-slate-400 [.light_&]:text-slate-600"><a class="font-semibold text-cyan-200 hover:text-cyan-100 [.light_&]:text-cyan-800" href="${escapeHtml(editUrl)}">Edit this page on GitHub</a></p>`;
}

/**
 * @param {'note' | 'warning'} variant
 * @param {string} htmlContent
 */
export function Callout(variant, htmlContent) {
  const styles = variant === 'warning'
    ? {
      border: 'border-amber-400/40 [.light_&]:border-amber-300',
      bg: 'bg-amber-300/10 [.light_&]:bg-amber-50',
      label: 'text-amber-200 [.light_&]:text-amber-900',
      title: 'Warning',
    }
    : {
      border: 'border-cyan-400/40 [.light_&]:border-cyan-300',
      bg: 'bg-cyan-300/10 [.light_&]:bg-cyan-50',
      label: 'text-cyan-200 [.light_&]:text-cyan-900',
      title: 'Note',
    };
  return `
    <aside class="my-6 rounded-lg border ${styles.border} ${styles.bg} p-4" role="note">
      <p class="mb-2 text-xs font-bold uppercase tracking-wide ${styles.label}">${styles.title}</p>
      <div class="text-sm leading-7 text-slate-200 [.light_&]:text-slate-800">${htmlContent}</div>
    </aside>
  `;
}

export const CODE_EXPLORER_SCRIPT = `
document.querySelectorAll("[data-code-explorer]").forEach((group) => {
  const buttons = group.querySelectorAll("[data-code-file]");
  const panels = group.querySelectorAll("[data-code-panel]");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.getAttribute("data-code-file");
      buttons.forEach((candidate) => {
        const active = candidate.getAttribute("data-code-file") === selected;
        candidate.dataset.active = String(active);
        candidate.setAttribute("aria-selected", String(active));
      });
      panels.forEach((panel) => {
        panel.classList.toggle("hidden", panel.getAttribute("data-code-panel") !== selected);
      });
    });
  });
});
`.trim();

const LANGUAGE_LABELS = {
  '.json': 'JSON',
  '.jsonc': 'JSONC',
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.ts': 'TypeScript',
  '.csv': 'CSV',
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.html': 'HTML',
};

function languageLabel(filePath) {
  const extension = filePath.slice(filePath.lastIndexOf('.'));
  return LANGUAGE_LABELS[extension] ?? 'Text';
}

/**
 * Editor-style project browser: title bar, file tree, line-numbered code
 * panels, and a per-file status bar. The chrome stays dark in both themes,
 * matching the site's code blocks.
 *
 * @param {string} explorerId
 * @param {{
 *   title: string;
 *   githubUrl?: string;
 *   files: Array<{ path: string; content: string }>;
 *   compact?: boolean;
 * }} options
 */
export function CodeExplorer(explorerId, options) {
  const { title, githubUrl = '', files, compact = false } = options;
  if (files.length === 0) {
    return '';
  }
  const defaultFile = files[0].path;
  const editorHeight = compact ? 'min-h-[50vh] max-h-[75vh]' : 'max-h-[24rem]';

  const panels = files.map((file) => {
    const hidden = file.path === defaultFile ? '' : ' hidden';
    const lines = file.content.replace(/\n$/u, '').split('\n');
    const gutter = lines.map((_line, index) => index + 1).join('\n');
    const basename = file.path.split('/').pop();
    return `
      <div class="min-w-0${hidden}" data-code-panel="${escapeHtml(file.path)}" role="tabpanel">
        <div class="flex items-center border-b border-slate-800 bg-[#0b1120]">
          <span class="-mb-px inline-flex items-center gap-2 border-t-2 border-cyan-300 bg-[#020917] px-4 py-2 font-mono text-xs text-slate-200">${escapeHtml(basename)}</span>
        </div>
        <div class="${editorHeight} overflow-auto bg-[#020917]">
          <div class="flex min-w-fit">
            <pre class="sticky left-0 shrink-0 select-none border-r border-slate-800 bg-[#0b1120] px-3 py-3 text-right font-mono text-xs leading-6 text-slate-600">${gutter}</pre>
            <pre class="px-4 py-3 font-mono text-xs leading-6 text-slate-200"><code>${escapeHtml(file.content.replace(/\n$/u, ''))}</code></pre>
          </div>
        </div>
        <div class="flex items-center justify-between border-t border-slate-800 bg-[#0b1120] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-slate-500">
          <span class="truncate">${escapeHtml(file.path)}</span>
          <span class="shrink-0 pl-3">${escapeHtml(languageLabel(file.path))} · ${lines.length} lines</span>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="overflow-hidden rounded-xl border border-cyan-900/80 bg-[#0b1120] shadow-xl shadow-cyan-950/20 [.light_&]:border-slate-300" data-code-explorer="${escapeHtml(explorerId)}">
      <div class="flex items-center justify-between gap-3 border-b border-slate-800 bg-[#0b1120] px-4 py-2.5">
        <span class="truncate font-mono text-xs text-slate-400">${escapeHtml(title)}</span>
        ${githubUrl ? `<a class="shrink-0 font-mono text-xs font-semibold text-cyan-200 hover:text-cyan-100" href="${escapeHtml(githubUrl)}" rel="noopener">GitHub ↗</a>` : ''}
      </div>
      <div class="grid sm:grid-cols-[${compact ? '9rem' : '11rem'}_minmax(0,1fr)]">
        <nav class="border-b border-slate-800 bg-[#0b1120] py-2 sm:border-b-0 sm:border-r" aria-label="Example files">
          <p class="px-3 pb-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-600">Explorer</p>
          ${renderFileTree(files, defaultFile)}
        </nav>
        ${panels}
      </div>
    </div>
  `;
}

function renderFileTree(files, defaultFile) {
  const rows = [];
  const openFolders = [];

  for (const file of files) {
    const parts = file.path.split('/');
    const folders = parts.slice(0, -1);
    const basename = parts[parts.length - 1];

    let shared = 0;
    while (shared < folders.length && shared < openFolders.length && openFolders[shared] === folders[shared]) {
      shared += 1;
    }
    openFolders.length = shared;
    for (let depth = shared; depth < folders.length; depth += 1) {
      openFolders.push(folders[depth]);
      rows.push(`<p class="flex items-center gap-1 py-1 pr-2 font-mono text-xs text-slate-500" style="padding-left: ${0.75 + depth * 0.75}rem"><span aria-hidden="true">▾</span>${escapeHtml(folders[depth])}/</p>`);
    }

    const active = file.path === defaultFile;
    const indent = 0.75 + folders.length * 0.75;
    rows.push(`<button class="block w-full truncate py-1 pr-2 text-left font-mono text-xs text-slate-400 transition hover:bg-slate-800/60 hover:text-cyan-100 data-[active=true]:bg-cyan-300/10 data-[active=true]:text-cyan-100" style="padding-left: ${indent}rem" type="button" data-code-file="${escapeHtml(file.path)}" data-active="${String(active)}" aria-selected="${String(active)}">${escapeHtml(basename)}</button>`);
  }

  return rows.join('');
}

/**
 * Base HTML document: head, theme scripts, header, main, and footer.
 *
 * @param {{
 *   title: string;
 *   description: string;
 *   header: string;
 *   main: string;
 *   homePrefix: string;
 *   extraScript?: string;
 * }} page
 */
export function HtmlPage(page) {
  return `<!doctype html>
<html lang="en" class="overflow-x-hidden">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}">
    <script>${THEME_SCRIPT}</script>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <style>
      .docs-content h2 { margin-top: 2.5rem; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid rgb(8 47 73 / 0.8); font-size: 1.5rem; font-weight: 800; color: rgb(248 250 252); }
      .light .docs-content h2 { border-bottom-color: rgb(226 232 240); color: rgb(15 23 42); }
      .docs-content h3 { margin-top: 1.75rem; margin-bottom: 0.75rem; font-size: 1.125rem; font-weight: 700; color: rgb(226 232 240); }
      .light .docs-content h3 { color: rgb(30 41 59); }
      .docs-content p { margin-top: 0.75rem; }
      .docs-content pre { margin-top: 1rem; margin-bottom: 1rem; }
      .docs-content table { margin-top: 1rem; margin-bottom: 1rem; }
      details[data-open="true"] > summary ~ nav { display: block; }
    </style>
  </head>
  <body class="min-h-screen w-full max-w-full overflow-x-hidden bg-[#020917] text-slate-100 antialiased selection:bg-cyan-300 selection:text-slate-950 [.light_&]:bg-slate-50 [.light_&]:text-slate-950">
    ${page.header}
    <main>${page.main}</main>
    <footer class="border-t border-cyan-950/80 bg-[#020917] px-5 py-8 text-sm text-slate-400 sm:px-8 [.light_&]:border-slate-200 [.light_&]:bg-white [.light_&]:text-slate-600">
      <div class="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p>@async/db docs. Built with <a class="font-semibold text-cyan-200 hover:text-cyan-100 [.light_&]:text-cyan-800" href="https://github.com/async/db/blob/main/website/db.schema.js">content collections</a>.</p>
        <div class="flex flex-wrap gap-4">
          <a class="hover:text-cyan-200 [.light_&]:hover:text-cyan-800" href="${escapeHtml(page.homePrefix)}index.html">Home</a>
          <a class="hover:text-cyan-200 [.light_&]:hover:text-cyan-800" href="${escapeHtml(page.homePrefix)}docs/getting-started.html">Getting started</a>
        </div>
      </div>
    </footer>
    <script>${SITE_SCRIPT}${page.extraScript ? `\n${page.extraScript}` : ''}</script>
  </body>
</html>`;
}

/**
 * @param {{
 *   title: string;
 *   description: string;
 *   tierLabel: string;
 *   content: string;
 *   sidebar: string;
 *   toc: string;
 *   prevNext: string;
 *   editLink: string;
 *   header: string;
 *   homePrefix: string;
 *   extraScript?: string;
 * }} shell
 */
export function DocShell(shell) {
  return HtmlPage({
    title: shell.title,
    description: shell.description,
    header: shell.header,
    homePrefix: shell.homePrefix,
    extraScript: shell.extraScript,
    main: `
      <div class="mx-auto grid w-full max-w-7xl min-w-0 gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[16rem_minmax(0,1fr)_14rem]">
        ${shell.sidebar}
        <article class="min-w-0 max-w-3xl">
          <p class="mb-3 text-sm font-semibold uppercase tracking-wide text-cyan-300 [.light_&]:text-cyan-800">${escapeHtml(shell.tierLabel)}</p>
          <div class="docs-content space-y-4 text-base leading-7 text-slate-200 [.light_&]:text-slate-800">${shell.content}</div>
          ${shell.prevNext}
          ${shell.editLink}
        </article>
        ${shell.toc}
      </div>
    `,
  });
}
