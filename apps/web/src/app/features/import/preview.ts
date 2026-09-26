import {
  findLikelyMatch,
  importKeys,
  importLabel,
  looksLikeCardPayment,
  looksLikeCardSettlement,
  suggestCategoryId,
  suggestName,
  type ExistingTransaction,
  type StatementRow,
} from '@financeanchor/shared';

/**
 * Status einer eingelesenen Zeile:
 * - `new`: neu, kann übernommen werden
 * - `match`: passt zu einer vorhandenen Buchung (z. B. aus „Fällige übernehmen“) – beim Übernehmen
 *   wird nur verknüpft, nichts doppelt angelegt
 * - `card`: Abbuchung einer Kreditkarte auf dem Girokonto bzw. Zahlung an die Karte auf der
 *   Kartenabrechnung – keine Ausgabe/Einnahme, läuft über „Fällige übernehmen“
 * - `known`: schon früher übernommen
 */
export type RowStatus = 'new' | 'match' | 'card' | 'known';

export interface PreviewRow extends StatementRow {
  key: string;
  status: RowStatus;
  match: ExistingTransaction | null;
  selected: boolean;
  /** Wiedererkennbarer Bank-Text (zum Lernen) */
  label: string | null;
  /** Name und Kategorie kommen aus einem früheren Import mit gleichem Merkmal */
  learned: boolean;
  /** Bearbeitbar vor dem Übernehmen */
  name: string;
  category: string;
}

export interface PreviewInput {
  rows: readonly StatementRow[];
  /** Konto, zu dem die Datei gehört (für die Fingerabdrücke) */
  scope: string;
  /** Wird eine Kreditkarte eingelesen? Dann gibt es keine Kartenabbuchungen */
  isCard: boolean;
  cardNames: readonly string[];
  known: ReadonlySet<string>;
  existing: readonly ExistingTransaction[];
  suggestions: readonly { name: string; categoryId: string }[];
  /** Früher gewählter Name und Kategorie je Merkmal */
  learned: ReadonlyMap<string, { name: string; categoryId: string }>;
  categoryName: (id: string) => string;
}

/** Vorschau aufbauen: Status, Vorschlag für Name und Kategorie; nichts ist ausgewählt. */
export function buildPreview(input: PreviewInput): PreviewRow[] {
  const keys = importKeys(input.scope, input.rows);
  const taken = new Set<string>();
  return input.rows.map((row, i) => {
    const key = keys[i] ?? '';
    const name = suggestName(row);
    const match = input.known.has(key) ? null : findLikelyMatch(row, input.existing, taken);
    if (match) taken.add(match.id);
    const card = input.isCard
      ? looksLikeCardSettlement(row)
      : looksLikeCardPayment(row, input.cardNames);
    const status: RowStatus = input.known.has(key)
      ? 'known'
      : match
        ? 'match'
        : card
          ? 'card'
          : 'new';
    const label = importLabel(row);
    const learned = label ? input.learned.get(label) : undefined;
    const categoryId =
      learned?.categoryId ??
      suggestCategoryId(name, input.suggestions) ??
      suggestCategoryId(`${row.counterparty} ${row.purpose}`, input.suggestions);
    return {
      ...row,
      key,
      status,
      match,
      selected: false,
      label,
      learned: !!learned,
      name: learned?.name ?? name,
      category: categoryId ? input.categoryName(categoryId) : '',
    };
  });
}

/** Zeitraum der Datei (für die Suche nach vorhandenen Buchungen). */
export function dateRange(rows: readonly StatementRow[]): { from: string; to: string } | null {
  if (!rows.length) return null;
  const dates = rows.map((r) => r.date).sort();
  return { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' };
}
