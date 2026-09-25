import { describe, expect, it } from 'vitest';
import {
  addMonths,
  allocateMonth,
  budgetUsed,
  committedThisMonth,
  extraNeededForTarget,
  extraPaymentOrder,
  loanAdvice,
  paidToLoan,
  paymentToPayOff,
  planLoans,
  scenarioFor,
  suggestedScenarios,
  type PlanLoan,
} from '../src/index.js';
import { prototypeSimulate } from './reference/prototype.js';

const START = '2026-10';

const loan = (
  id: string,
  euro: number,
  ratePct: number,
  paymentEuro: number,
  opts: { target?: string; extraEuro?: number } = {},
): PlanLoan => ({
  id,
  kind: 'installment',
  balanceCents: Math.round(euro * 100),
  rateBp: Math.round(ratePct * 100),
  paymentCents: Math.round(paymentEuro * 100),
  targetMonth: opts.target ?? null,
  dueDate: null,
  paymentMode: null,
  extraMonthlyCents: Math.round((opts.extraEuro ?? 0) * 100),
});

const deadline = (
  id: string,
  euro: number,
  dueDate: string,
  mode: 'spread' | 'lump',
  ratePct = 0,
): PlanLoan => ({
  id,
  kind: 'deadline',
  balanceCents: Math.round(euro * 100),
  rateBp: Math.round(ratePct * 100),
  paymentCents: null,
  targetMonth: null,
  dueDate,
  paymentMode: mode,
});

const plan = (ls: PlanLoan[]) => planLoans(ls, { startMonth: START });

describe('Rate bis zur Frist', () => {
  it('ohne Zins: Restschuld geteilt durch Monate, aufgerundet', () => {
    expect(paymentToPayOff(100000, 0, 6)).toBe(16667);
    expect(paymentToPayOff(100000, 0, 1)).toBe(100000);
  });
  it('mit Zins: Annuität, tilgt genau in der Laufzeit', () => {
    const p = paymentToPayOff(840000, 590, 36);
    expect(p).toBe(25517);
    expect(scenarioFor(loan('a', 8400, 5.9, 0), p, START).months).toBe(36);
  });
});

describe('Plan mit den tatsächlichen Zahlungen', () => {
  it('ohne Kredite: kein Plan', () => {
    expect(plan([])).toBeNull();
    expect(plan([loan('a', 0, 5, 100)])).toBeNull();
  });

  it('zinsloser Kredit: 900 € zu 75 € sind zwölf Raten ab dem Startmonat', () => {
    const p = plan([loan('a', 900, 0, 75)])!;
    expect(p.months).toHaveLength(12);
    expect(p.payoffMonthById.a).toBe('2027-09');
    expect(p.debtFreeMonth).toBe('2027-09');
  });

  it('es wird genau die Rate gezahlt', () => {
    const postbank = loan('pb', 23420.23, 11.1, 364.99, { target: '2031-12' });
    const a = allocateMonth([postbank], START);
    expect(a.loans[0]).toMatchObject({ regularCents: 36499, extraCents: 0, deadlineCents: 0 });
    expect(a.paidCents).toBe(36499);
  });

  it('die eigene Extra-Tilgung kommt zur Rate dazu', () => {
    const a = allocateMonth([loan('pb', 23420.23, 11.1, 364.99, { extraEuro: 121.54 })], START);
    expect(a.loans[0]).toMatchObject({ regularCents: 36499, extraCents: 12154 });
  });

  it('letzte Rate höchstens Restschuld plus Zins, Extra höchstens der Rest', () => {
    const a = allocateMonth([loan('a', 1000, 12, 800, { extraEuro: 500 })], START);
    expect(a.loans[0]).toMatchObject({
      interestCents: 1000,
      regularCents: 80000,
      extraCents: 21000,
      balanceAfterCents: 0,
    });
  });

  it('„nicht absehbar“, wenn die Rate die Zinsen nicht deckt', () => {
    const p = plan([loan('a', 10000, 12, 50)])!;
    expect(p.stuck).toBe(true);
    expect(p.payoffMonthById.a).toBeNull();
  });

  it('ohne Extra entspricht ein einzelner Kredit dem Prototyp', () => {
    const ours = plan([loan('auto', 8400, 5.9, 260)])!;
    const proto = prototypeSimulate(
      [{ id: 'auto', balance: 8400, rate: 5.9, payment: 260 }],
      0,
      'avalanche',
    )!;
    expect(ours.months).toHaveLength(proto.months);
    expect(ours.payoffMonthById.auto).toBe(addMonths(START, proto.per.auto! - 1));
    expect(Math.abs(ours.totalInterestCents - proto.interest * 100)).toBeLessThanOrEqual(
      proto.months,
    );
  });

  it('ein Ziel wird nur geprüft, nicht automatisch aufgestockt', () => {
    const p = plan([loan('pb', 23420.23, 11.1, 364.99, { target: '2031-12' })])!;
    expect(p.deadlines.pb!.met).toBe(false);
    expect(p.months[0]!.loans[0]!.regularCents).toBe(36499);
  });

  it('mit genug eigener Extra-Tilgung wird das Ziel erreicht', () => {
    const base = loan('pb', 23420.23, 11.1, 364.99, { target: '2031-12' });
    const gap = extraNeededForTarget(base, START)!;
    expect(gap).toBeGreaterThan(0);
    const withExtra = { ...base, extraMonthlyCents: gap };
    expect(plan([withExtra])!.deadlines.pb!.met).toBe(true);
    expect(extraNeededForTarget(withExtra, START)).toBe(0);
  });
});

