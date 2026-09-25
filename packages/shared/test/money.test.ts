import { describe, expect, it } from 'vitest';
import {
  isCents,
  monthlyInterest,
  parseEuroToCents,
  parsePercentToBasisPoints,
  roundHalfAwayFromZero,
  sumCents,
} from '../src/index.js';

describe('parseEuroToCents', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50', 1250],
    ['0,99', 99],
    ['1.234,56', 123456],
    ['1.234', 123400],
    ['12.50', 1250],
    ['12.5', 1250],
    ['1.234.567,89', 123456789],
    [' 64,30 € ', 6430],
    ['-58', -5800],
    [',5', 50],
    ['12,', 1200], // beim Tippen üblich
  ])('%s → %i Cent', (input, cents) => {
    expect(parseEuroToCents(input)).toBe(cents);
  });

  it.each(['', ',', 'abc', '12,345', '1,2,3', '12.345.6', '1.23.4', '--1', '12..5'])(
    'lehnt „%s“ ab',
    (input) => {
      expect(parseEuroToCents(input)).toBeNull();
    },
  );

  it('lehnt Beträge über dem Maximum ab', () => {
    expect(parseEuroToCents('2.000.000.000')).toBeNull();
  });
});

describe('parsePercentToBasisPoints', () => {
  it.each([
    ['5,9', 590],
    ['5.9', 590],
    ['0', 0],
    ['12,25 %', 1225],
  ])('%s → %i bp', (input, bp) => {
    expect(parsePercentToBasisPoints(input)).toBe(bp);
  });
  it('lehnt ungültige Werte ab', () => {
    expect(parsePercentToBasisPoints('5,999')).toBeNull();
    expect(parsePercentToBasisPoints('x')).toBeNull();
    expect(parsePercentToBasisPoints('101')).toBeNull();
  });
});

describe('monthlyInterest', () => {
  it('berechnet Saldo × Zins / 12 auf Cent gerundet', () => {
    // 8.400 € × 5,9 % / 12 = 41,30 €
    expect(monthlyInterest(840000, 590)).toBe(4130);
    // 1.000 € × 5 % / 12 = 4,1666… € → 4,17 €
    expect(monthlyInterest(100000, 500)).toBe(417);
  });
  it('ist 0 bei 0 % oder ohne Saldo', () => {
    expect(monthlyInterest(90000, 0)).toBe(0);
    expect(monthlyInterest(0, 590)).toBe(0);
  });
  it('bleibt bei Höchstwerten ganzzahlig', () => {
    expect(Number.isSafeInteger(monthlyInterest(100_000_000_000, 10_000))).toBe(true);
  });
});

describe('Hilfsfunktionen', () => {
  it('sumCents, isCents, roundHalfAwayFromZero', () => {
    expect(sumCents([100, -50, 25])).toBe(75);
    expect(isCents(12)).toBe(true);
    expect(isCents(1.5)).toBe(false);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
  });
});
