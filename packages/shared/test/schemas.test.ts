import { describe, expect, it } from 'vitest';
import {
  idSchema,
  loanCreateSchema,
  newId,
  recurringItemCreateSchema,
  transactionCreateSchema,
} from '../src/index.js';

const categoryId = newId();

describe('newId', () => {
  it('erzeugt gültige, zeitlich sortierbare UUID v7', () => {
    const a = newId(1_700_000_000_000);
    const b = newId(1_700_000_000_001);
    expect(idSchema.safeParse(a).success).toBe(true);
    expect(a[14]).toBe('7');
    expect(a < b).toBe(true);
    expect(newId()).not.toBe(newId());
  });
});

describe('Schemas', () => {
  it('akzeptiert einen gültigen Posten', () => {
    const r = recurringItemCreateSchema.safeParse({
      name: 'Kfz-Steuer',
      amountCents: 18000,
      intervalMonths: 12,
      startMonth: '2026-07',
      kind: 'fixed',
      categoryId,
    });
    expect(r.success).toBe(true);
  });

  it('lehnt ungültige Rhythmen, Kommabeträge und leere Namen ab', () => {
    const base = {
      name: 'X',
      amountCents: 100,
      intervalMonths: 1,
      startMonth: '2026-01',
      kind: 'fixed',
      categoryId,
    };
    expect(recurringItemCreateSchema.safeParse({ ...base, intervalMonths: 4 }).success).toBe(false);
    expect(recurringItemCreateSchema.safeParse({ ...base, amountCents: 1.5 }).success).toBe(false);
    expect(recurringItemCreateSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
    expect(recurringItemCreateSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(recurringItemCreateSchema.safeParse({ ...base, startMonth: '2026-1' }).success).toBe(
      false,
    );
  });

  it('Buchungen: Vorzeichen erlaubt, 0 nicht, Datum muss existieren', () => {
    const tx = { date: '2026-09-03', name: 'Edeka', categoryId, amountCents: -6430 };
    expect(transactionCreateSchema.safeParse(tx).success).toBe(true);
    expect(transactionCreateSchema.safeParse({ ...tx, amountCents: 0 }).success).toBe(false);
    expect(transactionCreateSchema.safeParse({ ...tx, date: '2026-02-30' }).success).toBe(false);
  });

  it('Kredite: Zins in Basispunkten, Rate > 0', () => {
    const loan = { name: 'Autokredit', balanceCents: 840000, rateBp: 590, paymentCents: 26000 };
    expect(loanCreateSchema.safeParse(loan).success).toBe(true);
    expect(loanCreateSchema.safeParse({ ...loan, paymentCents: 0 }).success).toBe(false);
    expect(loanCreateSchema.safeParse({ ...loan, rateBp: 5.9 }).success).toBe(false);
  });
});
