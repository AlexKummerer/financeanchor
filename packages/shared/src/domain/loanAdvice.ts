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

/** Was ein Vorschlag bei einem einzelnen Kredit ändert. */
export interface SuggestionPart {
  loanId: string;
  /** Zusätzlich pro Monat, auf die bisherige Extra-Tilgung dieses Kredits obendrauf */
  addCents: Cents;
  /** Neue Extra-Tilgung des Kredits nach dem Übernehmen */
  newExtraMonthlyCents: Cents;
  /** Tilgungsmonat dieses Kredits mit dem Vorschlag */
  payoffMonth: YearMonth | null;
  /** So viele Monate früher als bisher geplant */
  monthsSooner: number;
  /** Rate, die nach der Tilgung wegfällt (nur Ratenkredite) */
  freedPaymentCents: Cents;
}

export interface LoanSuggestion {
  /**
   * `interest` = spart am meisten Zinsen (höchster Zins zuerst),
   * `relief` = schnellste Entlastung (kleinste Schuld zuerst, damit bald Raten wegfallen),
   * `target` = Ziel eines Ratenkredits erreichen (immer genau ein Kredit)
   */
  kind: 'interest' | 'relief' | 'target';
  /** Der Reihe nach: erst wird ein Kredit abgelöst, der Rest geht an den nächsten */
  parts: SuggestionPart[];
  /** Summe aller Teile pro Monat */
  addCents: Cents;
  interestSavedCents: Cents;
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
    adds: readonly { loan: PlanLoan; addCents: Cents }[],
  ): LoanSuggestion => {
    const extraById = new Map(
      adds.map(({ loan, addCents }) => [loan.id, (loan.extraMonthlyCents ?? 0) + addCents]),
    );
    const changed = loans.map((l) => {
      const extra = extraById.get(l.id);
      return extra === undefined ? l : { ...l, extraMonthlyCents: extra };
    });
    const plan = planLoans(changed, { startMonth: month });
    const parts = adds.map(({ loan, addCents }): SuggestionPart => {
      const after = plan?.payoffMonthById[loan.id] ?? null;
      return {
        loanId: loan.id,
        addCents,
        newExtraMonthlyCents: (loan.extraMonthlyCents ?? 0) + addCents,
        payoffMonth: after,
        monthsSooner: monthDiff(baseline?.payoffMonthById[loan.id] ?? null, after),
        freedPaymentCents: loan.kind === 'installment' ? (loan.paymentCents ?? 0) : 0,
      };
    });
    return {
      kind,
      parts,
      addCents: adds.reduce((sum, a) => sum + a.addCents, 0),
      interestSavedCents: Math.max(
        0,
        (baseline?.totalInterestCents ?? 0) - (plan?.totalInterestCents ?? 0),
      ),
    };
  };

  // Ziele, die ins Übrige passen
  for (const loan of loans) {
    const gap = extraNeededForTarget(loan, month);
    if (gap && gap > 0 && gap <= freeCents) {
      suggestions.push(evaluate('target', [{ loan, addCents: gap }]));
    }
  }

  // Höchstens so viel je Kredit, wie ihn in diesem Monat ablöst
  const payoffRoom = (loan: PlanLoan): Cents => {
    const r = alloc.loans.find((m) => m.id === loan.id);
    const paid = r ? r.regularCents + r.deadlineCents + r.extraCents : 0;
    return Math.max(0, paymentToPayOff(loan.balanceCents, loan.rateBp, 1) - paid);
  };
  // Alles Übrige der Reihe nach verteilen: Wird ein Kredit abgelöst, geht der Rest an den nächsten
  const waterfall = (ordered: readonly PlanLoan[]) => {
    let rest = freeCents;
    const adds: { loan: PlanLoan; addCents: Cents }[] = [];
    for (const loan of ordered) {
      if (rest <= 0) break;
      const add = Math.min(rest, payoffRoom(loan));
      if (add > 0) adds.push({ loan, addCents: add });
      rest -= add;
    }
    return adds;
  };
  const candidates = loans.filter((l) => l.balanceCents > 0 && !isLump(l));
  const key = (adds: readonly { loan: PlanLoan; addCents: Cents }[]) =>
    adds.map((a) => `${a.loan.id}:${a.addCents}`).join('|');
  const known = new Set(
    suggestions.map((s) => s.parts.map((p) => `${p.loanId}:${p.addCents}`).join('|')),
  );
  for (const kind of ['interest', 'relief'] as const) {
    const adds = waterfall(
      extraPaymentOrder(candidates, kind === 'interest' ? 'avalanche' : 'snowball'),
    );
    // Wählen beide Wege dasselbe, gibt es nur einen Vorschlag
    if (adds.length && !known.has(key(adds))) {
      known.add(key(adds));
      suggestions.push(evaluate(kind, adds));
    }
  }

  return { committedCents, committed, availableCents, freeCents, baseline, suggestions };
}
