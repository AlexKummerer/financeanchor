import type { Cents } from '../money.js';
import type { IsoDate } from '../month.js';
import type { ImportProfile } from '../schemas/entities.js';
import { detectDelimiter, parseAmount, parseCsv, parseDate } from './csv.js';

/**
 * Welche Spalte was bedeutet. Spalten werden über ihren Namen in der Kopfzeile angesprochen, damit
 * eine gespeicherte Zuordnung auch bei umsortierten Spalten passt. `invertSign`: Belastungen stehen
 * positiv in der Datei (z. B. Amex); `skip`: Zeilen mit diesen Werten in dieser Spalte überspringen
 * (z. B. vorgemerkte Umsätze).
 */
export type ImportMapping = ImportProfile['mapping'];

export interface StatementRow {
  /** Zeile in der Datei (1-basiert), für Hinweise */
  line: number;
  date: IsoDate;
  amountCents: Cents;
  counterparty: string;
  purpose: string;
}

export interface ParsedStatement {
  headers: string[];
  rows: StatementRow[];
  /** Zeilen, die nicht gelesen werden konnten (kein Datum oder Betrag) */
  skipped: { line: number; reason: 'no_date' | 'no_amount' | 'filtered' }[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');

/** Typische Spaltennamen deutscher Banken, wichtigste zuerst (normalisiert verglichen). */
const CANDIDATES = {
  date: [
    'buchungstag',
    'buchungsdatum',
    'buchung',
    'datum',
    'belegdatum',
    'transaktionsdatum',
    'date',
  ],
  amount: ['betrag', 'betrageur', 'umsatzineur', 'umsatz', 'betragineur', 'amount'],
  debit: ['soll', 'belastung', 'ausgang'],
  credit: ['haben', 'gutschrift', 'eingang'],
  counterparty: [
    'beguenstigterzahlungspflichtiger',
    'namezahlungsbeteiligter',
    'zahlungsempfaengerin',
    'zahlungspflichtiger',
    'auftraggeberempfaenger',
    'empfaenger',
    'auftraggeber',
    'haendler',
    'beschreibung',
    'description',
  ],
  purpose: ['verwendungszweck', 'buchungstext', 'vorgang', 'beschreibung', 'umsatztyp', 'details'],
} as const;

function findColumn(headers: string[], names: readonly string[], exclude: string[] = []) {
  const usable = headers.filter((h) => !exclude.includes(h));
  for (const match of [
    (h: string, name: string) => norm(h) === name,
    (h: string, name: string) => norm(h).startsWith(name),
  ]) {
    for (const name of names) {
      const hit = usable.find((h) => match(h, name));
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Zuordnung aus der Kopfzeile ableiten, soweit die Spaltennamen bekannt sind. */
export function guessMapping(headers: string[]): ImportMapping | null {
  const date = findColumn(headers, CANDIDATES.date);
  if (!date) return null;
  const amount = findColumn(headers, CANDIDATES.amount);
  const debit = findColumn(headers, CANDIDATES.debit);
  const credit = findColumn(headers, CANDIDATES.credit);
  const amounts = amount ? { amount } : debit && credit ? { debit, credit } : null;
  if (!amounts) return null;
  const counterparty = findColumn(headers, CANDIDATES.counterparty);
  const purpose = CANDIDATES.purpose
    .map((p) => findColumn([...headers], [p], counterparty ? [counterparty] : []))
    .filter((c, i, all): c is string => !!c && all.indexOf(c) === i);
  return {
    date,
    ...amounts,
    ...(counterparty ? { counterparty } : {}),
    purpose,
  };
}

/**
 * Kopfzeile suchen: erste Zeile, aus der sich Datum und Betrag zuordnen lassen und nach der
 * Datenzeilen folgen. Vorspann (Kontoname, IBAN, Zeitraum, Kontostand) wird so übersprungen.
 */
export function findHeader(table: string[][]): { index: number; mapping: ImportMapping } | null {
  for (const [index, row] of table.slice(0, 40).entries()) {
    const mapping = guessMapping(row);
    if (mapping) return { index, mapping };
  }
  return null;
}

/** Zeilen nach einer Zuordnung lesen. */
export function readRows(
  table: string[][],
  headerIndex: number,
  mapping: ImportMapping,
): ParsedStatement {
  const headers = table[headerIndex] ?? [];
  const col = (name: string | undefined) => (name ? headers.indexOf(name) : -1);
  const iDate = col(mapping.date);
  const iAmount = col(mapping.amount);
  const iDebit = col(mapping.debit);
  const iCredit = col(mapping.credit);
  const iCounter = col(mapping.counterparty);
  const iPurpose = (mapping.purpose ?? []).map(col).filter((i) => i >= 0);
  const iSkip = col(mapping.skip?.column);
  const skipValues = (mapping.skip?.values ?? []).map(norm);
  const rows: StatementRow[] = [];
  const skipped: ParsedStatement['skipped'] = [];

  for (const [offset, cells] of table.slice(headerIndex + 1).entries()) {
    const line = headerIndex + offset + 2;
    if (iSkip >= 0 && skipValues.includes(norm(cells[iSkip] ?? ''))) {
      skipped.push({ line, reason: 'filtered' });
      continue;
    }
    const date = parseDate(cells[iDate] ?? '');
    if (!date) {
      skipped.push({ line, reason: 'no_date' });
      continue;
    }
    let amount: number | null;
    if (iAmount >= 0) amount = parseAmount(cells[iAmount] ?? '');
    else {
      const debit = parseAmount(cells[iDebit] ?? '');
      const credit = parseAmount(cells[iCredit] ?? '');
      amount = debit || credit ? (credit ?? 0) - Math.abs(debit ?? 0) : null;
    }
    if (amount === null || amount === 0) {
      skipped.push({ line, reason: 'no_amount' });
      continue;
    }
    rows.push({
      line,
      date,
      amountCents: mapping.invertSign ? -amount : amount,
      counterparty: iCounter >= 0 ? (cells[iCounter] ?? '').replace(/\s+/g, ' ') : '',
      purpose: iPurpose
        .map((i) => cells[i] ?? '')
        .filter(Boolean)
        .join(' · ')
        .replace(/\s+/g, ' '),
    });
  }
  return { headers, rows, skipped };
}

/**
 * Eine Kontoauszugs-Datei lesen. Mit gespeichertem Profil wird dessen Zuordnung verwendet,
 * sonst die Kopfzeile erkannt. `null`, wenn keine Kopfzeile passt (dann selbst zuordnen).
 */
export function parseStatement(
  text: string,
  profile?: Pick<ImportProfile, 'delimiter' | 'mapping'> | null,
): (ParsedStatement & { profile: ImportProfile }) | null {
  const delimiter = profile?.delimiter ?? detectDelimiter(text);
  const table = parseCsv(text, delimiter);
  // Gespeicherte Zuordnung: Kopfzeile ist die erste Zeile mit ihren Spalten
  if (profile) {
    const needed = [profile.mapping.date, profile.mapping.amount ?? profile.mapping.debit].filter(
      (c): c is string => !!c,
    );
    const index = table.slice(0, 40).findIndex((row) => needed.every((c) => row.includes(c)));
    if (index >= 0) {
      return {
        ...readRows(table, index, profile.mapping),
        profile: { preset: 'saved', delimiter, mapping: profile.mapping },
      };
    }
  }
  const found = findHeader(table);
  if (!found) return null;
  return {
    ...readRows(table, found.index, found.mapping),
    profile: { preset: 'auto', delimiter, mapping: found.mapping },
  };
}

/** Vorschlag für den Buchungstext: Empfänger, sonst der Anfang des Verwendungszwecks. */
export function suggestName(row: Pick<StatementRow, 'counterparty' | 'purpose'>): string {
  const base = row.counterparty || row.purpose || 'Umsatz';
  return base.length > 60 ? `${base.slice(0, 57).trimEnd()}…` : base;
}
