// A small RFC 4180 CSV parser and header helpers. Hand rolled so the pipeline
// has one fewer dependency. Handles quoted fields, doubled quotes inside
// quotes, CRLF, and newlines inside quoted fields (parseCsv only).

// Parse one physical line that holds one record (no newlines inside quotes).
// Used for streaming the QCEW file line by line.
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(field);
      field = '';
    } else if (c === '\r') {
      // ignore a stray carriage return
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

// Parse a whole CSV text into rows. Empty trailing line is dropped.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // CRLF: the \n that follows ends the row
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Lowercase, strip everything that is not a letter or digit, so that
// "CBSA Code", "cbsa_code" and "CBSACODE" all compare equal.
export function normalizeHeader(name: string): string {
  return name
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Find a column by any of several candidate names. Throws an error that
// names the file, what was wanted, and the actual header row, so the first
// real run tells exactly which column moved.
export function findColumn(header: string[], candidates: string[], file: string, what: string): number {
  const normalized = header.map(normalizeHeader);
  for (const cand of candidates) {
    const i = normalized.indexOf(normalizeHeader(cand));
    if (i >= 0) return i;
  }
  throw new Error(
    `${file}: could not find the ${what} column. Tried ${candidates.map((c) => `"${c}"`).join(', ')}. ` +
      `Header row is: ${header.map((h) => `"${h}"`).join(', ')}`,
  );
}

// Like findColumn but returns -1 instead of throwing.
export function findColumnOrNull(header: string[], candidates: string[]): number {
  const normalized = header.map(normalizeHeader);
  for (const cand of candidates) {
    const i = normalized.indexOf(normalizeHeader(cand));
    if (i >= 0) return i;
  }
  return -1;
}

// Parse a number that may carry thousands separators, quotes, or a
// placeholder such as ".", "(D)", "(NA)", "N/A", "" -> null.
export function parseNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = raw.trim().replace(/,/g, '');
  if (s === '' || s === '.' || s.startsWith('(') || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Left pad a numeric code to a fixed width, e.g. 1001 -> "01001".
export function padCode(raw: string | number, width: number): string {
  const s = String(raw).trim();
  return s.padStart(width, '0');
}
