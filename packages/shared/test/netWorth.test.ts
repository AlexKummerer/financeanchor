import { describe, expect, it } from 'vitest';
import { netWorth, netWorthChange } from '../src/index.js';
import { accounts, loans } from './fixtures/demo.js';

describe('Nettovermögen', () => {
  it('Konten und Depots minus Restschulden', () => {
    expect(netWorth(accounts, loans)).toEqual({
      assetsCents: 1337000,
      debtCents: 930000,
      netCents: 407000,
    });
  });

  it('Veränderung seit dem vorletzten Stand', () => {
    expect(netWorthChange([{ date: '2026-09-01', netCents: 100 }])).toBeNull();
    expect(
      netWorthChange([
        { date: '2026-09-15', netCents: 500 },
        { date: '2026-09-01', netCents: 100 },
      ]),
    ).toEqual({ deltaCents: 400, sinceDate: '2026-09-01' });
  });
});
