import type { Cents } from '../money.js';
import type { IsoDate } from '../month.js';
import type { ImportProfile } from '../schemas/entities.js';
import { detectDelimiter, parseAmount, parseCsv, parseDate } from './csv.js';
import { cleanSepaPurpose, detectPreset, splitComdirectText } from './presets.js';

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
    // Präfix nur bei kurzen Namen („Betrag (€)“), nicht bei Sätzen wie „Datei erstellt am“
    (h: string, name: string) => norm(h).startsWith(name) && norm(h).length <= name.length + 6,
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
  // Kopfzeilen enthalten keine Daten: kein Datum, kein Betrag, nur kurze Namen
  if (
    headers.some(
      (h) =>
        h.length > 60 ||
        parseDate(h) !== null ||
        parseAmount(h) !== null ||
        /\d{2}\.\d{2}\./.test(h),
    )
  ) {
    return null;
  }
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

const squashSpaces = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Titelzeile eines Abschnitts (Comdirect: „Umsätze Girokonto“, „Umsätze Visa-Karte“ …). */
function isSectionTitle(cells: readonly string[]): boolean {
  return /^Ums(ä|ae)tze\b/.test(cells[0] ?? '');
}

/** Zeilen nach einer Zuordnung lesen (bis zum nächsten Abschnitt). */
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
  const iCounterCredit = col(mapping.counterpartyCredit);
  const iPurpose = (mapping.purpose ?? []).map(col).filter((i) => i >= 0);
  const iSkip = col(mapping.skip?.column);
  const skipValues = (mapping.skip?.values ?? []).map(norm);
  const rows: StatementRow[] = [];
  const skipped: ParsedStatement['skipped'] = [];

  for (const [offset, cells] of table.slice(headerIndex + 1).entries()) {
    const line = headerIndex + offset + 2;
    // Nächster Abschnitt (Comdirect: „Umsätze Visa-Karte“) oder neue Kopfzeile: hier endet es
    if (isSectionTitle(cells) || guessMapping(cells)) break;
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
    const amountCents = mapping.invertSign ? -amount : amount;
    const counterCol = amountCents > 0 && iCounterCredit >= 0 ? iCounterCredit : iCounter;
    let counterparty = counterCol >= 0 ? squashSpaces(cells[counterCol] ?? '') : '';
    let purpose = squashSpaces(
      iPurpose
        .map((i) => cells[i] ?? '')
        .filter(Boolean)
        .join(' · '),
    );
    if (mapping.textFormat === 'comdirect') {
      ({ counterparty, purpose } = splitComdirectText(counterparty));
    } else if (mapping.textFormat === 'sepa') {
      purpose = cleanSepaPurpose(purpose);
    }
    rows.push({ line, date, amountCents, counterparty, purpose });
  }
  return { headers, rows, skipped };
}

export interface StatementSection extends ParsedStatement {
  /** Abschnittstitel, wenn die Datei mehrere enthält (Comdirect), sonst `null` */
  title: string | null;
  profile: ImportProfile;
  /** Spalten mit Datumsangaben (z. B. Buchungs- und Umsatztag) – zur Auswahl beim Import */
  dateColumns: string[];
}

/** Spalten, deren Werte in den ersten Datenzeilen überwiegend Datumsangaben sind. */
function dateColumnsOf(table: string[][], headerIndex: number): string[] {
  const headers = table[headerIndex] ?? [];
  const sample = table.slice(headerIndex + 1, headerIndex + 21);
  return headers.filter((h, i) => {
    if (!h) return false;
    const values = sample.map((r) => r[i] ?? '').filter((v) => v.trim());
    const dates = values.filter((v) => parseDate(v) !== null).length;
    return values.length > 0 && dates / values.length >= 0.8;
  });
}

/**
 * Eine Kontoauszugs-Datei lesen – alle Abschnitte mit ihren Zeilen. Mit gespeichertem Profil wird
 * dessen Zuordnung verwendet, sonst Kopfzeile und Bank erkannt. Leer, wenn keine Kopfzeile passt
 * (dann Spalten selbst zuordnen).
 */
export function parseStatementSections(
  text: string,
  profile?: Pick<ImportProfile, 'delimiter' | 'mapping' | 'preset'> | null,
): StatementSection[] {
  const delimiter = profile?.delimiter ?? detectDelimiter(text);
  const table = parseCsv(text, delimiter);
  const sections: StatementSection[] = [];
  let title: string | null = null;
  for (const [index, row] of table.entries()) {
    if (isSectionTitle(row)) {
      title = row[0] ?? null;
      continue;
    }
    const own =
      profile &&
      [profile.mapping.date, profile.mapping.amount ?? profile.mapping.debit].every(
        (c) => !!c && row.includes(c),
      );
    const guessed = own ? null : guessMapping(row);
    if (!own && !guessed) continue;
    let result: ImportProfile;
    if (own && profile) result = { preset: profile.preset, delimiter, mapping: profile.mapping };
    else {
      const preset = detectPreset(row);
      const base = guessed as ImportMapping;
      result = {
        preset: preset?.id ?? 'auto',
        delimiter,
        mapping: preset ? preset.adjust(base) : base,
      };
    }
    sections.push({
      title,
      ...readRows(table, index, result.mapping),
      profile: result,
      dateColumns: dateColumnsOf(table, index),
    });
  }
  return sections;
}

/** Erster Abschnitt mit Umsätzen (die meisten Banken haben nur einen). */
export function parseStatement(
  text: string,
  profile?: Pick<ImportProfile, 'delimiter' | 'mapping' | 'preset'> | null,
): StatementSection | null {
  const sections = parseStatementSections(text, profile);
  return sections.find((s) => s.rows.length > 0) ?? sections[0] ?? null;
}

/** Vorschlag für den Buchungstext: Empfänger, sonst der Anfang des Verwendungszwecks. */
export function suggestName(row: Pick<StatementRow, 'counterparty' | 'purpose'>): string {
  const base = row.counterparty || row.purpose || 'Umsatz';
  return base.length > 60 ? `${base.slice(0, 57).trimEnd()}…` : base;
}
