import { dbError } from './errors.js';

export function parseCsvRecords(text, filePath = 'CSV file') {
  const rows = parseCsvRows(text);
  const headerRow = rows.shift();

  if (!headerRow || headerRow.every((cell) => cell.value.trim() === '')) {
    throw dbError(
      'CSV_MISSING_HEADER',
      `${filePath} must start with a header row.`,
      {
        status: 400,
        hint: 'Add a first row with column names, for example: id,name,email.',
      },
    );
  }

  const headers = headerRow.map((cell, index) => ({
    rawName: cell.value.trim(),
    fieldName: fieldNameFromHeader(cell.value, index),
  }));
  const fieldNames = uniqueFieldNames(headers.map((header) => header.fieldName));

  return rows
    .filter((row) => row.some((cell) => cell.value.trim() !== ''))
    .map((row) => {
      const record = {};
      for (const [index, header] of headers.entries()) {
        const value = coerceCsvValue(row[index] ?? { value: '', quoted: false }, header.rawName);
        if (value !== undefined) {
          record[fieldNames[index]] = value;
        }
      }
      return record;
    });
}

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      wasQuoted = true;
      continue;
    }

    if (char === ',') {
      pushField();
      continue;
    }

    if (char === '\n') {
      pushField();
      pushRow();
      continue;
    }

    if (char === '\r') {
      if (text[index + 1] === '\n') {
        index += 1;
      }
      pushField();
      pushRow();
      continue;
    }

    field += char;
  }

  if (quoted) {
    throw dbError(
      'CSV_UNTERMINATED_QUOTE',
      'CSV file has an unterminated quoted field.',
      {
        status: 400,
        hint: 'Close the quoted field with another double quote, or escape embedded quotes as "".',
      },
    );
  }

  pushField();
  pushRow();

  return rows;

  function pushField() {
    row.push({
      value: wasQuoted ? field : field.trim(),
      quoted: wasQuoted,
    });
    field = '';
    wasQuoted = false;
  }

  function pushRow() {
    if (row.length > 1 || row[0]?.value !== '') {
      rows.push(row);
    }
    row = [];
  }
}

function fieldNameFromHeader(header, index) {
  const trimmed = String(header).trim();
  if (/^[a-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
    return trimmed;
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
    return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  }

  const words = trimmed.match(/[A-Za-z0-9]+/g) ?? [];
  const name = words.map((word, wordIndex) => {
    const lower = word.toLowerCase();
    return wordIndex === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('');

  if (!name) {
    return `column${index + 1}`;
  }

  return /^\d/.test(name) ? `_${name}` : name;
}

function uniqueFieldNames(names) {
  const counts = new Map();
  return names.map((name) => {
    const count = counts.get(name) ?? 0;
    counts.set(name, count + 1);
    return count === 0 ? name : `${name}${count + 1}`;
  });
}

function coerceCsvValue(cell, headerName) {
  const value = cell.quoted ? cell.value : cell.value.trim();
  if (value === '') {
    return undefined;
  }

  if (cell.quoted || isStringLikeHeader(headerName)) {
    return value;
  }

  const lower = value.toLowerCase();
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }
  if (lower === 'null') {
    return undefined;
  }

  if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

function isStringLikeHeader(headerName) {
  return /\b(id|uuid|guid|zip|postal|phone|tel|code)\b/i.test(String(headerName).replaceAll(/[^A-Za-z0-9]+/g, ' '));
}
