import type { Cents } from '../money.js';
import { monthOfDate, type YearMonth } from '../month.js';
import type { Transaction } from '../schemas/entities.js';

export type TransactionLike = Pick<Transaction, 'date' | 'amountCents' | 'categoryId'>;

export interface MonthTotals {
  incomeCents: Cents;
  expenseCents: Cents;
  balanceCents: Cents;
}

/** Einnahmen, Ausgaben (positiv) und Saldo der Buchungen eines Monats. */
export function monthTotals(
  transactions: readonly TransactionLike[],
  month: YearMonth,
): MonthTotals {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const t of transactions) {
    if (monthOfDate(t.date) !== month) continue;
    if (t.amountCents > 0) incomeCents += t.amountCents;
    else expenseCents -= t.amountCents;
  }
  return { incomeCents, expenseCents, balanceCents: incomeCents - expenseCents };
}

/** Ausgaben eines Monats je Kategorie, absteigend sortiert. */
export function spendingByCategory(
  transactions: readonly TransactionLike[],
  month: YearMonth,
): { categoryId: string; amountCents: Cents }[] {
  const sums = new Map<string, number>();
  for (const t of transactions) {
    if (t.amountCents >= 0 || monthOfDate(t.date) !== month) continue;
    sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) - t.amountCents);
  }
  return [...sums]
    .map(([categoryId, amountCents]) => ({ categoryId, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
}
