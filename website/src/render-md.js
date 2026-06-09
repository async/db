import { Callout } from './components.js';
import { rewriteMarkdownLink } from './link-map.js';

/**
 * @param {string} markdown
 * @param {{ strictLinks?: boolean }} [options]
 */
export function renderMarkdown(markdown, options = {}) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const block = readFencedCodeBlock(lines, index);
      html.push(renderCodeBlock(block.language, block.content));
      index = block.nextIndex;
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      html.push(renderHeading(line));
      index += 1;
      continue;
    }

    if (/^(-{3,}|_{3,}|\*{3,})\s*$/.test(line.trim())) {
      html.push('<hr>');
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const block = readBlockquote(lines, index);
      if (block.type === 'admonition') {
        html.push(Callout(block.variant, renderInlineBlock(block.content, options)));
      } else {
        html.push(`<blockquote class="my-4 border-l-4 border-cyan-700/60 pl-4 text-slate-300 [.light_&]:border-slate-300 [.light_&]:text-slate-700">${renderInlineBlock(block.content, options)}</blockquote>`);
      }
      index = block.nextIndex;
      continue;
    }

    if (isTableStart(lines, index)) {
      const block = readTable(lines, index);
      html.push(renderTable(block.rows, options));
      index = block.nextIndex;
      continue;
    }

    if (/^(\s*[-*+] |\s*\d+\. )/.test(line)) {
      const block = readList(lines, index);
      html.push(renderList(block.items, block.ordered, options));
      index = block.nextIndex;
      continue;
    }

    const block = readParagraph(lines, index);
    html.push(`<p>${renderInline(block.content, options)}</p>`);
    index = block.nextIndex;
  }

  return html.join('\n');
}

/**
 * @param {string} markdown
 */
export function extractHeadings(markdown) {
  const headings = [];
  for (const line of String(markdown ?? '').split('\n')) {
    const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/u);
    if (!match) {
      continue;
    }
    const level = match[1].length;
    const text = match[2].trim();
    headings.push({
      level,
      text: text.replaceAll('`', ''),
      id: slugify(text),
    });
  }
  return headings;
}

/**
 * @param {string} markdown
 */
