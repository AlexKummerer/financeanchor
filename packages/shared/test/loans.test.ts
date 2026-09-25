import { describe, expect, it } from 'vitest';
import {
  addMonths,
  allocateMonth,
  extraPaymentOrder,
  paymentToPayOff,
  planLoans,
  requiredThisMonth,
  scenarioFor,
  suggestedScenarios,
  type PlanLoan,
} from '../src/index.js';
import { loans as demoLoans } from './fixtures/demo.js';
import { prototypeSimulate } from './reference/prototype.js';

const START = '2026-10';

const loan = (
  id: string,
  euro: number,
  ratePct: number,
  paymentEuro: number,
  targetMonth: string | null = null,
): PlanLoan => ({
  id,
  kind: 'installment',
  balanceCents: Math.round(euro * 100),
  rateBp: Math.round(ratePct * 100),
  paymentCents: Math.round(paymentEuro * 100),
  targetMonth,
  dueDate: null,
  paymentMode: null,
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

const plan = (
  ls: PlanLoan[],
  budgetCents: number | null,
  strategy: 'avalanche' | 'snowball' = 'avalanche',
) => planLoans(ls, { budgetCents, strategy, startMonth: START });

describe('Rate bis zur Frist', () => {
  it('ohne Zins: Restschuld geteilt durch Monate, aufgerundet', () => {
    expect(paymentToPayOff(100000, 0, 6)).toBe(16667);
    expect(paymentToPayOff(100000, 0, 1)).toBe(100000);
  });
  it('mit Zins: Annuität, tilgt genau in der Laufzeit', () => {
    const p = paymentToPayOff(840000, 590, 36);
    expect(p).toBe(25517);
    const s = scenarioFor(loan('a', 8400, 5.9, 0), p, START);
    expect(s.months).toBe(36);
  });
});

describe('Ratenkredite ohne Ziel (bisheriges Verhalten)', () => {
  it('ohne Kredite: kein Plan', () => {
    expect(plan([], null)).toBeNull();
    expect(plan([loan('a', 0, 5, 100)], null)).toBeNull();
  });

  it('zinsloser Kredit: 900 € zu 75 € sind zwölf Raten ab dem Startmonat', () => {
    const p = plan([loan('a', 900, 0, 75)], null)!;
    expect(p.months).toHaveLength(12);
    expect(p.payoffMonthById.a).toBe('2027-09');
    expect(p.debtFreeMonth).toBe('2027-09');
    expect(p.totalInterestCents).toBe(0);
  });

  it('letzte Rate höchstens Restschuld plus Zins', () => {
    const a = allocateMonth([loan('a', 1000, 12, 1500)], START, null, 'avalanche');
    expect(a.loans[0]).toMatchObject({
      interestCents: 1000,
      regularCents: 101000,
      balanceAfterCents: 0,
    });
  });

  it('„nicht absehbar“, wenn die Raten die Zinsen nicht decken; mehr Budget behebt das', () => {
    const l = loan('a', 10000, 12, 50);
    expect(plan([l], null)!.stuck).toBe(true);
    expect(plan([l], null)!.payoffMonthById.a).toBeNull();
    expect(plan([l], 25000)!.stuck).toBe(false);
  });

  it('mit Budget rollen frei werdende Raten weiter, ohne Budget nicht', () => {
    const car = loan('auto', 8400, 5.9, 260);
    const laptop = loan('laptop', 900, 0, 75);
    const withBudget = plan([car, laptop], 33500)!;
    const without = plan([car, laptop], null)!;
    expect(withBudget.payoffMonthById.laptop).toBe('2027-09');
    expect(withBudget.payoffMonthById.auto! < without.payoffMonthById.auto!).toBe(true);
  });

  describe('Strategien', () => {
    const a = loan('teuer', 1000, 10, 50);
    const b = loan('klein', 500, 2, 50);

    it('Reihenfolge: höchster Zins bzw. kleinste Schuld zuerst, bei Gleichstand Eingabereihenfolge', () => {
      expect(extraPaymentOrder([b, a], 'avalanche').map((l) => l.id)).toEqual(['teuer', 'klein']);
      expect(extraPaymentOrder([a, b], 'snowball').map((l) => l.id)).toEqual(['klein', 'teuer']);
    });

    it('der Rest des Budgets geht an den Kredit, den die Strategie vorsieht', () => {
      expect(
        allocateMonth([a, b], START, 20000, 'avalanche').loans.map((l) => l.extraCents),
      ).toEqual([10000, 0]);
      expect(
        allocateMonth([a, b], START, 20000, 'snowball').loans.map((l) => l.extraCents),
      ).toEqual([0, 10000]);
    });

    it('avalanche spart Zinsen, snowball tilgt den kleinen Kredit früher', () => {
      const av = plan([a, b], 20000, 'avalanche')!;
      const sn = plan([a, b], 20000, 'snowball')!;
      expect(av.totalInterestCents).toBeLessThan(sn.totalInterestCents);
      expect(sn.payoffMonthById.klein! < av.payoffMonthById.klein!).toBe(true);
    });
  });

  describe('Vergleich mit dem Prototyp (Budget = Raten + Extra)', () => {
    const cases: [string, PlanLoan[], number][] = [
      ['Beispieldaten', demoLoans, 0],
      ['Beispieldaten mit 100 € extra', demoLoans, 10000],
      [
        'drei Kredite',
        [loan('a', 12000, 7.5, 300), loan('b', 3000, 11.9, 90), loan('c', 450, 0, 45)],
        5000,
      ],
    ];
    for (const [name, ls, extra] of cases) {
      for (const strategy of ['avalanche', 'snowball'] as const) {
        it(`${name}, ${strategy}`, () => {
          const budget = ls.reduce((s, l) => s + (l.paymentCents ?? 0), 0) + extra;
          const ours = plan(ls, budget, strategy)!;
          const proto = prototypeSimulate(
            ls.map((l) => ({
              id: l.id,
              balance: l.balanceCents / 100,
              rate: l.rateBp / 100,
              payment: (l.paymentCents ?? 0) / 100,
            })),
            extra / 100,
            strategy,
          )!;
          expect(ours.stuck).toBe(proto.stuck);
          expect(ours.months).toHaveLength(proto.months);
          for (const l of ls) {
            const k = proto.per[l.id];
            expect(ours.payoffMonthById[l.id]).toBe(k == null ? null : addMonths(START, k - 1));
          }
          expect(Math.abs(ours.totalInterestCents - proto.interest * 100)).toBeLessThanOrEqual(
            ls.length * proto.months,
          );
        });
      }
    }
  });
});

describe('Zieldatum bei Ratenkrediten', () => {
  it('Aufstockung, damit der Kredit rechtzeitig weg ist', () => {
    // 1.200 € zu 0 %, Rate 100 € (12 Monate), Ziel: März 2027 (6 Monate)
    const p = plan([loan('a', 1200, 0, 100, '2027-03')], null)!;
    expect(p.months[0]!.loans[0]).toMatchObject({ regularCents: 10000, deadlineCents: 10000 });
    expect(p.payoffMonthById.a).toBe('2027-03');
    expect(p.deadlines.a).toEqual({ month: '2027-03', met: true });
  });

  it('reicht das Budget nicht, wird die Unterdeckung ausgewiesen und das Ziel verfehlt', () => {
    const p = plan([loan('a', 1200, 0, 100, '2027-03')], 15000)!;
    expect(p.months[0]!.shortfallCents).toBe(5000);
    expect(p.maxShortfallCents).toBeGreaterThanOrEqual(5000);
    expect(p.deadlines.a!.met).toBe(false);
  });

  it('frühestes Ziel zuerst, wenn das Budget knapp ist', () => {
    const early = loan('frueh', 600, 0, 50, '2027-01');
    const late = loan('spaet', 600, 0, 50, '2027-06');
    const a = allocateMonth([late, early], START, 21000, 'avalanche');
    const byId = Object.fromEntries(a.loans.map((l) => [l.id, l]));
    // Pflicht 2 × 50 €; frueh braucht 150 €/Monat (bis Jan.), also +100 €; spaet bräuchte +16,67 €,
    // bekommt aber nur den Rest von 10 €
    expect(byId.frueh!.deadlineCents).toBe(10000);
    expect(byId.spaet!.deadlineCents).toBe(1000);
    expect(a.shortfallCents).toBe(667);
  });
});

describe('„Tilgen bis Datum“', () => {
  it('Teilzahlungen: gleichmäßig bis zur Frist, im Fristmonat der Rest', () => {
    const p = plan([deadline('kredit', 1000, '2027-03-31', 'spread')], null)!;
    expect(p.months.map((m) => m.loans[0]!.regularCents)).toEqual([
      16667, 16667, 16667, 16667, 16666, 16666,
    ]);
    expect(p.payoffMonthById.kredit).toBe('2027-03');
    expect(p.deadlines.kredit).toEqual({ month: '2027-03', met: true });
  });

  it('Einmalzahlung: erst im Fälligkeitsmonat, dann der ganze Betrag', () => {
    const p = plan([deadline('klarna', 300, '2026-11-25', 'lump')], null)!;
    expect(p.months.map((m) => m.loans[0]!.regularCents)).toEqual([0, 30000]);
    expect(p.payoffMonthById.klarna).toBe('2026-11');
  });

  it('Einmalzahlungen werden nicht vorzeitig aus dem Extra-Budget getilgt', () => {
    const a = allocateMonth(
      [deadline('klarna', 300, '2027-01-10', 'lump'), loan('auto', 5000, 5, 200)],
      START,
      50000,
      'snowball',
    );
    expect(a.loans[0]!.extraCents).toBe(0);
    expect(a.loans[1]!.extraCents).toBe(30000);
  });

  it('fällige Einmalzahlung hat Vorrang vor Raten, Unterdeckung wird gemeldet', () => {
    const a = allocateMonth(
      [loan('auto', 5000, 0, 200), deadline('klarna', 300, '2026-10-20', 'lump')],
      START,
      35000,
      'avalanche',
    );
    const byId = Object.fromEntries(a.loans.map((l) => [l.id, l]));
    expect(byId.klarna!.regularCents).toBe(30000);
    expect(byId.auto!.regularCents).toBe(5000);
    expect(a.shortfallCents).toBe(15000);
  });

  it('überfällige Einmalzahlung bleibt voll fällig', () => {
    const a = allocateMonth(
      [deadline('klarna', 300, '2026-09-20', 'lump')],
      START,
      null,
      'avalanche',
    );
    expect(a.loans[0]!.regularCents).toBe(30000);
  });

  it('Mindestbudget im Monat = Pflicht + Fristen', () => {
    expect(
      requiredThisMonth(
        [loan('auto', 5000, 0, 200), deadline('kredit', 600, '2027-03-31', 'spread')],
        START,
      ),
    ).toBe(20000 + 10000);
  });
});

describe('Beispielrechnungen', () => {
  it('Frist-Kredit: erste Zeile ist die nötige Rate, dann höhere runde Beträge mit früherem Ende', () => {
    const rows = suggestedScenarios(deadline('kredit', 1500, '2027-03-31', 'spread'), START);
    expect(rows.map((r) => r.monthlyCents)).toEqual([25000, 32000, 38000, 50000]);
    expect(rows[0]).toMatchObject({
      payoffMonth: '2027-03',
      meetsDeadline: true,
      totalInterestCents: 0,
    });
    expect(rows[3]).toMatchObject({ payoffMonth: '2026-12', meetsDeadline: true });
    const months = rows.map((r) => r.months);
    expect([...months].sort((a, b) => b - a)).toEqual(months);
  });

  it('Ratenkredit: ausgehend von der Rate, mit Zinsersparnis', () => {
    const rows = suggestedScenarios(loan('auto', 8400, 5.9, 260), START);
    expect(rows[0]!.monthlyCents).toBe(26000);
    expect(rows.at(-1)!.totalInterestCents).toBeLessThan(rows[0]!.totalInterestCents);
    expect(rows[0]!.meetsDeadline).toBeNull();
  });

  it('höchstens ein Betrag, der sofort tilgt; keine Beispiele bei Einmalzahlung', () => {
    const rows = suggestedScenarios(loan('rest', 120, 0, 100), START);
    expect(rows.map((r) => r.monthlyCents)).toEqual([10000, 12000]);
    expect(suggestedScenarios(deadline('k', 300, '2026-11-01', 'lump'), START)).toEqual([]);
  });

  it('eigener Betrag: zu wenig für die Zinsen ist „nicht absehbar“', () => {
    expect(scenarioFor(loan('a', 10000, 12, 0), 5000, START)).toMatchObject({
      stuck: true,
      payoffMonth: null,
    });
  });
});
