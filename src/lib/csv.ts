/** RFC 4180 CSV generation. */

export type CsvValue = string | number | boolean | Date | null | undefined;

export function csvEscape(value: CsvValue): string {
  if (value == null) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  // Neutralise spreadsheet formula injection for user-entered text.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
  // Leading BOM so Excel opens UTF-8 (₹, Indian names) correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export class CsvParseError extends Error {
  constructor(message: string, public line: number) {
    super(message);
    this.name = "CsvParseError";
  }
}

/**
 * RFC 4180 parser: quoted fields, escaped quotes (""), commas and line breaks inside
 * quotes, CRLF or LF line endings, and a leading UTF-8 BOM. Returns the rows with the
 * physical line number each row starts on. Completely empty lines are skipped.
 */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  let line = 1;
  let rowLine = 1;
  const endField = () => {
    cells.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (!(cells.length === 1 && cells[0] === "")) rows.push({ line: rowLine, cells });
    cells = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted && field === "") {
      quoted = true;
      fieldStarted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (quoted) throw new CsvParseError(`A quoted value that starts on line ${rowLine} is never closed.`, rowLine);
  if (field !== "" || cells.length > 0) endRow();
  return rows;
}

/** Undoes the formula-injection guard added by csvEscape ('=..., '+..., '-..., '@...). */
export function unguard(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}
