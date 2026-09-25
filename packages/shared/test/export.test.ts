import { describe, expect, it } from 'vitest';
import { EXPORT_VERSION, importFileSchema } from '../src/index.js';

const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const empty = {
  accounts: [],
  reservePots: [],
  categories: [],
  recurringItems: [],
  transactions: [],
  bookedItems: [],
  snapshots: [],
};

describe('Sicherungen', () => {
  it('Version 1 wird auf Version 2 umgerechnet', () => {
    const v1 = {
      format: 'financeanchor-export',
      version: 1,
      exportedAt: '2026-09-25T10:00:00.000Z',
      data: {
        ...empty,
        settings: { extraPaymentCents: 10000, strategy: 'snowball', locale: 'de', currency: 'EUR' },
        loans: [
          {
            id: id(1),
            name: 'Auto',
            balanceCents: 840000,
            originalCents: 1400000,
            rateBp: 590,
            paymentCents: 26000,
            dueDay: 15,
            createdAt: 0,
            updatedAt: 0,
          },
          {
            id: id(2),
            name: 'Alt',
            balanceCents: 0,
            originalCents: 50000,
            rateBp: 0,
            paymentCents: 5000,
            dueDay: 1,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      },
    };
    const r = importFileSchema.parse(v1);
    expect(r.version).toBe(EXPORT_VERSION);
    expect(r.data.settings).toEqual({
      loanBudgetCents: 36000,
      strategy: 'snowball',
      locale: 'de',
      currency: 'EUR',
    });
    expect(r.data.loans[0]).toMatchObject({
      kind: 'installment',
      paymentCents: 26000,
      targetMonth: null,
      dueDate: null,
    });
  });

  it('ohne Extra-Tilgung bleibt das Budget offen', () => {
    const r = importFileSchema.parse({
      format: 'financeanchor-export',
      version: 1,
      exportedAt: '2026-09-25T10:00:00.000Z',
      data: {
        ...empty,
        settings: { extraPaymentCents: 0, strategy: 'avalanche', locale: 'de', currency: 'EUR' },
        loans: [],
      },
    });
    expect(r.data.settings.loanBudgetCents).toBeNull();
  });

  it('Version 2 prüft die Kreditarten', () => {
    const file = {
      format: 'financeanchor-export',
      version: 2,
      exportedAt: '2026-09-25T10:00:00.000Z',
      data: {
        ...empty,
        settings: { loanBudgetCents: null, strategy: 'avalanche', locale: 'de', currency: 'EUR' },
        loans: [
          {
            id: id(3),
            name: 'Privat',
            kind: 'deadline',
            balanceCents: 150000,
            originalCents: 150000,
            rateBp: 0,
            paymentCents: null,
            dueDay: 31,
            targetMonth: null,
            dueDate: '2027-03-31',
            paymentMode: 'spread',
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      },
    };
    expect(importFileSchema.safeParse(file).success).toBe(true);
    file.data.loans[0]!.dueDate = null as never;
    expect(importFileSchema.safeParse(file).success).toBe(false);
  });
});
