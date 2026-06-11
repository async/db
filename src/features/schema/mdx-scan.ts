// Dependency-free MDX scan for Tier 3 docs support.
//
// This is intentionally not an MDX parser. It answers one contract question --
// "which capitalized JSX components does this document use, and which names
// does it import/export?" -- so schemas can validate component usage at sync
// without Async DB ever importing a compiler. The body stays a raw string and
// rendering stays app-owned.
//
// Scan rules (aligned with MDX semantics):
// - Fenced code blocks (``` or ~~~) are skipped entirely.
// - Inline code spans (`...`, including multi-backtick spans) are skipped.
// - HTML comments (<!-- -->) and MDX expression comments ({/* */}) are skipped.
// - Indented lines are NOT treated as code: MDX disables indented code blocks.
// - A capitalized tag like <Callout> or <Tabs.Item> counts as a component use,
//   including inside attribute expressions ({items.map((x) => <Chip />)}).
// - Text inside a tag's quoted attribute values is consumed with the tag, so
//   <Note title="<Fake>"> does not report Fake.
// - import/export statements at column zero (MDX ESM) are inventoried; names
//   they introduce are treated as locally supplied components.

export type MdxImportRecord = {
  specifier: string;
  names: string[];
};

export type MdxScan = {
  /** Unique sorted capitalized JSX tag names as written (for example Tabs.Item). */
  components: string[];
  /** Unique sorted module specifiers from MDX ESM import statements. */
  imports: string[];
  /** Unique sorted top-level names exported by the document. */
  exports: string[];
  /** Identifiers introduced by MDX ESM (import locals plus exported names). */
  localNames: string[];
};

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/u;
const COMPONENT_NAME_PATTERN = /^[A-Z][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*/u;
const IMPORT_SPECIFIER_PATTERN = /\bfrom\s*['"]([^'"]+)['"]|^import\s+['"]([^'"]+)['"]/u;
const IMPORT_DEFAULT_PATTERN = /^import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|from\b)/u;
const IMPORT_NAMESPACE_PATTERN = /\*\s*as\s+([A-Za-z_$][A-Za-z0-9_$]*)/u;
const EXPORT_DECLARATION_PATTERN = /^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/u;

export function scanMdxBody(body: string): MdxScan {
  const text = String(body ?? '');
  const lines = text.split(/\r?\n/u);
  const proseLines: string[] = [];
  const esmStatements: string[] = [];

  let fenceMarker: string | null = null;
  let esmBuffer: string[] = [];

  const flushEsm = () => {
    if (esmBuffer.length > 0) {
      esmStatements.push(esmBuffer.join('\n'));
      esmBuffer = [];
    }
  };

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_PATTERN);
    if (fenceMarker) {
      if (fenceMatch && fenceMatch[1][0] === fenceMarker[0] && fenceMatch[1].length >= fenceMarker.length && line.trim() === fenceMatch[1].trim()) {
        fenceMarker = null;
      }
      continue;
    }
    if (fenceMatch) {
      flushEsm();
      fenceMarker = fenceMatch[1];
      continue;
    }

    if (esmBuffer.length > 0) {
      if (line.trim() === '') {
        flushEsm();
        continue;
      }
      esmBuffer.push(line);
      if (esmStatementLooksComplete(esmBuffer.join('\n'))) {
        flushEsm();
      }
      continue;
    }

    if (/^(?:import|export)\s/u.test(line)) {
      esmBuffer = [line];
      if (esmStatementLooksComplete(line)) {
        flushEsm();
      }
      continue;
    }

    proseLines.push(stripInlineCodeSpans(line));
  }
  flushEsm();

  const components = new Set<string>();
  const imports = new Set<string>();
  const exports = new Set<string>();
  const localNames = new Set<string>();

  for (const statement of esmStatements) {
    collectEsmStatement(statement, { imports, exports, localNames });
    // MDX allows JSX inside export declarations (export const banner = <Warn />).
    collectComponentTags(stripComments(statement), components);
  }

  collectComponentTags(stripComments(proseLines.join('\n')), components);

  return {
    components: [...components].sort(),
    imports: [...imports].sort(),
    exports: [...exports].sort(),
    localNames: [...localNames].sort(),
  };
}

