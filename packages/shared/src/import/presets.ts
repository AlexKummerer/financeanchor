import type { ImportMapping } from './statement.js';

/**
 * Besonderheiten einzelner Banken, erkannt an ihrer Kopfzeile. Die Grundzuordnung (Datum, Betrag,
 * Text) kommt aus der allgemeinen Erkennung; ein Preset ergänzt nur, was sich daraus nicht ableiten
 * lässt. Quellen: Beispiel-Exporte und offene Importer (siehe docs/plan-csv-import.md).
 */
export interface BankPreset {
  id: string;
  label: string;
  matches: (headers: readonly string[]) => boolean;
  adjust: (mapping: ImportMapping) => ImportMapping;
}

const has = (headers: readonly string[], ...names: string[]) =>
  names.every((n) => headers.includes(n));

export const bankPresets: readonly BankPreset[] = [
  {
    // CSV-CAMT und CSV-MT940; vorgemerkte Umsätze stehen mit in der Datei
    id: 'sparkasse',
    label: 'Sparkasse',
    matches: (h) => has(h, 'Beguenstigter/Zahlungspflichtiger', 'Info'),
    adjust: (m) => ({
      ...m,
      textFormat: 'sepa',
      skip: { column: 'Info', values: ['Umsatz vorgemerkt'] },
    }),
  },
  {
    id: 'volksbank',
    label: 'Volksbank / Raiffeisenbank',
    matches: (h) => has(h, 'Name Zahlungsbeteiligter'),
    adjust: (m) => ({ ...m, textFormat: 'sepa' }),
  },
  {
    // Gegenpart je nach Richtung in einer anderen Spalte
    id: 'dkb',
    label: 'DKB',
    matches: (h) => has(h, 'Zahlungsempfänger*in', 'Zahlungspflichtige*r'),
    adjust: (m) => ({
      ...m,
      counterparty: 'Zahlungsempfänger*in',
      counterpartyCredit: 'Zahlungspflichtige*r',
      purpose: ['Verwendungszweck'],
      skip: { column: 'Status', values: ['Vorgemerkt'] },
    }),
  },
  {
    id: 'dkb-visa',
    label: 'DKB Visa',
    matches: (h) => has(h, 'Belegdatum', 'Beschreibung', 'Status'),
    adjust: (m) => ({
      ...m,
      date: 'Belegdatum',
      counterparty: 'Beschreibung',
      purpose: [],
      skip: { column: 'Status', values: ['Vorgemerkt'] },
    }),
  },
  {
    id: 'ing',
    label: 'ING',
    matches: (h) => has(h, 'Buchung', 'Auftraggeber/Empfänger'),
    adjust: (m) => m,
  },
  {
    // Empfänger und Zweck stecken gemeinsam im Buchungstext; „offen“ = vorgemerkt
    id: 'comdirect',
    label: 'Comdirect',
    matches: (h) => has(h, 'Buchungstag', 'Umsatz in EUR'),
    adjust: (m) => ({
      ...m,
      counterparty: 'Buchungstext',
      purpose: ['Buchungstext'],
      textFormat: 'comdirect',
    }),
  },
  {
    // Belastungen positiv, Zahlungen an die Karte negativ
    id: 'amex',
    label: 'American Express',
    matches: (h) => has(h, 'Karteninhaber', 'Konto #'),
    adjust: (m) => ({ ...m, counterparty: 'Beschreibung', purpose: [], invertSign: true }),
  },
];

export function detectPreset(headers: readonly string[]): BankPreset | null {
  return bankPresets.find((p) => p.matches(headers)) ?? null;
}

/** Kürzel in SEPA-Verwendungszwecken (MT940: `SVWZ+…`, Volksbank: `EREF: …`). */
const SEPA_TAGS = /\b(EREF|MREF|CRED|IBAN|BIC|ABWA|ABWE|KREF|SVWZ|PURP|DEBT|COAM|OAMT|SQTP)[+:]\s?/;

/** Verwendungszweck ohne SEPA-Kürzel: der Text nach `SVWZ+`, sonst alles vor dem ersten Kürzel. */
export function cleanSepaPurpose(text: string): string {
  const svwz = /SVWZ\+\s?(.*?)(?=\s?\b(?:ABWA|ABWE|EREF|MREF|CRED|KREF|IBAN|BIC)\+|$)/.exec(text);
  if (svwz?.[1]) return svwz[1].trim();
  const cut = text.search(SEPA_TAGS);
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
}

// Ohne Wortgrenze: im Export klebt „Kto/IBAN“ teils direkt am Namen
const COMDIRECT_MARKERS =
  /(Auftraggeber|Empfänger|Zahlungspflichtiger|Kto\/IBAN|BLZ\/BIC|Buchungstext|Ref\.)\s*:?/g;

/**
 * Comdirect-Buchungstext zerlegen: „Empfänger: REWE Kto/IBAN: … Buchungstext: Einkauf Ref. …“.
 * Ohne Markierungen (z. B. Visa-Abschnitt) ist der ganze Text der Gegenpart.
 */
export function splitComdirectText(text: string): { counterparty: string; purpose: string } {
  const parts = new Map<string, string>();
  const matches = [...text.matchAll(COMDIRECT_MARKERS)];
  if (!matches.length) return { counterparty: text.trim(), purpose: '' };
  matches.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = matches[i + 1]?.index ?? text.length;
    parts.set(m[1] ?? '', text.slice(start, end).trim());
  });
  // Text vor der ersten Markierung ist meist der Name selbst
  const prefix = text.slice(0, matches[0]?.index ?? 0).trim();
  return {
    counterparty:
      parts.get('Empfänger') ||
      parts.get('Auftraggeber') ||
      parts.get('Zahlungspflichtiger') ||
      prefix,
    purpose: parts.get('Buchungstext') ?? '',
  };
}
