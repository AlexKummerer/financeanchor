import type { Cents } from '../money.js';
import type { YearMonth } from '../month.js';
import type { Strategy } from '../schemas/common.js';
import {
  committedThisMonth,
  extraNeededForTarget,
  extraPaymentOrder,
  isLump,
  planLoans,
  type LoanPlan,
  type PlanLoan,
} from './loans.js';

export interface LoanSuggestion {
  /** `target` = Ziel erreichen, `all` = alles verfügbare Geld nutzen */
  kind: 'target' | 'all';
  loanId: string;
  /** Zusätzlich pro Monat, auf die bisherige Extra-Tilgung dieses Kredits obendrauf */
  addCents: Cents;
  /** Neue Extra-Tilgung des Kredits nach dem Übernehmen */
  newExtraMonthlyCents: Cents;
  payoffMonth: YearMonth | null;
  /** Tilgung dieses Kredits so viele Monate früher als bisher geplant */
  monthsSooner: number;
  interestSavedCents: Cents;
  /** Passt in das verfügbare Geld (`null`, wenn keins angegeben ist) */
  fits: boolean | null;
}

export interface LoanAdvice {
  /** Was im Monat schon geplant ist (Raten, Fristen, Zurücklegen, eigene Extras) */
  committedCents: Cents;
  availableCents: Cents | null;
  /** Verfügbar minus geplant; negativ = Raten sind höher als das verfügbare Geld */
  freeCents: Cents | null;
  baseline: LoanPlan | null;
  suggestions: LoanSuggestion[];
}

function monthsBetweenOrNull(a: YearMonth | null, b: YearMonth | null): number {
  if (!a || !b) return 0;
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return ya * 12 + ma - (yb * 12 + mb);
}

/**
 * Vorschläge für zusätzliche Tilgung. Sie ändern nichts am Plan, sondern zeigen, was mit mehr Geld
 * möglich wäre; übernommen werden sie als feste Extra-Tilgung am Kredit.
 */
export function loanAdvice(
  loans: readonly PlanLoan[],
  options: { month: YearMonth; availableCents: Cents | null; strategy: Strategy },
): LoanAdvice {
  const { month, availableCents, strategy } = options;
  const baseline = planLoans(loans, { startMonth: month });
  const committedCents = committedThisMonth(loans, month);
  const freeCents = availableCents === null ? null : availableCents - committedCents;
  const suggestions: LoanSuggestion[] = [];

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
      monthsSooner: before && after ? monthsBetweenOrNull(before, after) : 0,
      interestSavedCents: Math.max(
        0,
        (baseline?.totalInterestCents ?? 0) - (plan?.totalInterestCents ?? 0),
      ),
      fits: freeCents === null ? null : addCents <= freeCents,
    };
  };

  for (const loan of loans) {
    const gap = extraNeededForTarget(loan, month);
    if (gap && gap > 0) suggestions.push(evaluate('target', loan, gap));
  }

  if (freeCents !== null && freeCents > 0) {
    const candidates = loans.filter((l) => l.balanceCents > 0 && !isLump(l));
    const first = extraPaymentOrder(candidates, strategy)[0];
    if (first && !suggestions.some((s) => s.loanId === first.id && s.addCents === freeCents)) {
      suggestions.push(evaluate('all', first, freeCents));
    }
  }

  return { committedCents, availableCents, freeCents, baseline, suggestions };
}
