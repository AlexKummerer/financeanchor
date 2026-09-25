import { monthlyInterest, type Cents } from '../money.js';
import type { Loan } from '../schemas/entities.js';
import type { Strategy } from '../schemas/common.js';

export type LoanState = Pick<Loan, 'id' | 'balanceCents' | 'rateBp' | 'paymentCents'>;

/** Abbruchgrenze der Simulation (50 Jahre), wie im Prototyp. */
export const MAX_SIMULATION_MONTHS = 600;

export interface LoanMonthResult {
  id: string;
  interestCents: Cents;
  /** Reguläre Rate, in der letzten Rate höchstens Restschuld plus Zins */
  regularCents: Cents;
  /** Extra-Tilgung und weitergerollte, frei gewordene Raten */
  extraCents: Cents;
  balanceBeforeCents: Cents;
  balanceAfterCents: Cents;
}

/** Reihenfolge, in der Extra-Tilgung verteilt wird. Bei Gleichstand gilt die Eingabereihenfolge. */
export function extraPaymentOrder<T extends Pick<LoanState, 'balanceCents' | 'rateBp'>>(
  loans: readonly T[],
  strategy: Strategy,
): T[] {
  return loans
    .map((loan, index) => ({ loan, index }))
    .sort((a, b) => {
      const d =
        strategy === 'snowball'
          ? a.loan.balanceCents - b.loan.balanceCents
          : b.loan.rateBp - a.loan.rateBp;
      return d || a.index - b.index;
    })
    .map((x) => x.loan);
}

/**
 * Ein Monat gemeinsamer Tilgung: Zinsen auf alle offenen Kredite, dann die regulären Raten, dann
 * der Rest des Budgets (Extra-Tilgung und frei gewordene Raten) nach Strategie.
 */
export function payoffMonth(
  loans: readonly LoanState[],
  budgetCents: Cents,
  strategy: Strategy,
): LoanMonthResult[] {
  return payoffMonthEntries(loans, budgetCents, strategy).map((e) => e.result);
}

function payoffMonthEntries<T extends LoanState>(
  loans: readonly T[],
  budgetCents: Cents,
  strategy: Strategy,
): { loan: T; result: LoanMonthResult }[] {
  const entries = loans.map((loan) => {
    const interestCents = monthlyInterest(loan.balanceCents, loan.rateBp);
    const due = loan.balanceCents + interestCents;
    const regularCents = loan.balanceCents > 0 ? Math.min(loan.paymentCents, due) : 0;
    const result: LoanMonthResult = {
      id: loan.id,
      interestCents,
      regularCents,
      extraCents: 0,
      balanceBeforeCents: loan.balanceCents,
      balanceAfterCents: due - regularCents,
    };
    return { loan, result };
  });
  let available = budgetCents - entries.reduce((s, e) => s + e.result.regularCents, 0);
  const open = entries
    .filter((e) => e.result.balanceAfterCents > 0)
    .map((e) => ({ entry: e, balanceCents: e.result.balanceAfterCents, rateBp: e.loan.rateBp }));
  for (const { entry } of extraPaymentOrder(open, strategy)) {
    if (available <= 0) break;
    const p = Math.min(available, entry.result.balanceAfterCents);
    entry.result.extraCents += p;
    entry.result.balanceAfterCents -= p;
    available -= p;
  }
  return entries;
}

export interface PayoffSimulation {
  /** Monate bis schuldenfrei (1 = im laufenden Monat), bei `stuck` die Abbruchgrenze */
  months: number;
  totalInterestCents: Cents;
  /** Monat (1-basiert), in dem der Kredit getilgt ist; `null`, wenn nicht absehbar */
  payoffMonthById: Record<string, number | null>;
  /** Raten decken die Zinsen nicht, Schuldenfreiheit nicht absehbar */
  stuck: boolean;
}

/**
 * Gemeinsame Tilgungssimulation aller offenen Kredite. Das Monatsbudget ist die Summe der Raten
 * plus Extra-Tilgung und bleibt konstant: frei werdende Raten rollen auf die übrigen Kredite weiter.
 * Ergebnis `null`, wenn keine offenen Kredite vorhanden sind.
 */
export function simulatePayoff(
  loans: readonly LoanState[],
  extraPaymentCents: Cents,
  strategy: Strategy,
): PayoffSimulation | null {
  let state = loans.filter((l) => l.balanceCents > 0).map((l) => ({ ...l }));
  if (!state.length) return null;
  const budget = state.reduce((s, l) => s + l.paymentCents, 0) + extraPaymentCents;
  const payoffMonthById: Record<string, number | null> = Object.fromEntries(
    state.map((l) => [l.id, null]),
  );
  let totalInterestCents = 0;
  let month = 0;
  while (state.some((l) => l.balanceCents > 0) && month < MAX_SIMULATION_MONTHS) {
    month++;
    state = payoffMonthEntries(state, budget, strategy).map(({ loan, result }) => {
      totalInterestCents += result.interestCents;
      if (result.balanceBeforeCents > 0 && result.balanceAfterCents === 0) {
        payoffMonthById[loan.id] = month;
      }
      return { ...loan, balanceCents: result.balanceAfterCents };
    });
  }
  return {
    months: month,
    totalInterestCents,
    payoffMonthById,
    stuck: state.some((l) => l.balanceCents > 0),
  };
}
