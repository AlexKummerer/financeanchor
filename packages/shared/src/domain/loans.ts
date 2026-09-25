import { monthlyInterest, type Cents } from '../money.js';
import { addMonths, monthIndex, monthOfDate, type YearMonth } from '../month.js';
import type { Loan } from '../schemas/entities.js';
import type { Strategy } from '../schemas/common.js';

export type PlanLoan = Pick<
  Loan,
  | 'id'
  | 'kind'
  | 'balanceCents'
  | 'rateBp'
  | 'paymentCents'
  | 'targetMonth'
  | 'dueDate'
  | 'paymentMode'
> & {
  /** Für eine Einmalzahlung schon zurückgelegt (Standard 0) */
  savedCents?: Cents;
  /** Selbst festgelegte Extra-Tilgung pro Monat (Standard 0) */
  extraMonthlyCents?: Cents;
};

/** Abbruchgrenze der Simulation (50 Jahre), wie im Prototyp. */
export const MAX_SIMULATION_MONTHS = 600;

/** Frist eines Kredits als Monat: Zieldatum beim Ratenkredit, Fälligkeit bei „Tilgen bis Datum“. */
export function deadlineMonthOf(
  loan: Pick<PlanLoan, 'kind' | 'targetMonth' | 'dueDate'>,
): YearMonth | null {
  if (loan.kind === 'deadline') return loan.dueDate ? monthOfDate(loan.dueDate) : null;
  return loan.targetMonth;
}

export function isLump(loan: Pick<PlanLoan, 'kind' | 'paymentMode'>): boolean {
  return loan.kind === 'deadline' && loan.paymentMode === 'lump';
}

/**
 * Monatsrate, die einen Saldo in `months` Monaten vollständig tilgt (Annuität, auf Cent aufgerundet).
 * Bei einem Monat oder weniger ist es der ganze Saldo plus Monatszins.
 */
export function paymentToPayOff(balance: Cents, rateBp: number, months: number): Cents {
  if (balance <= 0) return 0;
  if (months <= 1) return balance + monthlyInterest(balance, rateBp);
  if (rateBp === 0) return Math.ceil(balance / months);
  const r = rateBp / 120_000;
  return Math.ceil((balance * r) / (1 - Math.pow(1 + r, -months)));
}

/** Verbleibende Monate bis zur Frist, einschließlich des laufenden (mindestens 1). */
export function monthsUntil(month: YearMonth, deadline: YearMonth): number {
  return Math.max(1, monthIndex(deadline) - monthIndex(month) + 1);
}

