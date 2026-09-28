import {
  daysBetween,
  importKeys,
  importLabel,
  looksLikeCardPayment,
  looksLikeCardSettlement,
  reconcile,
  suggestCategoryId,
  suggestName,
  unmatchedTransactions,
  type MatchCertainty,
  type ReconcileTransaction,
  type RowMatch,
  type SourceType,
  type StatementRow,
  type TransactionKind,
} from '@financeanchor/shared';

/**
 * Status einer eingelesenen Zeile:
 * - `new`: neu, kann übernommen werden
 * - `match`: gehört zu einer vorhandenen Buchung (z. B. aus „Fällige übernehmen“) – beim Übernehmen
 *   wird nur verknüpft, nichts doppelt angelegt
 * - `card`: Abbuchung einer Kreditkarte auf dem Girokonto bzw. Zahlung an die Karte auf der
 *   Kartenabrechnung – keine Ausgabe/Einnahme, läuft über „Fällige übernehmen“
 * - `known`: schon früher übernommen
 */
export type RowStatus = 'new' | 'match' | 'card' | 'known';

/** Vorhandene Buchung im Zeitraum der Datei (vom Server). */
export interface ImportExisting extends ReconcileTransaction {
  kind: TransactionKind;
  accountId: string | null;
}

export interface PreviewRow extends StatementRow {
  key: string;
  status: RowStatus;
  /** Status beim Einlesen – bestimmt die Ansicht, auch wenn man die Verknüpfung ändert */
  bucket: RowStatus;
  match: ImportExisting | null;
  /** `manual`: von Hand verknüpft */
  certainty: MatchCertainty | 'manual' | null;
  /** Teil einer Gruppe mehrerer Zeilen zu einer Buchung */
  group: boolean;
  /** Zustand ohne Verknüpfung (für „Nicht dieselbe“) */
  unlinkedStatus: 'new' | 'card';
  selected: boolean;
  /** Wiedererkennbarer Bank-Text (zum Lernen) */
  label: string | null;
  /** Name und Kategorie kommen aus einem früheren Import mit gleichem Merkmal */
  learned: boolean;
  /** Bearbeitbar vor dem Übernehmen */
  name: string;
  category: string;
}

export interface LearnedLabel {
  label: string;
  name: string;
  categoryId: string;
  sourceType: SourceType | null;
  sourceId: string | null;
}

export interface PreviewInput {
  rows: readonly StatementRow[];
  /** Konto, zu dem die Datei gehört (für die Fingerabdrücke) */
  scope: string;
  /** Wird eine Kreditkarte eingelesen? Dann gibt es keine Kartenabbuchungen */
  isCard: boolean;
  cardNames: readonly string[];
  known: ReadonlySet<string>;
  existing: readonly ImportExisting[];
  suggestions: readonly { name: string; categoryId: string }[];
  /** Früher gewählter Name, Kategorie und Herkunft je Merkmal */
  learned: readonly LearnedLabel[];
  categoryName: (id: string) => string;
}

/** Vorschau aufbauen: Status, Abgleich, Vorschlag für Name und Kategorie; nichts ist ausgewählt. */
export function buildPreview(input: PreviewInput): PreviewRow[] {
  const keys = importKeys(input.scope, input.rows);
  const learnedByLabel = new Map(input.learned.map((l) => [l.label, l]));
  const learnedSources = new Map<string, { sourceType: SourceType; sourceId: string }>();
  for (const l of input.learned) {
    if (l.sourceType && l.sourceId) {
      learnedSources.set(l.label, { sourceType: l.sourceType, sourceId: l.sourceId });
    }
  }
  const rows = input.rows.map((row, i) => ({
    ...row,
    key: keys[i] ?? '',
    label: importLabel(row),
  }));
  const matches = reconcile(
    rows.filter((r) => !input.known.has(r.key)),
    input.existing,
    learnedSources,
  );
  const byId = new Map(input.existing.map((t) => [t.id, t]));

  return rows.map((row) => {
    const name = suggestName(row);
    const found = matches.get(row.key);
    const match = found ? (byId.get(found.transactionId) ?? null) : null;
    const card = input.isCard
      ? looksLikeCardSettlement(row)
      : looksLikeCardPayment(row, input.cardNames);
    const unlinkedStatus = card ? 'card' : 'new';
    const status: RowStatus = input.known.has(row.key) ? 'known' : match ? 'match' : unlinkedStatus;
    const learned = row.label ? learnedByLabel.get(row.label) : undefined;
    const categoryId =
      learned?.categoryId ??
      suggestCategoryId(name, input.suggestions) ??
      suggestCategoryId(`${row.counterparty} ${row.purpose}`, input.suggestions);
    return {
      ...row,
      status,
      bucket: status,
      match,
      certainty: match && found ? found.certainty : null,
      group: !!(match && found?.group),
      unlinkedStatus,
      selected: false,
      learned: !!learned,
      name: learned?.name ?? name,
      category: categoryId ? input.categoryName(categoryId) : '',
    };
  });
}

