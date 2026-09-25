import { describe, expect, it } from 'vitest';
import {
  bookingKeys,
  reserveForecast,
  reserveMonthlyAmount,
  reserveNeed,
  reserveStatus,
} from '../src/index.js';
import { items, MONTH, POT_ID } from './fixtures/demo.js';

// 36/3 + 60/12 + 150/3 + 180/12 + 250/6 = 123,666… €
const NEED = 12367;

describe('Rücklagenbedarf', () => {
  it('summiert die Umlagen exakt und rundet nur auf ganze Cent auf', () => {
    expect(reserveNeed(items, POT_ID, POT_ID)).toBe(NEED);
  });

  it('eigener Betrag hat Vorrang, 0 oder null bedeutet automatisch', () => {
    expect(reserveMonthlyAmount({ monthlyAmountCents: 15000 }, NEED)).toBe(15000);
    expect(reserveMonthlyAmount({ monthlyAmountCents: null }, NEED)).toBe(NEED);
    expect(reserveMonthlyAmount({ monthlyAmountCents: 0 }, NEED)).toBe(NEED);
  });

  it('Posten eines anderen Topfs zählen nicht zum Standardtopf', () => {
    const withHoliday = [
      ...items,
      {
        id: 'Urlaub',
        amountCents: 120000,
        intervalMonths: 12 as const,
        kind: 'saving' as const,
        startMonth: '2027-06',
        reservePotId: 'pot-urlaub',
      },
    ];
    expect(reserveNeed(withHoliday, POT_ID, POT_ID)).toBe(NEED);
    expect(reserveNeed(withHoliday, 'pot-urlaub', POT_ID)).toBe(10000);
  });
});

describe('Vorschau', () => {
  const base = {
    items,
    potId: POT_ID,
    defaultPotId: POT_ID,
    monthlyAmountCents: NEED,
    startBalanceCents: 62000,
    fromMonth: MONTH,
  };

  it('zeigt den Stand nach den Buchungen jedes Monats', () => {
    const f = reserveForecast(base);
    expect(f).toHaveLength(12);
    expect(f.map((p) => p.month)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07',
      '2027-08',
    ]);
    // Sep: 620 + 123,67 − 36 (Haftpflicht) − 150 (Bausparen)
    expect(f[0]?.balanceCents).toBe(55767);
    // Okt, Nov: nur Einzahlung
    expect(f[2]?.balanceCents).toBe(80501);
    // Jan: − 250 Kfz-Versicherung
    expect(f[4]?.balanceCents).toBe(80501 + NEED - 18600 + NEED - 25000);
    // Jul: − 180 Kfz-Steuer − 250 Kfz-Versicherung
    const jun = f[9]?.balanceCents ?? 0;
    expect(f[10]?.balanceCents).toBe(jun + NEED - 18000 - 25000);
  });

  it('berücksichtigt im laufenden Monat bereits Gebuchtes nicht doppelt', () => {
    const booked = new Set([bookingKeys.reserve(POT_ID), bookingKeys.transfer('Bausparvertrag')]);
    const f = reserveForecast({ ...base, bookedKeysInFromMonth: booked });
    // Kontostand enthält die Einzahlung und die Bauspar-Umbuchung schon; offen ist nur die Haftpflicht
    expect(f[0]?.balanceCents).toBe(62000 - 3600);
    // Ab dem Folgemonat normal
    expect(f[1]?.balanceCents).toBe(62000 - 3600 + NEED);
  });

  it('warnt bei negativem Stand und zu kleinem eigenen Betrag', () => {
    const s = reserveStatus({ ...base, startBalanceCents: 0, pot: { monthlyAmountCents: 5000 } });
    expect(s.needCents).toBe(NEED);
    expect(s.monthlyAmountCents).toBe(5000);
    expect(s.belowNeed).toBe(true);
    expect(s.goesNegative).toBe(true);
    expect(s.lowestBalanceCents).toBeLessThan(0);

    const ok = reserveStatus({ ...base, pot: { monthlyAmountCents: null } });
    expect(ok.belowNeed).toBe(false);
    expect(ok.goesNegative).toBe(false);
  });

  it('ohne Posten über die Rücklage keine Warnungen', () => {
    const s = reserveStatus({
      ...base,
      items: [],
      startBalanceCents: -100,
      pot: { monthlyAmountCents: null },
    });
    expect(s.hasItems).toBe(false);
    expect(s.needCents).toBe(0);
    expect(s.goesNegative).toBe(false);
  });
});