/** Reihenfolge für Extra-Tilgung nach Strategie. Bei Gleichstand gilt die Eingabereihenfolge. */
export function extraPaymentOrder<T extends { balanceCents: Cents; rateBp: number }>(
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

export interface LoanMonth {
  id: string;
  balanceBeforeCents: Cents;
  interestCents: Cents;
  /** Vereinbarte Rate eines Ratenkredits */
  regularCents: Cents;
  /** Bei „Tilgen bis Datum“: Teilzahlung bzw. Rest einer Einmalzahlung */
  deadlineCents: Cents;
  /** Selbst festgelegte Extra-Tilgung */
  extraCents: Cents;
  /** Für eine spätere Einmalzahlung zurückgelegt (mindert die Schuld noch nicht) */
  savingCents: Cents;
  /** Bei Fälligkeit aus dem Angesparten gezahlt */
  fromSavingsCents: Cents;
  savedAfterCents: Cents;
  balanceAfterCents: Cents;
}

export interface MonthAllocation {
  month: YearMonth;
  loans: LoanMonth[];
  /** Was im Monat aus dem eigenen Geld fließt (Raten, Fristen, Zurücklegen, Extra) */
  paidCents: Cents;
}

export interface AllocateOptions {
  /** Kredite, deren Monatsrate schon gebucht ist: kein Zins, keine Rate mehr in diesem Monat */
  settled?: ReadonlySet<string>;
  /** Extra-Tilgung dieses Monats ist schon gebucht */
  noExtra?: boolean;
}

/** Zahlung an den Kreditgeber in diesem Monat (inkl. Angespartem). */
export function paidToLoan(m: LoanMonth): Cents {
  return m.regularCents + m.deadlineCents + m.extraCents + m.fromSavingsCents;
}

/** Was dieser Monat aus dem eigenen Geld braucht (inkl. Zurückgelegtem). */
export function budgetUsed(m: LoanMonth): Cents {
  return m.regularCents + m.deadlineCents + m.extraCents + m.savingCents;
}

/**
 * Zahlungen eines Monats, so wie sie vereinbart bzw. selbst festgelegt sind:
 * Rate beim Ratenkredit, bei „Tilgen bis Datum“ die nötige Teilzahlung bzw. das Zurücklegen und im
 * Fälligkeitsmonat die Einmalzahlung, dazu die eigene Extra-Tilgung (nicht bei Einmalzahlungen).
 */
export function allocateMonth(
  loans: readonly PlanLoan[],
  month: YearMonth,
  options: AllocateOptions = {},
): MonthAllocation {
  const m = monthIndex(month);
  const results = loans.map((loan): LoanMonth => {
    const open = loan.balanceCents > 0;
    const settled = options.settled?.has(loan.id) ?? false;
    const interest = open && !settled ? monthlyInterest(loan.balanceCents, loan.rateBp) : 0;
    let balance = loan.balanceCents + interest;
    const deadline = deadlineMonthOf(loan);
    let saved = Math.min(loan.savedCents ?? 0, balance);
    const r: LoanMonth = {
      id: loan.id,
      balanceBeforeCents: loan.balanceCents,
      interestCents: interest,
      regularCents: 0,
      deadlineCents: 0,
      extraCents: 0,
      savingCents: 0,
      fromSavingsCents: 0,
      savedAfterCents: saved,
      balanceAfterCents: balance,
    };
    if (!open) return r;
    if (!settled) {
      if (loan.kind === 'installment') {
        r.regularCents = Math.min(loan.paymentCents ?? 0, balance);
        balance -= r.regularCents;
      } else if (isLump(loan)) {
        if (deadline && m < monthIndex(deadline)) {
          const rest = balance - saved;
          r.savingCents = Math.min(rest, Math.ceil(rest / monthsUntil(month, deadline)));
          saved += r.savingCents;
        } else {
          r.fromSavingsCents = saved;
          r.deadlineCents = balance - saved;
          saved = 0;
          balance = 0;
        }
      } else {
        const n = deadline ? monthsUntil(month, deadline) : 1;
        r.deadlineCents = Math.min(balance, paymentToPayOff(loan.balanceCents, loan.rateBp, n));
        balance -= r.deadlineCents;
      }
    }
    if (!isLump(loan) && !options.noExtra) {
      r.extraCents = Math.min(loan.extraMonthlyCents ?? 0, balance);
      balance -= r.extraCents;
    }
    r.balanceAfterCents = balance;
    r.savedAfterCents = saved;
    return r;
  });
  return { month, loans: results, paidCents: results.reduce((s, r) => s + budgetUsed(r), 0) };
}

export interface PlanOptions {
  startMonth: YearMonth;
  /** Im Startmonat schon Gebuchtes (siehe `AllocateOptions`) */
  firstMonth?: AllocateOptions;
  maxMonths?: number;
}

export interface LoanPlan {
  months: MonthAllocation[];
  /** Monat, in dem der Kredit getilgt ist; `null`, wenn nicht absehbar */
  payoffMonthById: Record<string, YearMonth | null>;
  debtFreeMonth: YearMonth | null;
  totalInterestCents: Cents;
  /** Raten decken die Zinsen nicht, Schuldenfreiheit nicht absehbar */
  stuck: boolean;
  /** Je Kredit mit Frist oder Ziel: wird es mit den geplanten Zahlungen erreicht? */
  deadlines: Record<string, { month: YearMonth; met: boolean }>;
}

/**
 * Tilgungsplan aller offenen Kredite ab `startMonth` mit genau den vereinbarten und selbst
 * festgelegten Zahlungen. `null`, wenn keine offenen Kredite vorhanden sind.
 */
export function planLoans(loans: readonly PlanLoan[], options: PlanOptions): LoanPlan | null {
  let state = loans.filter((l) => l.balanceCents > 0).map((l) => ({ ...l }));
  if (!state.length) return null;
  const max = options.maxMonths ?? MAX_SIMULATION_MONTHS;
  const payoffMonthById: Record<string, YearMonth | null> = Object.fromEntries(
    state.map((l) => [l.id, null]),
  );
  const months: MonthAllocation[] = [];
  let totalInterestCents = 0;
  for (let k = 0; k < max && state.some((l) => l.balanceCents > 0); k++) {
    const month = addMonths(options.startMonth, k);
    const alloc = allocateMonth(state, month, k === 0 ? options.firstMonth : {});
    months.push(alloc);
    state = state.map((l, i) => {
      const r = alloc.loans[i];
      if (!r) return l;
      totalInterestCents += r.interestCents;
      if (r.balanceBeforeCents > 0 && r.balanceAfterCents === 0) payoffMonthById[l.id] = month;
      return { ...l, balanceCents: r.balanceAfterCents, savedCents: r.savedAfterCents };
    });
  }
  const stuck = state.some((l) => l.balanceCents > 0);
  const deadlines: LoanPlan['deadlines'] = {};
  for (const l of loans) {
    const d = deadlineMonthOf(l);
    if (!d || l.balanceCents <= 0) continue;
    const paid = payoffMonthById[l.id];
    deadlines[l.id] = { month: d, met: paid != null && monthIndex(paid) <= monthIndex(d) };
  }
  return {
    months,
    payoffMonthById,
    debtFreeMonth: stuck ? null : (months.at(-1)?.month ?? null),
    totalInterestCents,
    stuck,
    deadlines,
  };
}

/** Was im Monat für alle Kredite zusammen fließt (Raten, Fristen, Zurücklegen, eigene Extras). */
export function committedThisMonth(loans: readonly PlanLoan[], month: YearMonth): Cents {
  return allocateMonth(loans, month).paidCents;
}

/**
 * Ratenkredit mit Ziel: wie viel pro Monat zusätzlich zur Rate und zur eigenen Extra-Tilgung nötig
 * wäre, um das Ziel zu erreichen (0 = reicht schon). `null` ohne Ziel.
 */
export function extraNeededForTarget(loan: PlanLoan, month: YearMonth): Cents | null {
  if (loan.kind !== 'installment' || !loan.targetMonth || loan.balanceCents <= 0) return null;
  const need = paymentToPayOff(
    loan.balanceCents,
    loan.rateBp,
    monthsUntil(month, loan.targetMonth),
  );
  return Math.max(0, need - (loan.paymentCents ?? 0) - (loan.extraMonthlyCents ?? 0));
}

export interface Scenario {
  monthlyCents: Cents;
  months: number;
  payoffMonth: YearMonth | null;
  totalInterestCents: Cents;
  stuck: boolean;
  meetsDeadline: boolean | null;
}

/** „Was wäre, wenn“: ein einzelner Kredit wird jeden Monat mit `monthlyCents` getilgt. */
export function scenarioFor(loan: PlanLoan, monthlyCents: Cents, startMonth: YearMonth): Scenario {
  let balance = loan.balanceCents;
  let interest = 0;
  let k = 0;
  while (balance > 0 && k < MAX_SIMULATION_MONTHS) {
    const i = monthlyInterest(balance, loan.rateBp);
    interest += i;
    balance = Math.max(0, balance + i - monthlyCents);
    k++;
  }
  const stuck = balance > 0;
  const payoffMonth = stuck ? null : addMonths(startMonth, Math.max(0, k - 1));
  const deadline = deadlineMonthOf(loan);
  return {
    monthlyCents,
    months: k,
    payoffMonth,
    totalInterestCents: interest,
    stuck,
    meetsDeadline:
      deadline === null
        ? null
        : payoffMonth !== null && monthIndex(payoffMonth) <= monthIndex(deadline),
  };
}

/** Pflichtbetrag pro Monat ohne eigene Extra-Tilgung: Rate bzw. nötige Frist-Rate. */
export function requiredMonthly(loan: PlanLoan, month: YearMonth): Cents {
  if (loan.kind === 'installment') return loan.paymentCents ?? 0;
  const deadline = deadlineMonthOf(loan);
  if (!deadline) return 0;
  return paymentToPayOff(loan.balanceCents, loan.rateBp, monthsUntil(month, deadline));
}

/** Ausgangsbetrag der Beispielrechnung: das, was aktuell geplant ist (Pflicht + eigene Extra). */
export function baseMonthlyAmount(loan: PlanLoan, month: YearMonth): Cents {
  return requiredMonthly(loan, month) + (isLump(loan) ? 0 : (loan.extraMonthlyCents ?? 0));
}

/** Auf einen „runden“ Betrag aufrunden (5 € bis 50 €-Schritte, je nach Größe). */
export function niceCeil(cents: Cents): Cents {
  const step = cents < 10_000 ? 500 : cents < 50_000 ? 1_000 : cents < 200_000 ? 2_500 : 5_000;
  return Math.ceil(cents / step) * step;
}

/**
 * Beispielrechnungen: der aktuell geplante Betrag, bei einem Ziel der dafür nötige, dann zwei bis
 * drei höhere, runde Beträge. Beträge, die im ersten Monat tilgen, werden auf einen reduziert.
 */
export function suggestedScenarios(loan: PlanLoan, month: YearMonth): Scenario[] {
  if (loan.balanceCents <= 0 || isLump(loan)) return [];
  const base = baseMonthlyAmount(loan, month);
  const fullPayoff = loan.balanceCents + monthlyInterest(loan.balanceCents, loan.rateBp);
  const target = extraNeededForTarget(loan, month);
  const candidates = [base, ...(target ? [base + target] : [])];
  for (const f of [1.25, 1.5, 2]) candidates.push(niceCeil(Math.max(base, 1) * f));
  const amounts = [...new Set(candidates.map((a) => Math.min(a, fullPayoff)))]
    .filter((a) => a > 0)
    .sort((a, b) => a - b);
  const capped = amounts.filter((a, i) => a < fullPayoff || amounts.indexOf(fullPayoff) === i);
  return capped.map((a) => scenarioFor(loan, a, month));
}
