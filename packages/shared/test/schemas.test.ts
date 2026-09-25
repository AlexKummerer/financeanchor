import { describe, expect, it } from 'vitest';
import {
  idSchema,
  loanCreateSchema,
  loanShapeIssues,
  newId,
  recurringItemCreateSchema,
  transactionCreateSchema,
  loanUpdateSchema,
  transactionUpdateSchema,
  accountUpdateSchema,
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
    expect(recurringItemCreateSchema.safeParse({ ...base, intervalMonths: 5 }).success).toBe(false);
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

  it('Ratenkredit: Zins in Basispunkten, Rate > 0, Ziel optional', () => {
    const loan = {
      kind: 'installment',
      name: 'Autokredit',
      balanceCents: 840000,
      rateBp: 590,
      paymentCents: 26000,
    };
    const ok = loanCreateSchema.safeParse(loan);
    expect(ok.success).toBe(true);
    expect(ok.data).toMatchObject({ dueDay: 1, targetMonth: null });
    expect(loanCreateSchema.safeParse({ ...loan, paymentCents: 0 }).success).toBe(false);
    expect(loanCreateSchema.safeParse({ ...loan, rateBp: 5.9 }).success).toBe(false);
    expect(loanCreateSchema.safeParse({ ...loan, targetMonth: '2027-03' }).success).toBe(true);
    expect(loanCreateSchema.safeParse({ ...loan, kind: undefined }).success).toBe(false);
  });

  it('„Tilgen bis Datum“: Frist und Zahlweise Pflicht, Zins optional', () => {
    const loan = {
      kind: 'deadline',
      name: 'Privatkredit',
      balanceCents: 150000,
      dueDate: '2027-03-31',
      paymentMode: 'spread',
    };
    const ok = loanCreateSchema.safeParse(loan);
    expect(ok.success).toBe(true);
    expect(ok.data).toMatchObject({ rateBp: 0 });
    expect(loanCreateSchema.safeParse({ ...loan, dueDate: undefined }).success).toBe(false);
    expect(loanCreateSchema.safeParse({ ...loan, paymentMode: 'bald' }).success).toBe(false);
  });

  it('Gesamtstand eines Kredits: Felder passen zur Art', () => {
    const base = {
      kind: 'installment' as const,
      paymentCents: 100,
      targetMonth: null,
      dueDate: null,
      paymentMode: null,
    };
    expect(loanShapeIssues(base)).toEqual([]);
    expect(loanShapeIssues({ ...base, paymentCents: null }).map((i) => i.path)).toEqual([
      'paymentCents',
    ]);
    expect(
      loanShapeIssues({
        ...base,
        kind: 'deadline',
        dueDate: '2027-03-31',
        paymentMode: 'lump',
      }).map((i) => i.path),
    ).toEqual(['paymentCents']);
    expect(
      loanShapeIssues({
        ...base,
        kind: 'deadline',
        paymentCents: null,
        dueDate: '2027-03-31',
        paymentMode: 'lump',
      }),
    ).toEqual([]);
  });
});

describe('Teiländerungen', () => {
  it('setzen fehlende Felder nicht auf Standardwerte zurück', () => {
    expect(loanUpdateSchema.parse({ name: 'Auto' })).toEqual({ name: 'Auto' });
    expect(transactionUpdateSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(accountUpdateSchema.parse({ debitDay: 4 })).toEqual({ debitDay: 4 });
  });
});
