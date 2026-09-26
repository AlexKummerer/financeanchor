import type { Cents } from '../money.js';
import type { IsoDate } from '../month.js';

export type Delimiter = ';' | ',' | '\t';

/**
 * Zerlegt CSV-Text in Zeilen und Felder (RFC 4180): Felder in Anführungszeichen dürfen Trennzeichen,
 * Zeilenumbrüche und verdoppelte Anführungszeichen enthalten. Leere Zeilen entfallen.
 */
export function parseCsv(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

/** Trennzeichen raten: das, das in den ersten Zeilen am häufigsten gleich oft vorkommt. */
export function detectDelimiter(text: string): Delimiter {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 30);
  let best: Delimiter = ';';
  let bestScore = -1;
  for (const d of [';', ',', '\t'] as const) {
    const counts = lines.map((l) => parseCsv(l, d)[0]?.length ?? 0);
    // Häufigste Feldanzahl > 1 und wie viele Zeilen sie haben
    const freq = new Map<number, number>();
    for (const c of counts) if (c > 1) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [cols, n] = [...freq].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0];
    const score = n * 100 + cols;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * Betrag in Cent aus deutschem oder englischem Format: „-1.234,56“, „1234,56 €“, „-45.50“,
 * „(12,00)“. `null`, wenn es kein Betrag ist.
 */
export function parseAmount(raw: string): Cents | null {
  let s = raw.replace(/\s|€|EUR/gi, '').replace(/−/g, '-');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;
  if (lastComma > lastDot) normalized = s.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma >= 0) normalized = s.replace(/,/g, '');
  else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, '');
  else normalized = s;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return negative ? -cents : cents;
}

/** Datum aus „31.12.2026“, „31.12.26“, „31/12/2026“ oder „2026-12-31“. */
export function parseDate(raw: string): IsoDate | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const [, day = '', month = '', yearText = ''] = m;
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  return valid(year, Number(month), Number(day));
}

function valid(y: number, mo: number, d: number): IsoDate | null {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
