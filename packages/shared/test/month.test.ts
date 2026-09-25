import { describe, expect, it } from 'vitest';
import {
  addMonths,
  dateInMonth,
  daysInMonth,
  isIsoDate,
  isYearMonth,
  monthNumber,
  monthsBetween,
  monthOfDate,
} from '../src/index.js';

describe('Monate', () => {
  it('prüft das Format', () => {
    expect(isYearMonth('2026-09')).toBe(true);
    expect(isYearMonth('2026-13')).toBe(false);
    expect(isYearMonth('2026-9')).toBe(false);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
  });

  it('rechnet über Jahresgrenzen', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2025-10', '2026-09')).toBe(11);
    expect(monthNumber('2026-09')).toBe(9);
    expect(monthOfDate('2026-09-25')).toBe('2026-09');
  });

  it('kennt Monatslängen und begrenzt Tage aufs Monatsende', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2100-02')).toBe(28);
    expect(daysInMonth('2000-02')).toBe(29);
    expect(dateInMonth('2026-02', 31)).toBe('2026-02-28');
    expect(dateInMonth('2026-04', 5)).toBe('2026-04-05');
  });
});
