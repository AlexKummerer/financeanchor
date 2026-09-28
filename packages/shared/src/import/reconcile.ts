import type { Cents } from '../money.js';
import { daysBetween, type IsoDate } from '../month.js';
import type { SourceType } from '../schemas/common.js';
import type { StatementRow } from './statement.js';

/** Vorhandene Buchung, mit der eine Zeile der Bank verknüpft werden kann. */
export interface ReconcileTransaction {
  id: string;
  date: IsoDate;
  amountCents: Cents;
  name: string;
  /** Herkunft aus „Fällige übernehmen“ (Fixkosten, Kreditrate …) */
  sourceType: SourceType | null;
  sourceId: string | null;
  /** Schon mit einer Zeile der Bank verknüpft */
  linked: boolean;
}

export interface ReconcileRow extends Pick<
  StatementRow,
  'date' | 'amountCents' | 'counterparty' | 'purpose'
> {
  key: string;
  label: string | null;
}

/**
 * - `sure`: gleicher Betrag bis 3 Tage Abstand oder gelernte Herkunft
 * - `likely`: Betrag oder Datum weichen ab (Fälligkeit mit gleichem Betrag bis 10 Tage, ähnlicher
 *   Name mit etwas anderem Betrag) – bitte prüfen
 */
export type MatchCertainty = 'sure' | 'likely';

export interface RowMatch {
  transactionId: string;
  certainty: MatchCertainty;
  /** Mehrere Zeilen gehören zusammen zu dieser Buchung (z. B. 5 × 10 € = 50 €) */
  group: boolean;
}

/** Erlaubte Abweichung beim Betrag: 5 %, mindestens 2 €. */
export function amountTolerance(cents: Cents): Cents {
  return Math.max(200, Math.round(Math.abs(cents) * 0.05));
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-zäöüß0-9]+/)
      .filter((t) => t.length >= 3 && !/^\d+$/.test(t)),
  );

/** Haben Bank-Text und Name der Buchung ein Wort gemeinsam? */
export function namesSimilar(a: string, b: string): boolean {
  const ta = tokens(a);
  for (const t of tokens(b)) if (ta.has(t)) return true;
  return false;
}

const days = (a: IsoDate, b: IsoDate) => Math.abs(daysBetween(a, b));
const sameSign = (a: number, b: number) => Math.sign(a) === Math.sign(b);

/**
 * Zeilen der Bank mit vorhandenen Buchungen abgleichen. Reihenfolge:
 * 1. gelernte Herkunft (dieser Bank-Text war schon einmal z. B. „Rate OLB“, bis 15 Tage) oder
 *    gleicher Betrag bis 3 Tage – sicher; gleicher Betrag einer Fälligkeit bis 10 Tage – möglich
 * 2. mehrere Zeilen mit gleichem Bank-Text, deren Summe zu einer Buchung passt
 * 3. möglich: Betrag bis 5 % (mind. 2 €) daneben, bis 7 Tage, Name ähnlich
 * Jede Buchung wird höchstens einmal vergeben (bei Gruppen an alle Zeilen der Gruppe).
 */
export function reconcile(
  rows: readonly ReconcileRow[],
  existing: readonly ReconcileTransaction[],
  learnedSources: ReadonlyMap<string, { sourceType: SourceType; sourceId: string }> = new Map(),
): Map<string, RowMatch> {
  const result = new Map<string, RowMatch>();
  const taken = new Set<string>();
  const open = (t: ReconcileTransaction) => !t.linked && !taken.has(t.id);

  // 1. Sicher
  for (const row of rows) {
    const learned = row.label ? learnedSources.get(row.label) : undefined;
    let best: { t: ReconcileTransaction; rank: number; diff: number } | null = null;
    for (const t of existing) {
      if (!open(t) || !sameSign(t.amountCents, row.amountCents)) continue;
      const d = days(t.date, row.date);
      const exact = t.amountCents === row.amountCents;
      let rank = 0;
      if (
        learned &&
        t.sourceType === learned.sourceType &&
        t.sourceId === learned.sourceId &&
        d <= 15 &&
        Math.abs(t.amountCents - row.amountCents) <= amountTolerance(t.amountCents)
      ) {
        rank = 3;
      } else if (exact && d <= 3) rank = 2;
      else if (exact && t.sourceType && d <= 10) rank = 1;
      if (rank && (!best || rank > best.rank || (rank === best.rank && d < best.diff))) {
        best = { t, rank, diff: d };
      }
    }
    if (best) {
      taken.add(best.t.id);
      result.set(row.key, {
        transactionId: best.t.id,
        certainty: best.rank > 1 ? 'sure' : 'likely',
        group: false,
      });
    }
  }

  // 2. Mehrere Zeilen gleichen Texts ergeben zusammen eine Buchung
  const groups = new Map<string, ReconcileRow[]>();
  for (const row of rows) {
    if (result.has(row.key) || !row.label) continue;
    const id = `${row.label}|${Math.sign(row.amountCents)}`;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const t of existing) {
      if (!open(t)) continue;
      const near = group.filter(
        (r) => sameSign(t.amountCents, r.amountCents) && days(t.date, r.date) <= 15,
      );
      if (near.length < 2) continue;
      const sum = near.reduce((s, r) => s + r.amountCents, 0);
      const diff = Math.abs(sum - t.amountCents);
      if (diff > amountTolerance(t.amountCents)) continue;
      taken.add(t.id);
      for (const r of near) {
        result.set(r.key, {
          transactionId: t.id,
          certainty: diff === 0 ? 'sure' : 'likely',
          group: true,
        });
      }
      break;
    }
  }

  // 3. Möglich: kleine Abweichung, ähnlicher Name
  for (const row of rows) {
    if (result.has(row.key)) continue;
    const text = `${row.counterparty} ${row.purpose}`;
    let best: { t: ReconcileTransaction; score: number } | null = null;
    for (const t of existing) {
      if (!open(t) || !sameSign(t.amountCents, row.amountCents)) continue;
      const d = days(t.date, row.date);
      const diff = Math.abs(t.amountCents - row.amountCents);
      if (d > 7 || diff > amountTolerance(t.amountCents) || !namesSimilar(text, t.name)) continue;
      const score = diff + d * 50;
      if (!best || score < best.score) best = { t, score };
    }
    if (best) {
      taken.add(best.t.id);
      result.set(row.key, { transactionId: best.t.id, certainty: 'likely', group: false });
    }
  }
  return result;
}

/**
 * Gegenprobe: Buchungen im Zeitraum der Datei, zu denen keine Zeile der Bank passt – meist doppelt
 * erfasst, vertippt oder (noch) nicht von der Bank gebucht.
 */
export function unmatchedTransactions(
  existing: readonly ReconcileTransaction[],
  matches: ReadonlyMap<string, RowMatch>,
  range: { from: IsoDate; to: IsoDate },
): ReconcileTransaction[] {
  const used = new Set([...matches.values()].map((m) => m.transactionId));
  return existing.filter(
    (t) => !t.linked && !used.has(t.id) && t.date >= range.from && t.date <= range.to,
  );
}
