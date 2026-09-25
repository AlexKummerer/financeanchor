import type { Cents } from '../money.js';
import { monthIndex, type YearMonth } from '../month.js';
import {
  allocateMonth,
  deadlineMonthOf,
  extraNeededForTarget,
  extraPaymentOrder,
  isLump,
  paymentToPayOff,
  planLoans,
  type LoanPlan,
  type PlanLoan,
} from './loans.js';

export interface LoanSuggestion {
  /**
   * `interest` = spart am meisten Zinsen (höchster Zins zuerst),
   * `relief` = schnellste Entlastung (kleinste Schuld zuerst, damit bald eine Rate wegfällt),
   * `target` = Ziel eines Ratenkredits erreichen
   */
  kind: 'interest' | 'relief' | 'target';
  loanId: string;
  /** Zusätzlich pro Monat, auf die bisherige Extra-Tilgung dieses Kredits obendrauf */
  addCents: Cents;
  /** Neue Extra-Tilgung des Kredits nach dem Übernehmen */
  newExtraMonthlyCents: Cents;
  /** Tilgungsmonat dieses Kredits mit dem Vorschlag */
  payoffMonth: YearMonth | null;
  /** So viele Monate früher als bisher geplant */
  monthsSooner: number;
  interestSavedCents: Cents;
  /** Bei `relief`: diese Rate fällt ab `payoffMonth` weg */
  freedPaymentCents: Cents;
}

/** Ein Posten der geplanten Zahlungen dieses Monats. */
export interface CommittedItem {
  loanId: string;
  /** `rate` = Rate, `deadline` = Frist-Rate/Einmalzahlung, `saving` = Zurücklegen, `extra` = eigene Extra-Tilgung */
  kind: 'rate' | 'deadline' | 'saving' | 'extra';
  amountCents: Cents;
  /** Bei Fristen und Rücklagen: bis wann */
  untilMonth: YearMonth | null;
}

export interface LoanAdvice {
  /** Was im Monat schon geplant ist (Raten, Fristen, Zurücklegen, eigene Extras) */
  committedCents: Cents;
  /** Woraus sich das Geplante zusammensetzt, größte Posten zuerst */
  committed: CommittedItem[];
  availableCents: Cents | null;
  /** Verfügbar minus geplant; negativ = es fehlt Geld */
  freeCents: Cents | null;
  baseline: LoanPlan | null;
  /** Nur, wenn Geld übrig ist – und nur Vorschläge, die hineinpassen */
  suggestions: LoanSuggestion[];
}

function monthDiff(later: YearMonth | null, earlier: YearMonth | null): number {
  return later && earlier ? monthIndex(later) - monthIndex(earlier) : 0;
}

/**
 * Was ist geplant, was ist übrig, und was ließe sich mit dem Übrigen erreichen? Vorschläge ändern
 * nichts am Plan; übernommen werden sie als feste Extra-Tilgung am Kredit.
 */
export function loanAdvice(
  loans: readonly PlanLoan[],
  options: { month: YearMonth; availableCents: Cents | null },
): LoanAdvice {
  const { month, availableCents } = options;
  const baseline = planLoans(loans, { startMonth: month });
  const alloc = allocateMonth(loans, month);
  const committed: CommittedItem[] = [];
  alloc.loans.forEach((r, i) => {
    const loan = loans[i];
    if (!loan) return;
    const until = deadlineMonthOf(loan);
    const add = (kind: CommittedItem['kind'], amountCents: Cents, untilMonth: YearMonth | null) => {
      if (amountCents > 0) committed.push({ loanId: loan.id, kind, amountCents, untilMonth });
    };
    add('rate', r.regularCents, null);
    add('deadline', r.deadlineCents, until);
    add('saving', r.savingCents, until);
    add('extra', r.extraCents, null);
  });
  committed.sort((a, b) => b.amountCents - a.amountCents);
  const committedCents = alloc.paidCents;
  const freeCents = availableCents === null ? null : availableCents - committedCents;

  const suggestions: LoanSuggestion[] = [];
  if (freeCents === null || freeCents <= 0) {
    return { committedCents, committed, availableCents, freeCents, baseline, suggestions };
  }

  const evaluate = (
    kind: LoanSuggestion['kind'],
    loan: PlanLoan,
    addCents: Cents,
  ): LoanSuggestion => {
    const newExtra = (loan.extraMonthlyCents ?? 0) + addCents;
    const changed = loans.map((l) =>
      l.id === loan.id ? { ...l, extraMonthlyCents: newExtra } : l,
    );
    const plan = planLoans(changed, { startMonth: month });
    const before = baseline?.payoffMonthById[loan.id] ?? null;
    const after = plan?.payoffMonthById[loan.id] ?? null;
    return {
      kind,
      loanId: loan.id,
      addCents,
      newExtraMonthlyCents: newExtra,
      payoffMonth: after,
      monthsSooner: monthDiff(before, after),
      interestSavedCents: Math.max(
        0,
        (baseline?.totalInterestCents ?? 0) - (plan?.totalInterestCents ?? 0),
      ),
      freedPaymentCents: loan.kind === 'installment' ? (loan.paymentCents ?? 0) : 0,
    };
  };

  // Ziele, die ins Übrige passen
  for (const loan of loans) {
    const gap = extraNeededForTarget(loan, month);
    if (gap && gap > 0 && gap <= freeCents) suggestions.push(evaluate('target', loan, gap));
  }

  // Alles Übrige: einmal für die meiste Zinsersparnis, einmal für die schnellste Entlastung
  const candidates = loans.filter((l) => l.balanceCents > 0 && !isLump(l));
  const byInterest = extraPaymentOrder(candidates, 'avalanche')[0];
  const byRelief = extraPaymentOrder(candidates, 'snowball')[0];
  // Höchstens so viel, wie den Kredit in diesem Monat ablöst
  const useful = (loan: PlanLoan): Cents => {
    const r = alloc.loans.find((m) => m.id === loan.id);
    const paid = r ? r.regularCents + r.deadlineCents + r.extraCents : 0;
    return Math.min(
      freeCents,
      Math.max(0, paymentToPayOff(loan.balanceCents, loan.rateBp, 1) - paid),
    );
  };
  // Wählen beide denselben Kredit, gibt es nur einen Vorschlag; ein gleich hoher Ziel-Vorschlag reicht
  const known = (loanId: string, addCents: Cents) =>
    suggestions.some((s) => s.loanId === loanId && s.addCents === addCents);
  for (const [kind, loan] of [
    ['interest', byInterest],
    ['relief', byRelief],
  ] as const) {
    if (!loan) continue;
    const add = useful(loan);
    if (add > 0 && !known(loan.id, add)) suggestions.push(evaluate(kind, loan, add));
  }

  return { committedCents, committed, availableCents, freeCents, baseline, suggestions };
}
