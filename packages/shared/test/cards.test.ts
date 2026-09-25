import { describe, expect, it } from 'vitest';
import {
  bookedBreakdown,
  cardBalance,
  monthTotals,
  planDue,
  spendingByCategory,
  statementClosingIn,
  statementDebitedIn,
  statementFor,
  statementTotal,
  type DueInput,
} from '../src/index.js';

/** Karte 1: Stichtag 24., Abbuchung am 24. – Amex: Monatsende, Abbuchung am 4. des Folgemonats */
const visa = { id: 'visa', statementDay: 24, debitDay: 24 };
const amex = { id: 'amex', statementDay: 31, debitDay: 4 };

const buy = (date: string, amountCents: number, accountId: string | null) => ({
  date,
  amountCents,
  categoryId: 'essen',
  kind: 'normal' as const,
  accountId,
  sourceType: null,
  sourceId: null,
});
const payment = (date: string, amountCents: number, cardId: string) => ({
  date,
  amountCents: -amountCents,
  categoryId: 'umbuchung',
  kind: 'card_payment' as const,
  accountId: null,
  sourceType: 'account' as const,
  sourceId: cardId,
});

describe('Abrechnungszeiträume', () => {
  it('Stichtag 24.: Käufe 25.08.–24.09., abgebucht am 24.09.', () => {
    expect(statementClosingIn(visa, '2026-09')).toEqual({
      closeMonth: '2026-09',
      from: '2026-08-25',
      to: '2026-09-24',
      debitDate: '2026-09-24',
    });
    expect(statementFor(visa, '2026-09-25').closeMonth).toBe('2026-10');
    expect(statementFor(visa, '2026-09-24').closeMonth).toBe('2026-09');
  });

  it('Amex: der ganze Monat, abgebucht am 4. des Folgemonats; Februar endet am 28.', () => {
    expect(statementClosingIn(amex, '2026-09')).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      debitDate: '2026-10-04',
    });
    expect(statementDebitedIn(amex, '2026-10').closeMonth).toBe('2026-09');
    expect(statementClosingIn(amex, '2027-02')).toMatchObject({
      from: '2027-02-01',
      to: '2027-02-28',
    });
    expect(statementClosingIn(amex, '2027-03').from).toBe('2027-03-01');
  });
});

describe('Summen und Stand', () => {
  const txs = [
    buy('2026-08-30', -2000, 'visa'),
    buy('2026-09-10', -4550, 'visa'),
    buy('2026-09-12', 1000, 'visa'), // Gutschrift
    buy('2026-09-25', -3000, 'visa'), // nächste Abrechnung
    buy('2026-09-15', -9900, 'amex'),
    buy('2026-09-16', -1234, null), // Girokonto
  ];

  it('Summe eines Zeitraums zum Abgleich mit der Bank', () => {
    expect(statementTotal(txs, 'visa', statementClosingIn(visa, '2026-09'))).toEqual({
      amountCents: 2000 + 4550 - 1000,
      count: 3,
    });
    expect(statementTotal(txs, 'amex', statementClosingIn(amex, '2026-09'))).toEqual({
      amountCents: 9900,
      count: 1,
    });
  });

  it('Kartenstand: Startstand plus Käufe, Abbuchung setzt zurück', () => {
    expect(cardBalance(0, txs, 'visa')).toBe(-2000 - 4550 + 1000 - 3000);
    expect(cardBalance(-500, [...txs, payment('2026-09-24', 5550, 'visa')], 'visa')).toBe(
      -500 - 8550 + 5550,
    );
  });

  it('Abbuchung zählt nicht als Ausgabe, die Käufe schon', () => {
    const all = [...txs, payment('2026-09-24', 5550, 'visa')];
    expect(monthTotals(all, '2026-09').expenseCents).toBe(4550 + 3000 + 9900 + 1234);
    expect(spendingByCategory(all, '2026-09').map((r) => r.categoryId)).toEqual(['essen']);
    expect(bookedBreakdown(all, [], '2026-09').otherCents).toBe(4550 + 3000 + 9900 + 1234);
  });
});

describe('Fällige übernehmen', () => {
  const base: DueInput = {
    month: '2026-10',
    today: '2026-10-05',
    items: [],
    pots: [],
    accounts: [
      { id: 'giro', name: 'Girokonto', kind: 'checking' },
      {
        id: 'amex',
        name: 'Amex',
        kind: 'credit_card',
        statementDay: 31,
        debitDay: 4,
        debitAccountId: 'giro',
      },
    ],
    cardTransactions: [buy('2026-09-15', -9900, 'amex'), buy('2026-10-01', -500, 'amex')],
    loans: [],
    systemCategoryIds: { reserve: 'r', transfer: 't', loans: 'l' },
    booked: new Map(),
  };

  it('Abbuchung der September-Abrechnung am 4. Oktober vom Girokonto', () => {
    expect(planDue(base)).toMatchObject([
      {
        key: 'card:amex',
        type: 'card',
        name: 'Abbuchung Amex',
        amountCents: -9900,
        date: '2026-10-04',
        transactionKind: 'card_payment',
        sourceType: 'account',
        sourceId: 'amex',
        categoryId: 't',
        accountDelta: { accountId: 'giro', cents: -9900 },
        bookable: true,
      },
    ]);
  });

  it('ohne Käufe im Zeitraum keine Abbuchung', () => {
    expect(planDue({ ...base, month: '2026-09' })).toEqual([]);
  });
});