describe('„Tilgen bis Datum“', () => {
  it('Teilzahlungen: gleichmäßig bis zur Frist, im Fristmonat der Rest', () => {
    const p = plan([deadline('kredit', 1000, '2027-03-31', 'spread')])!;
    expect(p.months.map((m) => m.loans[0]!.deadlineCents)).toEqual([
      16667, 16667, 16667, 16667, 16666, 16666,
    ]);
    expect(p.deadlines.kredit).toEqual({ month: '2027-03', met: true });
  });

  it('Teilzahlungen plus eigene Extra-Tilgung: früher fertig', () => {
    const p = plan([
      { ...deadline('kredit', 1000, '2027-03-31', 'spread'), extraMonthlyCents: 10000 },
    ])!;
    expect(p.payoffMonthById.kredit! < '2027-03').toBe(true);
  });

  it('Einmalzahlung: bis zur Fälligkeit wird angespart, dann der ganze Betrag gezahlt', () => {
    const p = plan([deadline('klarna', 300, '2026-11-25', 'lump')])!;
    const [oct, nov] = p.months.map((m) => m.loans[0]!);
    expect(oct).toMatchObject({
      savingCents: 15000,
      savedAfterCents: 15000,
      balanceAfterCents: 30000,
    });
    expect(nov).toMatchObject({
      deadlineCents: 15000,
      fromSavingsCents: 15000,
      balanceAfterCents: 0,
    });
    expect(paidToLoan(nov!)).toBe(30000);
    expect(budgetUsed(oct!)).toBe(15000);
  });

  it('schon Zurückgelegtes senkt den Monatsbetrag; keine Extra-Tilgung bei Einmalzahlung', () => {
    const a = allocateMonth(
      [
        {
          ...deadline('fc', 3200, '2027-03-01', 'lump'),
          savedCents: 50000,
          extraMonthlyCents: 10000,
        },
      ],
      START,
    );
    expect(a.loans[0]).toMatchObject({ savingCents: 45000, extraCents: 0 });
  });

  it('überfällige Einmalzahlung bleibt voll fällig', () => {
    const a = allocateMonth([deadline('klarna', 300, '2026-09-20', 'lump')], START);
    expect(a.loans[0]!.deadlineCents).toBe(30000);
  });

  it('im Monat geplant = Raten + Fristen + Zurücklegen + eigene Extras', () => {
    expect(
      committedThisMonth(
        [
          loan('auto', 5000, 0, 200, { extraEuro: 50 }),
          deadline('kredit', 600, '2027-03-31', 'spread'),
          deadline('k', 400, '2026-11-15', 'lump'),
        ],
        START,
      ),
    ).toBe(20000 + 5000 + 10000 + 20000);
  });
});

