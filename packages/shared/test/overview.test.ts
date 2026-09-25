import { describe, expect, it } from 'vitest';
import { monthlyBreakdown, monthTotals, spendingByCategory } from '../src/index.js';
import { items, loans, MONTH, pots } from './fixtures/demo.js';

describe('Monatsübersicht', () => {
  it('teilt die Einnahmen auf wie im Prototyp (ohne Rundung der Rücklage)', () => {
    const b = monthlyBreakdown({ items, pots, loans, extraPaymentCents: 0, month: MONTH });
    expect(b).toEqual({
      incomeCents: 310000,
      fixedCents: 97000, // Miete 850 + Strom 65 + Handy 55
      reserveCents: 12367,
      loanCents: 33500, // 260 + 75
      savingCents: 20000, // ETF-Sparplan
      freeCents: 310000 - 97000 - 12367 - 33500 - 20000,
    });
  });

  it('Extra-Tilgung zählt zu den Kreditraten, abbezahlte Kredite nicht', () => {
    const paid = [{ ...loans[1]!, balanceCents: 0 }];
    expect(
      monthlyBreakdown({
        items: [],
        pots,
        loans: [loans[0]!, ...paid],
        extraPaymentCents: 10000,
        month: MONTH,
      }).loanCents,
    ).toBe(36000);
    expect(
      monthlyBreakdown({ items: [], pots, loans: paid, extraPaymentCents: 10000, month: MONTH })
        .loanCents,
    ).toBe(0);
  });

  it('monatliche Posten zählen erst ab ihrem Startmonat', () => {
    const later = [{ ...items[1]!, startMonth: '2026-12' }];
    expect(
      monthlyBreakdown({ items: later, pots, loans: [], extraPaymentCents: 0, month: MONTH })
        .fixedCents,
    ).toBe(0);
    expect(
      monthlyBreakdown({ items: later, pots, loans: [], extraPaymentCents: 0, month: '2026-12' })
        .fixedCents,
    ).toBe(85000);
  });

  it('Einnahmen mit längerem Rhythmus werden umgelegt, laufen aber nicht über die Rücklage', () => {
    const bonus = [
      {
        id: 'b',
        amountCents: 120000,
        intervalMonths: 12 as const,
        kind: 'income' as const,
        startMonth: '2026-03',
        reservePotId: null,
      },
    ];
    const b = monthlyBreakdown({
      items: bonus,
      pots,
      loans: [],
      extraPaymentCents: 0,
      month: MONTH,
    });
    expect(b.incomeCents).toBe(10000);
    expect(b.reserveCents).toBe(0);
  });
});

describe('Buchungen eines Monats', () => {
  const tx = [
    { date: '2026-09-03', amountCents: -6430, categoryId: 'lebensmittel' },
    { date: '2026-09-05', amountCents: -5800, categoryId: 'mobil' },
    { date: '2026-09-12', amountCents: -4120, categoryId: 'lebensmittel' },
    { date: '2026-09-28', amountCents: 310000, categoryId: 'gehalt' },
    { date: '2026-08-30', amountCents: -9999, categoryId: 'lebensmittel' },
  ];

  it('summiert Einnahmen und Ausgaben', () => {
    expect(monthTotals(tx, MONTH)).toEqual({
      incomeCents: 310000,
      expenseCents: 16350,
      balanceCents: 310000 - 16350,
    });
  });

  it('gruppiert Ausgaben nach Kategorie, größte zuerst', () => {
    expect(spendingByCategory(tx, MONTH)).toEqual([
      { categoryId: 'lebensmittel', amountCents: 10550 },
      { categoryId: 'mobil', amountCents: 5800 },
    ]);
  });
});
