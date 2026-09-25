import type { Cents } from '../money.js';
import { monthOfDate, type YearMonth } from '../month.js';
import type { Transaction } from '../schemas/entities.js';
import { allocateMonth, type PlanLoan } from './loans.js';
import { hasStarted, monthlyShareTimes12, viaReserve } from './recurring.js';
import {
  reserveMonthlyAmount,
  reserveNeed,
  type ReserveItemLike,
  type ReservePotLike,
} from './reserve.js';

export interface MonthlyBreakdown {
  incomeCents: Cents;
  fixedCents: Cents;
  reserveCents: Cents;
  /** Kreditzahlungen des Monats (Raten, Fristen, Zurücklegen, eigene Extra-Tilgung) */
  loanCents: Cents;
  savingCents: Cents;
  /** Einnahmen minus alles andere; kann negativ sein */
  freeCents: Cents;
}

export interface BreakdownInput {
  items: readonly ReserveItemLike[];
  pots: readonly ReservePotLike[];
  loans: readonly PlanLoan[];
  month: YearMonth;
  /** Kreditzahlungen vorgeben statt sie aus `loans` zu berechnen (z. B. gebucht plus noch offen) */
  loanCents?: Cents;
}

/**
 * Wohin fließt ein Monat: feste Einnahmen aufgeteilt in Fixkosten, Rücklage, Kreditraten, Sparen, frei.
 *
 * Monatliche Posten zählen ab ihrem Startmonat. Posten über die Rücklage stecken im Rücklagenbetrag
 * (für sie wird schon vor der ersten Fälligkeit angespart). Kredite zählen mit der Aufteilung des Monats.
 */
export function monthlyBreakdown(input: BreakdownInput): MonthlyBreakdown {
  let income12 = 0;
  let fixed12 = 0;
  let saving12 = 0;
  for (const item of input.items) {
    if (viaReserve(item) || !hasStarted(item, input.month)) continue;
    const v = monthlyShareTimes12(item);
    if (item.kind === 'income') income12 += v;
    else if (item.kind === 'saving') saving12 += v;
    else fixed12 += v;
  }
  const defaultPot = input.pots.find((p) => p.isDefault);
  const reserveCents = input.pots.reduce(
    (sum, pot) =>
      sum + reserveMonthlyAmount(pot, reserveNeed(input.items, pot.id, defaultPot?.id ?? pot.id)),
    0,
  );
  const loanCents = input.loanCents ?? allocateMonth(input.loans, input.month).paidCents;
  const incomeCents = Math.round(income12 / 12);
  const fixedCents = Math.round(fixed12 / 12);
  const savingCents = Math.round(saving12 / 12);
  return {
    incomeCents,
    fixedCents,
    reserveCents,
    loanCents,
    savingCents,
    freeCents: incomeCents - fixedCents - reserveCents - loanCents - savingCents,
  };
}

export interface BookedBreakdown {
  /** Alle Einnahmen des Monats (feste und sonstige) */
  incomeCents: Cents;
  fixedCents: Cents;
  /** Überweisungen in die Rücklage; Posten über die Rücklage und ihre Entnahme heben sich auf */
  reserveCents: Cents;
  loanCents: Cents;
  savingCents: Cents;
  /** Von Hand erfasste Ausgaben (Einkäufe usw.), im Plan Teil von „frei“ */
  otherCents: Cents;
  /** Einnahmen minus alle Ausgaben */
  restCents: Cents;
}

type BookedTransaction = Pick<
  Transaction,
  'date' | 'amountCents' | 'kind' | 'sourceType' | 'sourceId'
>;

/**
 * Was im Monat tatsächlich gebucht ist, aufgeteilt wie der Plan. Ausgaben sind positive Beträge.
 * Buchungen aus „Fällige übernehmen“ werden über Art und Quelle zugeordnet, von Hand erfasste
 * Ausgaben zählen als „sonstige“.
 */
export function bookedBreakdown(
  transactions: readonly BookedTransaction[],
  items: readonly Pick<ReserveItemLike, 'id' | 'kind' | 'intervalMonths'>[],
  month: YearMonth,
): BookedBreakdown {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const r = {
    incomeCents: 0,
    fixedCents: 0,
    reserveCents: 0,
    loanCents: 0,
    savingCents: 0,
    otherCents: 0,
  };
  for (const t of transactions) {
    if (monthOfDate(t.date) !== month) continue;
    const out = -t.amountCents;
    if (t.kind === 'loan_payment') r.loanCents += out;
    else if (t.kind === 'reserve' || t.kind === 'transfer') r.reserveCents += out;
    else if (t.sourceType === 'recurring_item') {
      const item = t.sourceId ? itemById.get(t.sourceId) : undefined;
      if (t.amountCents > 0) r.incomeCents += t.amountCents;
      else if (item && viaReserve(item)) r.reserveCents += out;
      else if (item?.kind === 'saving') r.savingCents += out;
      else r.fixedCents += out;
    } else if (t.amountCents > 0) r.incomeCents += t.amountCents;
    else r.otherCents += out;
  }
  return {
    ...r,
    restCents:
      r.incomeCents - r.fixedCents - r.reserveCents - r.loanCents - r.savingCents - r.otherCents,
  };
}
