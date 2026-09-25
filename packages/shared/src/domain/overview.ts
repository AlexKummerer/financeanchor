import type { Cents } from '../money.js';
import type { YearMonth } from '../month.js';
import type { Loan } from '../schemas/entities.js';
import { hasStarted, monthlyShareTimes12, viaReserve } from './recurring.js';
import {
  reserveMonthlyAmount,
  reserveNeed,
  type ReserveItemLike,
  type ReservePotLike,
} from './reserve.js';

export type LoanLike = Pick<Loan, 'id' | 'balanceCents' | 'rateBp' | 'paymentCents'>;

export interface MonthlyBreakdown {
  incomeCents: Cents;
  fixedCents: Cents;
  reserveCents: Cents;
  /** Kreditraten inklusive Extra-Tilgung */
  loanCents: Cents;
  savingCents: Cents;
  /** Einnahmen minus alles andere; kann negativ sein */
  freeCents: Cents;
}

export interface BreakdownInput {
  items: readonly ReserveItemLike[];
  pots: readonly ReservePotLike[];
  loans: readonly LoanLike[];
  extraPaymentCents: Cents;
  month: YearMonth;
}

/**
 * Wohin fließt ein Monat: feste Einnahmen aufgeteilt in Fixkosten, Rücklage, Kreditraten, Sparen, frei.
 *
 * Monatliche Posten zählen ab ihrem Startmonat. Posten über die Rücklage stecken im Rücklagenbetrag
 * (für sie wird schon vor der ersten Fälligkeit angespart). Kredite zählen, solange Restschuld besteht.
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
  const openLoans = input.loans.filter((l) => l.balanceCents > 0);
  const loanCents =
    openLoans.reduce((sum, l) => sum + l.paymentCents, 0) +
    (openLoans.length ? input.extraPaymentCents : 0);
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
