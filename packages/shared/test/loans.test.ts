import { describe, expect, it } from 'vitest';
import { extraPaymentOrder, payoffMonth, simulatePayoff, type LoanState } from '../src/index.js';
import { loans as demoLoans } from './fixtures/demo.js';
import { prototypeSimulate } from './reference/prototype.js';

const loan = (id: string, euro: number, ratePct: number, paymentEuro: number): LoanState => ({
  id,
  balanceCents: Math.round(euro * 100),
  rateBp: Math.round(ratePct * 100),
  paymentCents: Math.round(paymentEuro * 100),
});

const toProto = (ls: LoanState[]) =>
  ls.map((l) => ({
    id: l.id,
    balance: l.balanceCents / 100,
    rate: l.rateBp / 100,
    payment: l.paymentCents / 100,
  }));

describe('Tilgungssimulation', () => {
  it('ohne Kredite: kein Ergebnis', () => {
    expect(simulatePayoff([], 0, 'avalanche')).toBeNull();
    expect(simulatePayoff([loan('a', 0, 5, 100)], 0, 'avalanche')).toBeNull();
  });

  it('zinsloser Kredit: Restschuld / Rate', () => {
    const s = simulatePayoff([loan('a', 900, 0, 75)], 0, 'avalanche')!;
    expect(s).toEqual({
      months: 12,
      totalInterestCents: 0,
      payoffMonthById: { a: 12 },
      stuck: false,
    });
  });

  it('letzte Rate ist höchstens Restschuld plus Zins', () => {
    const [r] = payoffMonth([loan('a', 1000, 12, 1500)], 150000, 'avalanche');
    expect(r).toMatchObject({ interestCents: 1000, regularCents: 101000, balanceAfterCents: 0 });
  });

  it('erkennt „nicht absehbar“, wenn die Rate die Zinsen nicht deckt', () => {
    const s = simulatePayoff([loan('a', 10000, 12, 50)], 0, 'avalanche')!;
    expect(s.stuck).toBe(true);
    expect(s.payoffMonthById.a).toBeNull();
    // Extra-Tilgung kann das beheben
    expect(simulatePayoff([loan('a', 10000, 12, 50)], 20000, 'avalanche')!.stuck).toBe(false);
  });

  it('frei werdende Raten rollen weiter', () => {
    const car = loan('auto', 8400, 5.9, 260);
    const alone = simulatePayoff([car], 0, 'avalanche')!;
    const together = simulatePayoff([car, loan('laptop', 900, 0, 75)], 0, 'avalanche')!;
    expect(together.payoffMonthById.laptop).toBe(12);
    expect(together.payoffMonthById.auto!).toBeLessThan(alone.months);
  });

  describe('Strategien', () => {
    const a = loan('teuer', 1000, 10, 50);
    const b = loan('klein', 500, 2, 50);

    it('Reihenfolge: höchster Zins bzw. kleinste Schuld zuerst, bei Gleichstand Eingabereihenfolge', () => {
      expect(extraPaymentOrder([b, a], 'avalanche').map((l) => l.id)).toEqual(['teuer', 'klein']);
      expect(extraPaymentOrder([a, b], 'snowball').map((l) => l.id)).toEqual(['klein', 'teuer']);
      const c = { ...b, id: 'c' };
      expect(extraPaymentOrder([b, c], 'snowball').map((l) => l.id)).toEqual(['klein', 'c']);
    });

    it('Extra-Tilgung geht an den Kredit, den die Strategie vorsieht', () => {
      const av = payoffMonth([a, b], 20000, 'avalanche');
      expect(av.map((r) => r.extraCents)).toEqual([10000, 0]);
      const sn = payoffMonth([a, b], 20000, 'snowball');
      expect(sn.map((r) => r.extraCents)).toEqual([0, 10000]);
    });

    it('avalanche spart Zinsen, snowball tilgt den kleinen Kredit früher', () => {
      const av = simulatePayoff([a, b], 10000, 'avalanche')!;
      const sn = simulatePayoff([a, b], 10000, 'snowball')!;
      expect(av.totalInterestCents).toBeLessThan(sn.totalInterestCents);
      expect(sn.payoffMonthById.klein!).toBeLessThan(av.payoffMonthById.klein!);
    });
  });

  describe('Vergleich mit dem Prototyp', () => {
    const cases: [string, LoanState[], number][] = [
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
        it(`${name}, ${strategy}: gleiche Laufzeiten, Zinsen bis auf Rundung gleich`, () => {
          const ours = simulatePayoff(ls, extra, strategy)!;
          const proto = prototypeSimulate(toProto(ls), extra / 100, strategy)!;
          expect(ours.stuck).toBe(proto.stuck);
          expect(ours.months).toBe(proto.months);
          expect(ours.payoffMonthById).toEqual(proto.per);
          // Wir runden die Zinsen monatlich auf Cent; Abweichung höchstens 1 Cent pro Kredit und Monat
          const tolerance = ls.length * ours.months;
          expect(Math.abs(ours.totalInterestCents - proto.interest * 100)).toBeLessThanOrEqual(
            tolerance,
          );
        });
      }
    }
  });
});
