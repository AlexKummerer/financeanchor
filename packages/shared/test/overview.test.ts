import { describe, expect, it } from 'vitest';
import {
  bookedBreakdown,
  monthlyBreakdown,
  monthTotals,
  spendingByCategory,
} from '../src/index.js';
import { items, loans, MONTH, pots } from './fixtures/demo.js';

describe('Monatsübersicht', () => {
  it('teilt die Einnahmen auf wie im Prototyp (ohne Rundung der Rücklage)', () => {
    const b = monthlyBreakdown({
      items,
      pots,
      loans,
      month: MONTH,
    });
    expect(b).toEqual({
      incomeCents: 310000,
      fixedCents: 97000, // Miete 850 + Strom 65 + Handy 55
      reserveCents: 12367,
      loanCents: 33500, // 260 + 75
      savingCents: 20000, // ETF-Sparplan
      freeCents: 310000 - 97000 - 12367 - 33500 - 20000,
    });
  });

  it('Kreditraten inkl. eigener Extra-Tilgung, abbezahlte Kredite zählen nicht', () => {
    const paid = [{ ...loans[1]!, balanceCents: 0 }];
    expect(
      monthlyBreakdown({
        items: [],
        pots,
        loans: [{ ...loans[0]!, extraMonthlyCents: 10000 }, ...paid],
        month: MONTH,
      }).loanCents,
    ).toBe(36000);
    expect(
      monthlyBreakdown({
        items: [],
        pots,
        loans: paid,
        month: MONTH,
      }).loanCents,
    ).toBe(0);
  });

  it('monatliche Posten zählen erst ab ihrem Startmonat', () => {
    const later = [{ ...items[1]!, startMonth: '2026-12' }];
    expect(
      monthlyBreakdown({
        items: later,
        pots,
        loans: [],
        month: MONTH,
      }).fixedCents,
    ).toBe(0);
    expect(
      monthlyBreakdown({
        items: later,
        pots,
        loans: [],
        month: '2026-12',
      }).fixedCents,
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

describe('Gebucht im Monat', () => {
  const its = [
    { id: 'gehalt', kind: 'income' as const, intervalMonths: 1 as const },
    { id: 'miete', kind: 'fixed' as const, intervalMonths: 1 as const },
    { id: 'kfz', kind: 'fixed' as const, intervalMonths: 12 as const },
    { id: 'etf', kind: 'saving' as const, intervalMonths: 1 as const },
  ];
  const tx = (
    amountCents: number,
    kind: 'normal' | 'reserve' | 'transfer' | 'loan_payment',
    sourceType: 'recurring_item' | 'loan' | 'reserve_pot' | null = null,
    sourceId: string | null = null,
    date = '2026-09-05',
  ) => ({ date, amountCents, kind, sourceType, sourceId });

  it('ordnet Buchungen wie den Plan zu; Posten über die Rücklage heben sich mit der Entnahme auf', () => {
    const b = bookedBreakdown(
      [
        tx(300000, 'normal', 'recurring_item', 'gehalt'),
        tx(-90000, 'normal', 'recurring_item', 'miete'),
        tx(-20000, 'reserve', 'reserve_pot', 'pot'),
        tx(-60000, 'normal', 'recurring_item', 'kfz'),
        tx(60000, 'transfer', 'recurring_item', 'kfz'),
        tx(-36499, 'loan_payment', 'loan', 'pb'),
        tx(-10000, 'normal', 'recurring_item', 'etf'),
        tx(-4550, 'normal'),
        tx(2000, 'normal'),
        tx(-99999, 'normal', null, null, '2026-10-01'),
      ],
      its,
      '2026-09',
    );
    expect(b).toEqual({
      incomeCents: 302000,
      fixedCents: 90000,
      reserveCents: 20000,
      loanCents: 36499,
      savingCents: 10000,
      otherCents: 4550,
      restCents: 302000 - 90000 - 20000 - 36499 - 10000 - 4550,
    });
  });

  it('gelöschter Posten: Ausgabe zählt als Fixkosten', () => {
    expect(
      bookedBreakdown([tx(-5000, 'normal', 'recurring_item', 'weg')], its, '2026-09').fixedCents,
    ).toBe(5000);
  });

  it('Kreditzahlungen im Plan lassen sich vorgeben (gebucht plus noch offen)', () => {
    const b = monthlyBreakdown({ items, pots, loans, month: MONTH, loanCents: 12345 });
    expect(b.loanCents).toBe(12345);
  });
});
