import type { Cents } from '../money.js';
import { addMonths, monthIndex, type YearMonth } from '../month.js';
import type { RecurringItem } from '../schemas/entities.js';

export type RecurringLike = Pick<
  RecurringItem,
  'id' | 'amountCents' | 'intervalMonths' | 'startMonth' | 'kind'
>;

/**
 * Monatsumlage × 12 als ganze Zahl. Rhythmen (1, 2, 3, 6, 12) teilen 12, daher lassen sich
 * Umlagen so exakt summieren und erst am Ende in Cent umrechnen.
 */
export function monthlyShareTimes12(item: Pick<RecurringLike, 'amountCents' | 'intervalMonths'>) {
  return item.amountCents * (12 / item.intervalMonths);
}

/** Monatsumlage in Cent, kaufmännisch gerundet – nur für die Anzeige einzelner Posten. */
export function monthlyShare(item: Pick<RecurringLike, 'amountCents' | 'intervalMonths'>): Cents {
  return Math.round(item.amountCents / item.intervalMonths);
}

/** Fällig, wenn der Startmonat erreicht ist und (Monat − Startmonat) durch den Rhythmus teilbar ist. */
export function isDue(
  item: Pick<RecurringLike, 'intervalMonths' | 'startMonth'>,
  month: YearMonth,
) {
  const diff = monthIndex(month) - monthIndex(item.startMonth);
  return diff >= 0 && diff % item.intervalMonths === 0;
}

export function hasStarted(item: Pick<RecurringLike, 'startMonth'>, month: YearMonth) {
  return monthIndex(month) >= monthIndex(item.startMonth);
}

/** Ausgehende Posten (Fixkosten und Sparen) mit Rhythmus > 1 Monat laufen über die Rücklage, Einnahmen nie. */
export function viaReserve(item: Pick<RecurringLike, 'kind' | 'intervalMonths'>) {
  return item.kind !== 'income' && item.intervalMonths > 1;
}

/** Nächster Fälligkeitsmonat ab `from` (einschließlich). */
export function nextDueMonth(
  item: Pick<RecurringLike, 'intervalMonths' | 'startMonth'>,
  from: YearMonth,
): YearMonth {
  const diff = monthIndex(from) - monthIndex(item.startMonth);
  if (diff <= 0) return item.startMonth;
  const rest = diff % item.intervalMonths;
  return rest === 0 ? from : addMonths(from, item.intervalMonths - rest);
}
