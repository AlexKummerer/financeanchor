import { describe, expect, it } from 'vitest';
import { isDue, monthlyShare, nextDueMonth, viaReserve } from '../src/index.js';

const quarterly = { intervalMonths: 3 as const, startMonth: '2026-09', amountCents: 3600 };

describe('Fälligkeit', () => {
  it('ist fällig, wenn (Monat − Startmonat) mod Rhythmus = 0', () => {
    expect(isDue(quarterly, '2026-09')).toBe(true);
    expect(isDue(quarterly, '2026-10')).toBe(false);
    expect(isDue(quarterly, '2026-12')).toBe(true);
    expect(isDue(quarterly, '2027-03')).toBe(true);
  });

  it('ist vor dem Startmonat nie fällig', () => {
    expect(isDue(quarterly, '2026-06')).toBe(false);
    expect(isDue({ intervalMonths: 1, startMonth: '2027-01' }, '2026-12')).toBe(false);
  });

  it('jährlich: nur im Startmonat jedes Jahres', () => {
    const yearly = { intervalMonths: 12 as const, startMonth: '2026-03' };
    expect(isDue(yearly, '2027-03')).toBe(true);
    expect(isDue(yearly, '2027-04')).toBe(false);
  });

  it('alle 4 Monate: dreimal im Jahr, auch über den Jahreswechsel', () => {
    const every4 = { intervalMonths: 4 as const, startMonth: '2026-02', amountCents: 12000 };
    expect(['2026-02', '2026-06', '2026-10', '2027-02'].every((m) => isDue(every4, m))).toBe(true);
    expect(isDue(every4, '2026-12')).toBe(false);
    expect(nextDueMonth(every4, '2026-11')).toBe('2027-02');
    expect(monthlyShare(every4)).toBe(3000);
  });

  it('nächste Fälligkeit', () => {
    expect(nextDueMonth(quarterly, '2026-10')).toBe('2026-12');
    expect(nextDueMonth(quarterly, '2026-12')).toBe('2026-12');
    expect(nextDueMonth(quarterly, '2025-01')).toBe('2026-09');
    expect(nextDueMonth({ intervalMonths: 12, startMonth: '2026-07' }, '2026-09')).toBe('2027-07');
  });
});

describe('Monatsumlage', () => {
  it('Betrag geteilt durch Rhythmus', () => {
    expect(monthlyShare({ amountCents: 42000, intervalMonths: 12 })).toBe(3500);
    expect(monthlyShare({ amountCents: 3600, intervalMonths: 3 })).toBe(1200);
    // 250 € / 6 = 41,666… €
    expect(monthlyShare({ amountCents: 25000, intervalMonths: 6 })).toBe(4167);
  });
});

describe('Rücklage: welche Posten laufen darüber', () => {
  it('ausgehende Posten mit Rhythmus > 1, nie Einnahmen', () => {
    expect(viaReserve({ kind: 'fixed', intervalMonths: 3 })).toBe(true);
    expect(viaReserve({ kind: 'saving', intervalMonths: 12 })).toBe(true);
    expect(viaReserve({ kind: 'fixed', intervalMonths: 1 })).toBe(false);
    expect(viaReserve({ kind: 'income', intervalMonths: 12 })).toBe(false);
  });
});