/** Tabs.Item -> Tabs; Callout -> Callout. */
export function componentRoot(name: string): string {
  const dot = name.indexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

/**
 * Components used by the document that are neither allowed by the schema's
 * components list nor supplied by the document's own import/export names.
 * Matching accepts either the full written name or its root (allowing 'Tabs'
 * permits <Tabs.Item />).
 */
export function disallowedComponents(scan: MdxScan, allowed: readonly string[]): string[] {
  const allowSet = new Set<string>([...allowed.map(String), ...scan.localNames]);
  return scan.components.filter((name) => !allowSet.has(name) && !allowSet.has(componentRoot(name)));
}

function esmStatementLooksComplete(statement: string): boolean {
  if (IMPORT_SPECIFIER_PATTERN.test(statement)) {
    return true;
  }
  if (statement.trimEnd().endsWith(';')) {
    return true;
  }
  // export const x = ... assignments are single-statement in docs usage; treat
  // a balanced line as complete and let blank lines end anything longer.
  return /^export\s/u.test(statement) && balancedBrackets(statement);
}

function balancedBrackets(text: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (const char of text) {
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{' || char === '(' || char === '[') {
      depth += 1;
    } else if (char === '}' || char === ')' || char === ']') {
      depth -= 1;
    }
  }
  return depth <= 0 && quote === null;
}

function collectEsmStatement(
  statement: string,
  buckets: { imports: Set<string>; exports: Set<string>; localNames: Set<string> },
): void {
  const flat = statement.replace(/\s+/gu, ' ').trim();

  if (flat.startsWith('import')) {
    const specifierMatch = flat.match(IMPORT_SPECIFIER_PATTERN);
    if (specifierMatch) {
      buckets.imports.add(specifierMatch[1] ?? specifierMatch[2]);
    }
    const defaultMatch = flat.match(IMPORT_DEFAULT_PATTERN);
    if (defaultMatch) {
      buckets.localNames.add(defaultMatch[1]);
    }
    const namespaceMatch = flat.match(IMPORT_NAMESPACE_PATTERN);
    if (namespaceMatch) {
      buckets.localNames.add(namespaceMatch[1]);
    }
    for (const name of namedBindingLocals(flat)) {
      buckets.localNames.add(name);
    }
    return;
  }

  const declarationMatch = flat.match(EXPORT_DECLARATION_PATTERN);
  if (declarationMatch) {
    buckets.exports.add(declarationMatch[1]);
    buckets.localNames.add(declarationMatch[1]);
    return;
  }

  if (/^export\s*\{/u.test(flat)) {
    for (const name of namedBindingLocals(flat)) {
      buckets.exports.add(name);
      buckets.localNames.add(name);
    }
  }
}

function namedBindingLocals(flat: string): string[] {
  const braceMatch = flat.match(/\{([^}]*)\}/u);
  if (!braceMatch) {
    return [];
  }
  const names: string[] = [];
  for (const entry of braceMatch[1].split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const asMatch = trimmed.match(/\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)$/u);
    const name = asMatch ? asMatch[1] : trimmed.split(/\s/u)[0];
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)) {
      names.push(name);
    }
  }
  return names;
}

function stripInlineCodeSpans(line: string): string {
  let result = '';
  let index = 0;
  while (index < line.length) {
    if (line[index] !== '`') {
      result += line[index];
      index += 1;
      continue;
    }
    let runLength = 1;
    while (line[index + runLength] === '`') {
      runLength += 1;
    }
    const closer = findBacktickRun(line, index + runLength, runLength);
    if (closer === -1) {
      // No matching closer: literal backticks, keep scanning after the run.
      result += line.slice(index, index + runLength);
      index += runLength;
      continue;
    }
    index = closer + runLength;
  }
  return result;
}

function findBacktickRun(line: string, from: number, length: number): number {
  let index = from;
  while (index < line.length) {
    if (line[index] !== '`') {
      index += 1;
      continue;
    }
    let runLength = 1;
    while (line[index + runLength] === '`') {
      runLength += 1;
    }
    if (runLength === length) {
      return index;
    }
    index += runLength;
  }
  return -1;
}

function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/gu, ' ');
}

function collectComponentTags(text: string, components: Set<string>): void {
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) {
      return;
    }
    const nameMatch = text.slice(open + 1).match(COMPONENT_NAME_PATTERN);
    if (!nameMatch) {
      index = open + 1;
      continue;
    }
    const after = text[open + 1 + nameMatch[0].length];
    if (after !== undefined && !/[\s/>]/u.test(after)) {
      index = open + 1;
      continue;
    }
    components.add(nameMatch[0]);
    index = consumeTag(text, open + 1 + nameMatch[0].length, components);
  }
}

/**
 * Consume a JSX tag from just after its name to the closing '>', honoring
 * quoted attribute values and nested {expression} braces so literal tags in
 * attribute strings are not reported. Components used inside attribute
 * expressions (icon={<Star />}) are still recorded. Returns the index after
 * the tag.
 */
function consumeTag(text: string, from: number, components: Set<string>): number {
  let index = from;
  let quote: string | null = null;
  let braceDepth = 0;
  while (index < text.length) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (char === '<' && braceDepth > 0) {
      // JSX inside an attribute expression, e.g. icon={<Star />}.
      const nested = text.slice(index + 1).match(COMPONENT_NAME_PATTERN);
      if (nested) {
        const after = text[index + 1 + nested[0].length];
        if (after === undefined || /[\s/>]/u.test(after)) {
          components.add(nested[0]);
        }
      }
    } else if (char === '>' && braceDepth === 0) {
      return index + 1;
    }
    index += 1;
  }
  return index;
}
