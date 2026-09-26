import {
  findLikelyMatch,
  importKeys,
  looksLikeCardPayment,
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
 * - `card`: Abbuchung einer Kreditkarte auf dem Girokonto – keine Ausgabe
 * - `known`: schon früher übernommen
 */
export type RowStatus = 'new' | 'match' | 'card' | 'known';

export interface PreviewRow extends StatementRow {
  key: string;
  status: RowStatus;
  match: ExistingTransaction | null;
  selected: boolean;
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
    const status: RowStatus = input.known.has(key)
      ? 'known'
      : match
        ? 'match'
        : !input.isCard && looksLikeCardPayment(row, input.cardNames)
          ? 'card'
          : 'new';
    const categoryId =
      suggestCategoryId(name, input.suggestions) ??
      suggestCategoryId(`${row.counterparty} ${row.purpose}`, input.suggestions);
    return {
      ...row,
      key,
      status,
      match,
      selected: false,
      name,
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
