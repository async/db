export function parseJsonc<TValue = unknown>(text: string, filename = 'JSONC input'): TValue {
  try {
    return JSON.parse(stripJsonc(text));
  } catch (error) {
    error.message = `${filename}: ${error.message}`;
    throw error;
  }
}

export function stripJsonc(text: string): string {
  const withoutBom = text.replace(/^\uFEFF/, '');
  return stripTrailingCommas(stripComments(withoutBom));
}

function stripComments(text: string): string {
  let output = '';
  let inString = false;
  let quote = '';
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inString) {
      output += char;

      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === quote) {
        inString = false;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
      output += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        output += text[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function stripTrailingCommas(text: string): string {
  let output = '';
  let inString = false;
  let quote = '';
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      output += char;

      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === quote) {
        inString = false;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === ',') {
      let cursor = index + 1;
      while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor += 1;
      }

      if (text[cursor] === '}' || text[cursor] === ']') {
        continue;
      }
    }

    output += char;
  }

  return output;
}
