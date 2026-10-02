import { describe, expect, it } from 'vitest';
import { subscriptionCandidates, templateSuggestions } from '../src/index.js';

describe('Vorlage anpassen', () => {
  const items = [
    { id: 'strom', amountCents: 9000 },
    { id: 'miete', amountCents: 85000 },
  ];
  it('zweimal derselbe abweichende Betrag', () => {
    expect(
      templateSuggestions(items, [
        { itemId: 'strom', month: '2026-08', amountCents: -9480 },
        { itemId: 'strom', month: '2026-09', amountCents: -9480 },
        { itemId: 'strom', month: '2026-07', amountCents: -9000 },
        { itemId: 'miete', month: '2026-09', amountCents: -85000 },
        { itemId: 'miete', month: '2026-08', amountCents: -85000 },
      ]),
    ).toEqual([{ itemId: 'strom', amountCents: 9480 }]);
  });
  it('nur einmal abweichend oder schwankend: kein Vorschlag', () => {
    expect(
      templateSuggestions(items, [
        { itemId: 'strom', month: '2026-09', amountCents: -9480 },
        { itemId: 'strom', month: '2026-08', amountCents: -9000 },
      ]),
    ).toEqual([]);
    expect(
      templateSuggestions(items, [
        { itemId: 'strom', month: '2026-09', amountCents: -9480 },
        { itemId: 'strom', month: '2026-08', amountCents: -9300 },
      ]),
    ).toEqual([]);
  });
});

describe('Abos erkennen', () => {
  const tx = (
    date: string,
    name: string,
    amountCents: number,
    importLabel: string | null = null,
  ) => ({
    date,
    name,
    amountCents,
    categoryId: 'c-abo',
    accountId: 'amex',
    importLabel,
  });
  it('gleicher Bank-Text in zwei Monaten, ähnlicher Betrag', () => {
    const c = subscriptionCandidates(
      [
        tx('2026-08-15', 'PAYPAL *DISNEYPLUS 811', -899, 'paypal *disneyplus'),
        tx('2026-09-15', 'Disney+', -899, 'paypal *disneyplus'),
        tx('2026-09-03', 'Rewe', -4210),
        tx('2026-09-20', 'Rewe', -1999),
        tx('2026-08-03', 'Rewe', -6000),
      ],
      [{ name: 'Miete' }],
      '2026-09-28',
    );
    expect(c).toEqual([
      {
        key: 'paypal *disneyplus',
        name: 'Disney+',
        amountCents: 899,
        dueDay: 15,
        categoryId: 'c-abo',
        accountId: 'amex',
        months: 2,
      },
    ]);
  });
  it('schon als Posten geführt oder zu alt: kein Vorschlag', () => {
    const txs = [tx('2026-08-15', 'Netflix', -1399), tx('2026-09-15', 'Netflix', -1399)];
    expect(subscriptionCandidates(txs, [{ name: 'Netflix Abo' }], '2026-09-28')).toEqual([]);
    expect(subscriptionCandidates(txs, [], '2026-12-01')).toEqual([]);
  });
});
