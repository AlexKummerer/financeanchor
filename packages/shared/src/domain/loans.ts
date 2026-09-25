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
>;

/** Abbruchgrenze der Simulation (50 Jahre), wie im Prototyp. */
export const MAX_SIMULATION_MONTHS = 600;

/** Frist eines Kredits als Monat: Zieldatum beim Ratenkredit, Fälligkeit bei „Tilgen bis Datum“. */
export function deadlineMonthOf(
  loan: Pick<PlanLoan, 'kind' | 'targetMonth' | 'dueDate'>,
): YearMonth | null {
  if (loan.kind === 'deadline') return loan.dueDate ? monthOfDate(loan.dueDate) : null;
  return loan.targetMonth;
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

/** Reihenfolge, in der Extra-Tilgung verteilt wird. Bei Gleichstand gilt die Eingabereihenfolge. */
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
  /** Pflichtanteil: Mindestrate, Frist-Rate (Teilzahlung) oder Einmalzahlung */
  regularCents: Cents;
  /** Aufstockung, damit ein Ratenkredit sein Zieldatum erreicht */
  deadlineCents: Cents;
  /** Rest des Budgets nach Strategie, inkl. frei gewordener Raten */
  extraCents: Cents;
  balanceAfterCents: Cents;
  /** Was für Pflicht und Frist gefehlt hat */
  shortfallCents: Cents;
}

export interface MonthAllocation {
  month: YearMonth;
  loans: LoanMonth[];
  paidCents: Cents;
  /** Für Pflichtraten, Einmalzahlungen und Fristen fehlender Betrag */
  shortfallCents: Cents;
}

export interface AllocateOptions {
  /** Kredite, deren Monatsrate schon gebucht ist: kein Zins, keine Pflichtrate mehr in diesem Monat */
  settled?: ReadonlySet<string>;
  /** Bereits gebuchte Tilgung in diesem Monat (mindert das Budget) */
  spentCents?: Cents;
  /** Keine Extra-Tilgung verteilen (z. B. schon gebucht) */
  noExtra?: boolean;
}

/**
 * Verteilt das Monatsbudget auf die Kredite:
 * 1. Einmalzahlungen, die in diesem Monat fällig sind, 2. Mindestraten und Frist-Raten,
 * 3. Aufstockung für Zieldaten (frühestes zuerst), 4. Rest nach Strategie.
 * `budgetCents = null` zahlt genau die Pflicht- und Frist-Beträge, ohne Extra.
 */
export function allocateMonth(
  loans: readonly PlanLoan[],
  month: YearMonth,
  budgetCents: Cents | null,
  strategy: Strategy,
  options: AllocateOptions = {},
): MonthAllocation {
  const m = monthIndex(month);
  const entries = loans.map((loan) => {
    const open = loan.balanceCents > 0;
    const settled = options.settled?.has(loan.id) ?? false;
    const interest = open && !settled ? monthlyInterest(loan.balanceCents, loan.rateBp) : 0;
    const due = loan.balanceCents + interest;
    const deadline = deadlineMonthOf(loan);
    let required = 0;
    let deadlineNeed = 0;
    let lump = false;
    if (open && !settled) {
      if (loan.kind === 'installment') {
        required = Math.min(loan.paymentCents ?? 0, due);
        if (deadline) {
          const need = Math.min(
            due,
            paymentToPayOff(loan.balanceCents, loan.rateBp, monthsUntil(month, deadline)),
          );
          deadlineNeed = Math.max(0, need - required);
        }
      } else if (loan.paymentMode === 'lump') {
        lump = true;
        if (deadline && m >= monthIndex(deadline)) required = due;
      } else {
        const n = deadline ? monthsUntil(month, deadline) : 1;
        required = Math.min(due, paymentToPayOff(loan.balanceCents, loan.rateBp, n));
      }
    }
    const result: LoanMonth = {
      id: loan.id,
      balanceBeforeCents: loan.balanceCents,
      interestCents: interest,
      regularCents: 0,
      deadlineCents: 0,
      extraCents: 0,
      balanceAfterCents: due,
      shortfallCents: 0,
    };
    return { loan, result, required, deadlineNeed, lump, deadline, settled };
  });

  const obligations = entries.reduce((s, e) => s + e.required + e.deadlineNeed, 0);
  let available =
    budgetCents === null ? obligations : Math.max(0, budgetCents - (options.spentCents ?? 0));
  const pay = (want: number) => {
    const p = Math.min(available, want);
    available -= p;
    return p;
  };

  // 1. + 2. Pflicht: Einmalzahlungen zuerst, dann Raten in Eingabereihenfolge
  const byObligation = [...entries.filter((e) => e.lump), ...entries.filter((e) => !e.lump)];
  for (const e of byObligation) {
    if (!e.required) continue;
    const p = pay(e.required);
    e.result.regularCents = p;
    e.result.shortfallCents += e.required - p;
    e.result.balanceAfterCents -= p;
  }
  // 3. Fristen: frühestes Ziel zuerst
  const byDeadline = entries
    .filter((e) => e.deadlineNeed > 0)
    .sort((a, b) => monthIndex(a.deadline ?? month) - monthIndex(b.deadline ?? month));
  for (const e of byDeadline) {
    const p = pay(e.deadlineNeed);
    e.result.deadlineCents = p;
    e.result.shortfallCents += e.deadlineNeed - p;
    e.result.balanceAfterCents -= p;
  }
  // 4. Rest nach Strategie (Einmalzahlungen werden nicht vorzeitig getilgt)
  if (budgetCents !== null && !options.noExtra && available > 0) {
    const candidates = entries
      .filter((e) => !e.lump && e.result.balanceAfterCents > 0)
      .map((e) => ({ e, balanceCents: e.result.balanceAfterCents, rateBp: e.loan.rateBp }));
    for (const { e } of extraPaymentOrder(candidates, strategy)) {
      if (available <= 0) break;
      const p = pay(e.result.balanceAfterCents);
      e.result.extraCents = p;
      e.result.balanceAfterCents -= p;
    }
  }

  const results = entries.map((e) => e.result);
  return {
    month,
    loans: results,
    paidCents: results.reduce((s, r) => s + r.regularCents + r.deadlineCents + r.extraCents, 0),
    shortfallCents: results.reduce((s, r) => s + r.shortfallCents, 0),
  };
}