describe('Vorschläge', () => {
  const postbank = loan('pb', 23420.23, 11.1, 364.99, { target: '2031-12' });

  it('Postbank: Ziel erreichen und alles Verfügbare nutzen, jeweils mit Wirkung', () => {
    const advice = loanAdvice([postbank], {
      month: '2026-09',
      availableCents: 60000,
      strategy: 'avalanche',
    });
    expect(advice.committedCents).toBe(36499);
    expect(advice.freeCents).toBe(60000 - 36499);
    const target = advice.suggestions.find((s) => s.kind === 'target')!;
    expect(target).toMatchObject({ loanId: 'pb', fits: true });
    expect(target.addCents).toBe(extraNeededForTarget(postbank, '2026-09'));
    expect(target.payoffMonth! <= '2031-12').toBe(true);
    expect(target.interestSavedCents).toBeGreaterThan(0);
    expect(target.monthsSooner).toBeGreaterThan(0);

    const all = advice.suggestions.find((s) => s.kind === 'all')!;
    expect(all).toMatchObject({
      loanId: 'pb',
      addCents: 23501,
      newExtraMonthlyCents: 23501,
      fits: true,
    });
    expect(all.interestSavedCents).toBeGreaterThan(target.interestSavedCents);
    // Der Plan selbst bleibt unverändert
    expect(advice.baseline!.months[0]!.paidCents).toBe(36499);
  });

  it('ohne verfügbares Geld nur der Ziel-Vorschlag, ohne Aussage zur Machbarkeit', () => {
    const advice = loanAdvice([postbank], {
      month: '2026-09',
      availableCents: null,
      strategy: 'avalanche',
    });
    expect(advice.freeCents).toBeNull();
    expect(advice.suggestions.map((s) => [s.kind, s.fits])).toEqual([['target', null]]);
  });

  it('reicht das Geld nicht für die Raten, gibt es keinen „alles nutzen“-Vorschlag', () => {
    const advice = loanAdvice([postbank], {
      month: '2026-09',
      availableCents: 30000,
      strategy: 'avalanche',
    });
    expect(advice.freeCents).toBe(30000 - 36499);
    expect(advice.suggestions.some((s) => s.kind === 'all')).toBe(false);
    expect(advice.suggestions.find((s) => s.kind === 'target')!.fits).toBe(false);
  });

  it('die Strategie bestimmt, welcher Kredit das Extra bekommt; Einmalzahlungen nie', () => {
    const ls = [
      loan('teuer', 1000, 10, 50),
      loan('klein', 500, 2, 50),
      deadline('klarna', 100, '2027-01-10', 'lump'),
    ];
    const av = loanAdvice(ls, { month: START, availableCents: 30000, strategy: 'avalanche' });
    const sn = loanAdvice(ls, { month: START, availableCents: 30000, strategy: 'snowball' });
    expect(av.suggestions[0]!.loanId).toBe('teuer');
    expect(sn.suggestions[0]!.loanId).toBe('klein');
    expect(extraPaymentOrder([ls[1]!, ls[0]!], 'avalanche').map((l) => l.id)).toEqual([
      'teuer',
      'klein',
    ]);
  });

  it('bestehende Extra-Tilgung wird fortgeschrieben', () => {
    const withExtra = { ...postbank, extraMonthlyCents: 5000 };
    const advice = loanAdvice([withExtra], {
      month: '2026-09',
      availableCents: 60000,
      strategy: 'avalanche',
    });
    const all = advice.suggestions.find((s) => s.kind === 'all')!;
    expect(all).toMatchObject({
      addCents: 60000 - 36499 - 5000,
      newExtraMonthlyCents: 60000 - 36499,
    });
  });
});

describe('Beispielrechnungen', () => {
  it('Frist-Kredit: erste Zeile ist die nötige Rate, dann höhere runde Beträge mit früherem Ende', () => {
    const rows = suggestedScenarios(deadline('kredit', 1500, '2027-03-31', 'spread'), START);
    expect(rows.map((r) => r.monthlyCents)).toEqual([25000, 32000, 38000, 50000]);
    expect(rows[0]).toMatchObject({ payoffMonth: '2027-03', meetsDeadline: true });
    expect(rows[3]).toMatchObject({ payoffMonth: '2026-12' });
  });

  it('Ratenkredit mit Ziel: aktueller Betrag, der fürs Ziel nötige, dann höhere', () => {
    const pb = loan('pb', 23420.23, 11.1, 364.99, { target: '2031-12' });
    const rows = suggestedScenarios(pb, START);
    expect(rows[0]).toMatchObject({ monthlyCents: 36499, meetsDeadline: false });
    const forTarget = rows.find(
      (r) => r.monthlyCents === 36499 + extraNeededForTarget(pb, START)!,
    )!;
    expect(forTarget.meetsDeadline).toBe(true);
  });

  it('höchstens ein Betrag, der sofort tilgt; keine Beispiele bei Einmalzahlung', () => {
    expect(suggestedScenarios(loan('rest', 120, 0, 100), START).map((r) => r.monthlyCents)).toEqual(
      [10000, 12000],
    );
    expect(suggestedScenarios(deadline('k', 300, '2026-11-01', 'lump'), START)).toEqual([]);
  });

  it('eigener Betrag: zu wenig für die Zinsen ist „nicht absehbar“', () => {
    expect(scenarioFor(loan('a', 10000, 12, 0), 5000, START)).toMatchObject({
      stuck: true,
      payoffMonth: null,
    });
  });
});
