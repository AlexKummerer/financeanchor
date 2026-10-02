import { amountTolerance, namesSimilar } from '../import/reconcile.js';
import type { Cents } from '../money.js';
import { addMonths, monthOfDate, type IsoDate, type YearMonth } from '../month.js';

/** Tatsächlich gebuchter Betrag eines Postens in einem Monat (Summe aller Teile, mit Vorzeichen) */
export interface BookedItemAmount {
  itemId: string;
  month: YearMonth;
  amountCents: Cents;
}

export interface TemplateSuggestion {
  itemId: string;
  /** Neuer Betrag der Vorlage (positiv) */
  amountCents: Cents;
}

/**
 * Vorlage anpassen: Die letzten beiden gebuchten Monate eines Postens haben denselben Betrag, der
 * aber von der Vorlage abweicht (z. B. Strom zweimal 94,80 € statt 90 €).
 */
export function templateSuggestions(
  items: readonly { id: string; amountCents: Cents }[],
  booked: readonly BookedItemAmount[],
): TemplateSuggestion[] {
  const out: TemplateSuggestion[] = [];
  for (const item of items) {
    const [last, before] = booked
      .filter((b) => b.itemId === item.id)
      .sort((a, b) => b.month.localeCompare(a.month));
    if (!last || !before) continue;
    const amount = Math.abs(last.amountCents);
    if (amount === Math.abs(before.amountCents) && amount !== item.amountCents && amount > 0) {
      out.push({ itemId: item.id, amountCents: amount });
    }
  }
  return out;
}

/** Eigene Buchung ohne Fälligkeit (Kandidat für ein Abo) */
export interface OwnTransaction {
  date: IsoDate;
  name: string;
  amountCents: Cents;
  categoryId: string;
  accountId: string | null;
  /** Merkmal des Bank-Texts beim CSV-Import */
  importLabel: string | null;
}

export interface SubscriptionCandidate {
  /** Merkmal zum Wiedererkennen (auch zum Ausblenden) */
  key: string;
  name: string;
  amountCents: Cents;
  dueDay: number;
  categoryId: string;
  accountId: string | null;
  months: number;
}

const groupKey = (t: OwnTransaction) =>
  t.importLabel ?? t.name.toLowerCase().replace(/\d+/g, '').replace(/\s+/g, ' ').trim();

/**
 * Abos erkennen: dieselbe Ausgabe (Bank-Text bzw. Name) in mindestens zwei der letzten drei Monate
 * mit ähnlichem Betrag, für die es noch keinen Posten mit ähnlichem Namen gibt.
 */
export function subscriptionCandidates(
  transactions: readonly OwnTransaction[],
  items: readonly { name: string }[],
  today: IsoDate,
): SubscriptionCandidate[] {
  const current = monthOfDate(today);
  const recent = new Set([current, addMonths(current, -1), addMonths(current, -2)]);
  const groups = new Map<string, OwnTransaction[]>();
  for (const t of transactions) {
    if (t.amountCents >= 0 || !recent.has(monthOfDate(t.date))) continue;
    const key = groupKey(t);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: SubscriptionCandidate[] = [];
  for (const [key, txs] of groups) {
    const latest = [...txs].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latest) continue;
    const months = new Set(txs.map((t) => monthOfDate(t.date))).size;
    const similar = txs.every(
      (t) => Math.abs(t.amountCents - latest.amountCents) <= amountTolerance(latest.amountCents),
    );
    if (months < 2 || !similar) continue;
    if (items.some((i) => namesSimilar(i.name, latest.name) || namesSimilar(i.name, key))) continue;
    out.push({
      key,
      name: latest.name,
      amountCents: -latest.amountCents,
      dueDay: Number(latest.date.slice(8)),
      categoryId: latest.categoryId,
      accountId: latest.accountId,
      months,
    });
  }
  return out.sort((a, b) => b.amountCents - a.amountCents);
}