/** Zeile von Hand mit einer Buchung verknüpfen (oder mit `null` lösen). */
export function linkRow(row: PreviewRow, t: ImportExisting | null): PreviewRow {
  return t
    ? { ...row, status: 'match', match: t, certainty: 'manual', group: false }
    : { ...row, status: row.unlinkedStatus, match: null, certainty: null, group: false };
}

/** Buchungen, die zu einer Zeile passen könnten: gleiches Vorzeichen, bis 20 Tage, nächste zuerst. */
export function linkCandidates(
  row: Pick<StatementRow, 'date' | 'amountCents'>,
  existing: readonly ImportExisting[],
): ImportExisting[] {
  return existing
    .filter(
      (t) =>
        Math.sign(t.amountCents) === Math.sign(row.amountCents) &&
        Math.abs(daysBetween(t.date, row.date)) <= 20,
    )
    .sort(
      (a, b) =>
        Math.abs(daysBetween(a.date, row.date)) - Math.abs(daysBetween(b.date, row.date)) ||
        Math.abs(a.amountCents - row.amountCents) - Math.abs(b.amountCents - row.amountCents),
    );
}

/** Summe und Anzahl der Zeilen je verknüpfter Buchung (für Gruppen und Betrag angleichen). */
export function linkedTotals(
  rows: readonly PreviewRow[],
): Map<string, { count: number; sumCents: number; lastKey: string }> {
  const totals = new Map<string, { count: number; sumCents: number; lastKey: string }>();
  for (const r of rows) {
    if (r.status !== 'match' || !r.match) continue;
    const prev = totals.get(r.match.id) ?? { count: 0, sumCents: 0, lastKey: r.key };
    totals.set(r.match.id, {
      count: prev.count + 1,
      sumCents: prev.sumCents + r.amountCents,
      lastKey: r.key,
    });
  }
  return totals;
}

/**
 * Gegenprobe: Buchungen der App im Zeitraum der Datei ohne passende Zeile – beim Kartenimport die
 * Käufe mit dieser Karte, sonst Buchungen ohne Karte, die über ein Konto laufen.
 */
export function withoutRow(
  rows: readonly PreviewRow[],
  existing: readonly ImportExisting[],
  account: { id: string; isCard: boolean } | null,
  range: { from: string; to: string },
): ImportExisting[] {
  const relevant = existing.filter((t) =>
    account?.isCard
      ? t.accountId === account.id && t.kind === 'normal'
      : !t.accountId && ['normal', 'loan_payment', 'card_payment'].includes(t.kind),
  );
  const matches = new Map<string, RowMatch>();
  for (const r of rows) {
    if (r.status === 'match' && r.match) {
      matches.set(r.key, { transactionId: r.match.id, certainty: 'sure', group: r.group });
    }
  }
  return unmatchedTransactions(relevant, matches, range) as ImportExisting[];
}

/** Zeitraum der Datei (für die Suche nach vorhandenen Buchungen). */
export function dateRange(rows: readonly StatementRow[]): { from: string; to: string } | null {
  if (!rows.length) return null;
  const dates = rows.map((r) => r.date).sort();
  return { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' };
}