export function extractTitle(markdown) {
  const match = String(markdown ?? '').match(/^#\s+(.+)$/m);
  return match?.[1]?.trim().replaceAll('`', '') ?? '';
}

function readFencedCodeBlock(lines, startIndex) {
  const opening = lines[startIndex].match(/^```(.*)$/u);
  const language = opening?.[1]?.trim() ?? '';
  const content = [];
  let index = startIndex + 1;
  while (index < lines.length && !/^```\s*$/.test(lines[index])) {
    content.push(lines[index]);
    index += 1;
  }
  return {
    language,
    content: content.join('\n'),
    nextIndex: index + 1,
  };
}

function readBlockquote(lines, startIndex) {
  const contentLines = [];
  let index = startIndex;
  while (index < lines.length && /^>\s?/.test(lines[index])) {
    contentLines.push(lines[index].replace(/^>\s?/, ''));
    index += 1;
  }
  const content = contentLines.join('\n');
  const admonitionMatch = content.match(/^\[!([A-Z]+)\]\s*\n?([\s\S]*)$/u);
  if (admonitionMatch) {
    const variant = admonitionMatch[1].toLowerCase() === 'warning' ? 'warning' : 'note';
    return {
      type: 'admonition',
      variant,
      content: admonitionMatch[2].trim(),
      nextIndex: index,
    };
  }
  return { type: 'blockquote', content, nextIndex: index };
}

function readParagraph(lines, startIndex) {
  const content = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      break;
    }
    if (/^```/.test(line) || /^#{1,6}\s/.test(line) || /^>\s?/.test(line) || isTableStart(lines, index) || /^(\s*[-*+] |\s*\d+\. )/.test(line)) {
      break;
    }
    content.push(line);
    index += 1;
  }
  return { content: content.join('\n'), nextIndex: index };
}

function readList(lines, startIndex) {
  const first = lines[startIndex];
  const ordered = /^\s*\d+\.\s/.test(first);
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const itemMatch = ordered
      ? line.match(/^(\s*)\d+\.\s+(.*)$/)
      : line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (!itemMatch) {
      break;
    }
    const indent = itemMatch[1].length;
    if (items.length > 0 && indent > 0) {
      items[items.length - 1].content += `\n${line.trimStart()}`;
      index += 1;
      continue;
    }
    items.push({ content: itemMatch[2], children: [] });
    index += 1;
  }

  return { items, ordered, nextIndex: index };
}

function isTableStart(lines, index) {
  return index + 1 < lines.length && /^\|.+\|$/.test(lines[index]) && /^\|[-:\s|]+\|$/.test(lines[index + 1]);
}

function readTable(lines, startIndex) {
  const rows = [];
  let index = startIndex;
  while (index < lines.length && /^\|.+\|$/.test(lines[index])) {
    if (!/^\|[-:\s|]+\|$/.test(lines[index])) {
      rows.push(parseTableRow(lines[index]));
    }
    index += 1;
  }
  return { rows, nextIndex: index };
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((cell) => cell.trim());
}

function renderHeading(line) {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
  if (!match) {
    return `<p>${escapeHtml(line)}</p>`;
  }
  const level = match[1].length;
  const text = match[2].trim();
  const id = slugify(text);
  const rendered = escapeHtml(text).replace(/`([^`]+)`/g, '<code class="font-mono">$1</code>');
  return `<h${level} id="${escapeHtml(id)}">${rendered}</h${level}>`;
}

function renderCodeBlock(language, content) {
  const langClass = language ? ` class="language-${escapeHtml(language)}"` : '';
  const label = language
    ? `<div class="mb-2 font-mono text-xs font-bold uppercase tracking-wide text-cyan-200 [.light_&]:text-cyan-800">${escapeHtml(language)}</div>`
    : '';
  return [
    `<pre class="max-w-full overflow-x-auto rounded-md border border-cyan-900/80 bg-slate-950 p-4 text-xs leading-6 text-slate-200 [.light_&]:border-slate-200 [.light_&]:bg-slate-950 [.light_&]:text-slate-100">`,
    label,
    `<code${langClass}>${escapeHtml(content)}</code>`,
    '</pre>',
  ].join('\n');
}

function renderTable(rows, options) {
  if (rows.length === 0) {
    return '';
  }
  const [head, ...body] = rows;
  const thead = `<thead><tr>${head.map((cell) => `<th class="border border-cyan-900/80 px-3 py-2 text-left [.light_&]:border-slate-200">${renderInline(cell, options)}</th>`).join('')}</tr></thead>`;
  const tbody = body.length
    ? `<tbody>${body.map((row) => `<tr>${row.map((cell) => `<td class="border border-cyan-900/80 px-3 py-2 align-top [.light_&]:border-slate-200">${renderInline(cell, options)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';
  return `<div class="my-6 overflow-x-auto"><table class="min-w-full border-collapse text-sm">${thead}${tbody}</table></div>`;
}

function renderList(items, ordered, options, depth = 0) {
  const tag = ordered ? 'ol' : 'ul';
  const listClass = ordered ? 'list-decimal' : 'list-disc';
  const body = items.map((item) => {
    const nestedMatch = item.content.match(/\n(\s*[-*+] .+|\s*\d+\. .+)/u);
    if (nestedMatch) {
      const [firstLine, ...rest] = item.content.split('\n');
      const nestedItems = rest.map((line) => ({ content: line.replace(/^\s*[-*+\d.]+\s*/, ''), children: [] }));
      return `<li class="ml-5">${renderInline(firstLine, options)}${renderList(nestedItems, /^\s*\d+\./.test(rest[0] ?? ''), options, depth + 1)}</li>`;
    }
    return `<li class="ml-5">${renderInline(item.content, options)}</li>`;
  }).join('');
  return `<${tag} class="${listClass} my-4 space-y-2 pl-5">${body}</${tag}>`;
}

function renderInlineBlock(text, options) {
  return text
    .split(/\n{2,}/u)
    .map((block) => `<p>${renderInline(block.replace(/\n/g, ' '), options)}</p>`)
    .join('');
}

function renderInline(text, options) {
  let output = escapeHtml(text);
  output = output.replace(/`([^`\n]+)`/g, (_match, code) => `<code class="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-sm text-cyan-100 [.light_&]:bg-slate-100 [.light_&]:text-cyan-900">${escapeHtml(code)}</code>`);
  output = output.replace(/\*\*([^*]+)\*\*/g, (_match, value) => `<strong>${value}</strong>`);
  output = output.replace(/\*([^*]+)\*/g, (_match, value) => `<em>${value}</em>`);
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    const rewritten = rewriteMarkdownLink(href, {
      strict: options.strictLinks,
      linkContext: options.linkContext,
    });
    return `<a class="font-semibold text-cyan-200 underline decoration-cyan-400/40 underline-offset-4 hover:text-cyan-100 [.light_&]:text-cyan-800 [.light_&]:hover:text-cyan-950" href="${escapeHtml(rewritten)}">${label}</a>`;
  });
  return output;
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/gu, '')
    .replace(/\s+/gu, '-');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export { slugify, escapeHtml };