export interface PlanOptions {
  budgetCents: Cents | null;
  strategy: Strategy;
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
  /** Budget reicht dauerhaft nicht, Schuldenfreiheit nicht absehbar */
  stuck: boolean;
  /** Größte monatliche Unterdeckung für Pflicht und Fristen */
  maxShortfallCents: Cents;
  /** Je Kredit mit Frist: wird sie erreicht? */
  deadlines: Record<string, { month: YearMonth; met: boolean }>;
}

/**
 * Gemeinsamer Tilgungsplan aller offenen Kredite ab `startMonth`. Mit eigenem Budget bleibt der
 * Monatsbetrag konstant und frei werdende Raten rollen weiter; ohne Budget werden genau die
 * Pflicht- und Frist-Beträge gezahlt. `null`, wenn keine offenen Kredite vorhanden sind.
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
  let maxShortfallCents = 0;
  for (let k = 0; k < max && state.some((l) => l.balanceCents > 0); k++) {
    const month = addMonths(options.startMonth, k);
    const alloc = allocateMonth(
      state,
      month,
      options.budgetCents,
      options.strategy,
      k === 0 ? options.firstMonth : {},
    );
    months.push(alloc);
    maxShortfallCents = Math.max(maxShortfallCents, alloc.shortfallCents);
    state = state.map((l, i) => {
      const r = alloc.loans[i];
      if (!r) return l;
      totalInterestCents += r.interestCents;
      if (r.balanceBeforeCents > 0 && r.balanceAfterCents === 0) payoffMonthById[l.id] = month;
      return { ...l, balanceCents: r.balanceAfterCents };
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
    maxShortfallCents,
    deadlines,
  };
}

/** Summe der Pflicht- und Frist-Beträge im Startmonat – das Mindestbudget. */
export function requiredThisMonth(loans: readonly PlanLoan[], month: YearMonth): Cents {
  const a = allocateMonth(loans, month, null, 'avalanche');
  return a.paidCents;
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

/** Ausgangsbetrag der Beispielrechnung: nötige Frist-Rate, sonst die vereinbarte Rate. */
export function baseMonthlyAmount(loan: PlanLoan, month: YearMonth): Cents {
  const deadline = deadlineMonthOf(loan);
  const own = loan.kind === 'installment' ? (loan.paymentCents ?? 0) : 0;
  if (!deadline) return own;
  const need = paymentToPayOff(loan.balanceCents, loan.rateBp, monthsUntil(month, deadline));
  return Math.max(own, need);
}

/** Auf einen „runden“ Betrag aufrunden (5 € bis 50 €-Schritte, je nach Größe). */
export function niceCeil(cents: Cents): Cents {
  const step = cents < 10_000 ? 500 : cents < 50_000 ? 1_000 : cents < 200_000 ? 2_500 : 5_000;
  return Math.ceil(cents / step) * step;
}

/**
 * Beispielrechnungen: die nötige bzw. aktuelle Rate, dann zwei bis drei höhere, runde Beträge.
 * Beträge, die den Kredit ohnehin im ersten Monat tilgen, werden auf einen reduziert.
 */
export function suggestedScenarios(loan: PlanLoan, month: YearMonth): Scenario[] {
  if (loan.balanceCents <= 0 || (loan.kind === 'deadline' && loan.paymentMode === 'lump'))
    return [];
  const base = baseMonthlyAmount(loan, month);
  const fullPayoff = loan.balanceCents + monthlyInterest(loan.balanceCents, loan.rateBp);
  const amounts: number[] = base > 0 ? [Math.min(base, fullPayoff)] : [];
  for (const f of [1.25, 1.5, 2]) {
    const a = Math.min(niceCeil(Math.max(base, 1) * f), fullPayoff);
    const last = amounts.at(-1) ?? 0;
    if (a > last) amounts.push(a);
    if (a >= fullPayoff) break;
  }
  return amounts.map((a) => scenarioFor(loan, a, month));
}
