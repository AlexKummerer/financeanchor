import type { Cents } from '../money.js';
import { daysBetween, type IsoDate } from '../month.js';
import { amountTolerance, namesSimilar } from '../import/reconcile.js';

interface OpenDue {
  key: string;
  name: string;
  date: IsoDate;
  amountCents: Cents;
}

interface ManualTransaction {
  id: string;
  name: string;
  date: IsoDate;
  amountCents: Cents;
}

/**
 * Vorschläge für „Schon von Hand gebucht?“ je offener Fälligkeit (jede Buchung höchstens einmal):
 * 1. gleicher Betrag bis 3 Tage Abstand, Name egal
 * 2. eine Buchung für mehrere Fälligkeiten mit ähnlichem Namen, wenn ihr Betrag deren Summe ist
 *    (z. B. 72 € für 30 € und 42 €) – dieselbe Buchung steht dann bei allen, sie wird aufgeteilt
 * 3. ähnlicher Name: eine Buchung (auch mit anderem Betrag) oder mehrere, deren Summe passt
 *    (z. B. 2 × 36 € für 72 €); sonst die mit dem nächsten Betrag
 */
export function suggestDueLinks<T extends ManualTransaction>(
  open: readonly OpenDue[],
  manual: readonly T[],
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  const used = new Set<string>();
  const free = (e: OpenDue) =>
    manual.filter((t) => !used.has(t.id) && Math.sign(t.amountCents) === Math.sign(e.amountCents));
  const take = (key: string, txs: T[]) => {
    for (const t of txs) used.add(t.id);
    result.set(key, txs);
  };

  for (const e of open) {
    const exact = free(e)
      .filter((t) => t.amountCents === e.amountCents && Math.abs(daysBetween(t.date, e.date)) <= 3)
      .sort(
        (a, b) => Math.abs(daysBetween(a.date, e.date)) - Math.abs(daysBetween(b.date, e.date)),
      )[0];
    if (exact) take(e.key, [exact]);
  }
  for (const t of manual) {
    if (used.has(t.id)) continue;
    const covered = open.filter(
      (e) =>
        !result.has(e.key) &&
        Math.sign(e.amountCents) === Math.sign(t.amountCents) &&
        namesSimilar(t.name, e.name),
    );
    const sum = covered.reduce((s, e) => s + e.amountCents, 0);
    if (covered.length > 1 && Math.abs(sum - t.amountCents) <= amountTolerance(t.amountCents)) {
      for (const e of covered) take(e.key, [t]);
    }
  }
  for (const e of open) {
    if (result.has(e.key)) continue;
    const similar = free(e).filter((t) => namesSimilar(t.name, e.name));
    if (!similar.length) continue;
    const sum = similar.reduce((s, t) => s + t.amountCents, 0);
    if (similar.length > 1 && Math.abs(sum - e.amountCents) <= amountTolerance(e.amountCents)) {
      take(
        e.key,
        [...similar].sort((a, b) => a.date.localeCompare(b.date)),
      );
      continue;
    }
    const nearest = [...similar].sort(
      (a, b) => Math.abs(a.amountCents - e.amountCents) - Math.abs(b.amountCents - e.amountCents),
    )[0];
    if (nearest) take(e.key, [nearest]);
  }
  return result;
}
