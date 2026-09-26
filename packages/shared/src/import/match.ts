import type { Cents } from '../money.js';
import { daysBetween, type IsoDate } from '../month.js';
import type { StatementRow } from './statement.js';

/** FNV-1a (64 Bit) als Hex – kurzer, stabiler Fingerabdruck ohne Krypto-Abhängigkeit. */
function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoderLike().encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** UTF-8-Kodierung ohne `TextEncoder` (shared läuft ohne DOM-Typen). */
class TextEncoderLike {
  encode(s: string): number[] {
    const out: number[] = [];
    for (const ch of s) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 63),
          0x80 | ((cp >> 6) & 63),
          0x80 | (cp & 63),
        );
    }
    return out;
  }
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Fingerabdrücke der Zeilen einer Datei: Konto, Datum, Betrag und Text. Gleiche Zeilen in einer
 * Datei (zwei Kaffees am selben Tag) werden durchnummeriert, damit beide übernommen werden können,
 * derselbe Export beim zweiten Einlesen aber als bekannt erkannt wird.
 */
export function importKeys(
  scope: string,
  rows: readonly Pick<StatementRow, 'date' | 'amountCents' | 'counterparty' | 'purpose'>[],
): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${scope}|${r.date}|${r.amountCents}|${squash(r.counterparty)}|${squash(r.purpose)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `imp:${fnv1a64(n === 1 ? base : `${base}#${n}`)}`;
  });
}

export interface ExistingTransaction {
  id: string;
  date: IsoDate;
  amountCents: Cents;
  name: string;
  importKey: string | null;
}

/**
 * Vorhandene Buchung, die wahrscheinlich derselbe Umsatz ist: gleicher Betrag, höchstens drei Tage
 * auseinander, noch nicht mit einer anderen Zeile verknüpft. Die zeitlich nächste gewinnt.
 */
export function findLikelyMatch(
  row: Pick<StatementRow, 'date' | 'amountCents'>,
  existing: readonly ExistingTransaction[],
  taken: ReadonlySet<string> = new Set(),
): ExistingTransaction | null {
  let best: ExistingTransaction | null = null;
  let bestDiff = Infinity;
  for (const t of existing) {
    if (t.importKey || taken.has(t.id) || t.amountCents !== row.amountCents) continue;
    const diff = Math.abs(daysBetween(t.date, row.date));
    if (diff <= 3 && diff < bestDiff) {
      best = t;
      bestDiff = diff;
    }
  }
  return best;
}

/** Bekannte Kartenanbieter im Text einer Abbuchung auf dem Girokonto. */
const CARD_ISSUERS = [
  'american express',
  'amex',
  'kreditkarte',
  'kreditkartenabrechnung',
  'visa',
  'mastercard',
  'barclays',
  'hanseatic',
  'advanzia',
  'dkb visa',
  'santander',
];

/**
 * Sieht die Zeile nach der Abbuchung einer Kreditkarte aus? Dann ist sie keine Ausgabe – die Käufe
 * kommen über die Karte, die Abbuchung über „Fällige übernehmen“.
 */
export function looksLikeCardPayment(
  row: Pick<StatementRow, 'amountCents' | 'counterparty' | 'purpose'>,
  cardNames: readonly string[] = [],
): boolean {
  if (row.amountCents >= 0) return false;
  const text = squash(`${row.counterparty} ${row.purpose}`);
  return [...CARD_ISSUERS, ...cardNames.map(squash)].some((k) =>
    new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text),
  );
}

/**
 * Kategorie aus früheren Buchungen vorschlagen: gleicher Name, sonst ein früherer Name, der im
 * Text vorkommt (z. B. „REWE“ in „REWE 0887 OLCHING“). Längere Treffer gewinnen.
 */
export function suggestCategoryId(
  text: string,
  known: readonly { name: string; categoryId: string }[],
): string | null {
  const t = squash(text);
  if (!t) return null;
  const exact = known.find((k) => squash(k.name) === t);
  if (exact) return exact.categoryId;
  let best: { len: number; id: string } | null = null;
  for (const k of known) {
    const n = squash(k.name);
    if (n.length < 3) continue;
    const re = new RegExp(
      `(^|[^a-z0-9äöüß])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9äöüß]|$)`,
    );
    if (re.test(t) && (!best || n.length > best.len)) best = { len: n.length, id: k.categoryId };
  }
  return best?.id ?? null;
}

/**
 * Wiedererkennbares Merkmal eines Bank-Texts: ohne wechselnde Nummern und Referenzen, damit
 * „PAYPAL *DISNEYPLUS 800724235230“ jeden Monat gleich ist. Grundlage fürs Lernen von Name und
 * Kategorie beim Import. `null`, wenn nichts Aussagekräftiges übrig bleibt.
 */
export function importLabel(row: Pick<StatementRow, 'counterparty' | 'purpose'>): string | null {
  const source = row.counterparty.trim() || row.purpose.trim();
  const label = squash(
    source
      .split(/\s+/)
      .filter((token) => !/\d/.test(token))
      .join(' ')
      .replace(/[.,;:]+$/g, ''),
  );
  return label.length >= 3 ? label.slice(0, 100) : null;
}

/** Zahlung an die Karte auf der Kartenabrechnung (Gegenstück zur Abbuchung vom Girokonto). */
const CARD_SETTLEMENT = [
  'zahlung erhalten',
  'zahlung/überweisung erhalten',
  'überweisung erhalten',
  'lastschrift erhalten',
  'einzahlung',
  'ausgleich',
  'kartenabrechnung',
  'besten dank',
];

/**
 * Sieht die Zeile beim Import einer Kreditkarte nach der Zahlung an die Karte aus? Die ist schon
 * über „Fällige übernehmen“ als Abbuchung gebucht und darf nicht als Einnahme zählen.
 */
export function looksLikeCardSettlement(
  row: Pick<StatementRow, 'amountCents' | 'counterparty' | 'purpose'>,
): boolean {
  if (row.amountCents <= 0) return false;
  const text = squash(`${row.counterparty} ${row.purpose}`);
  return CARD_SETTLEMENT.some((k) => text.includes(k));
}
