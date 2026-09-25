import { describe, expect, it } from 'vitest';
import {
  applyDueOverrides,
  bookingEffects,
  DueBookingError,
  planDue,
  selectDueForBooking,
  type DueEntry,
  type DueInput,
} from '../src/index.js';
import {
  items as demoItems,
  loans as demoLoans,
  MONTH,
  POT_ID,
  RESERVE_ACCOUNT_ID,
  TODAY,
} from './fixtures/demo.js';

const dueDays: Record<string, number> = {
  Gehalt: 28,
  'Miete warm': 1,
  Strom: 15,
  'Handy und Internet': 5,
  'Haftpflicht und Hausrat': 1,
  'ETF-Sparplan': 2,
  Bausparvertrag: 30,
};

const base: DueInput = {
  month: MONTH,
  today: TODAY,
  items: demoItems.map((i) => ({ ...i, dueDay: dueDays[i.id] ?? 1 })),
  pots: [
    {
      id: POT_ID,
      monthlyAmountCents: null,
      isDefault: true,
      accountId: RESERVE_ACCOUNT_ID,
      dueDay: 1,
    },
  ],
  accounts: [{ id: RESERVE_ACCOUNT_ID, name: 'Tagesgeld Rücklage' }],
  loans: [
    { ...demoLoans[0]!, name: 'Autokredit', dueDay: 15 },
    { ...demoLoans[1]!, name: 'Ratenkauf Laptop', dueDay: 1 },
  ],
  loanBudgetCents: null,
  strategy: 'avalanche',
  systemCategoryIds: { reserve: 'sys-reserve', transfer: 'sys-transfer', loans: 'sys-loans' },
  booked: new Map(),
};

const byKey = (entries: DueEntry[], key: string) => {
  const e = entries.find((x) => x.key === key);
  if (!e) throw new Error(`fehlt: ${key}`);
  return e;
};

describe('Fällige eines Monats planen', () => {
  const plan = planDue(base);

  it('enthält Rücklage, fällige Posten, Umbuchungen und Kreditraten', () => {
    expect(plan.map((e) => e.key)).toEqual([
      `reserve:${POT_ID}`,
      'item:Gehalt',
      'item:Miete warm',
      'item:Strom',
      'item:Handy und Internet',
      'item:Haftpflicht und Hausrat',
      'transfer:Haftpflicht und Hausrat',
      'item:ETF-Sparplan',
      'item:Bausparvertrag',
      'transfer:Bausparvertrag',
      'loan:Autokredit',
      'loan:Ratenkauf Laptop',
    ]);
  });

  it('Rücklage: Ausgabe an das Rücklagenkonto, dessen Stand steigt', () => {
    expect(byKey(plan, `reserve:${POT_ID}`)).toMatchObject({
      name: 'Rücklage aufs Tagesgeld Rücklage',
      categoryId: 'sys-reserve',
      amountCents: -12367,
      date: '2026-09-01',
      transactionKind: 'reserve',
      accountDelta: { accountId: RESERVE_ACCOUNT_ID, cents: 12367 },
    });
  });

  it('Posten über die Rücklage: Ausgabe plus gleich hohe Umbuchung, die das Konto verringert', () => {
    expect(byKey(plan, 'item:Haftpflicht und Hausrat')).toMatchObject({
      amountCents: -3600,
      categoryId: 'cat-vers',
      transactionKind: 'normal',
      accountDelta: null,
    });
    expect(byKey(plan, 'transfer:Haftpflicht und Hausrat')).toMatchObject({
      name: 'Umbuchung Rücklage: Haftpflicht und Hausrat',
      amountCents: 3600,
      categoryId: 'sys-transfer',
      transactionKind: 'transfer',
      accountDelta: { accountId: RESERVE_ACCOUNT_ID, cents: -3600 },
      linkedKey: 'item:Haftpflicht und Hausrat',
    });
  });

  it('Einnahmen positiv, Fixkosten negativ, jeweils am Fälligkeitstag', () => {
    expect(byKey(plan, 'item:Gehalt')).toMatchObject({ amountCents: 310000, date: '2026-09-28' });
    expect(byKey(plan, 'item:Strom')).toMatchObject({ amountCents: -6500, date: '2026-09-15' });
  });

  it('Kreditrate senkt die Restschuld um den Tilgungsanteil', () => {
    expect(byKey(plan, 'loan:Autokredit')).toMatchObject({
      name: 'Rate Autokredit',
      amountCents: -26000,
      interestCents: 4130,
      loanDelta: { loanId: 'Autokredit', cents: 4130 - 26000 },
      categoryId: 'sys-loans',
      transactionKind: 'loan_payment',
    });
  });

  it('letzte Rate höchstens Restschuld plus Zins', () => {
    const p = planDue({ ...base, loans: [{ ...base.loans[1]!, balanceCents: 5000 }] });
    expect(byKey(p, 'loan:Ratenkauf Laptop')).toMatchObject({
      amountCents: -5000,
      loanDelta: { cents: -5000 },
    });
  });

  it('abbezahlte Kredite erscheinen nicht', () => {
    const p = planDue({ ...base, loans: [{ ...base.loans[1]!, balanceCents: 0 }] });
    expect(p.some((e) => e.type === 'loan')).toBe(false);
  });

  it('buchbar ist nur, was bis heute fällig ist', () => {
    expect(byKey(plan, 'item:Gehalt').bookable).toBe(false); // 28.
    expect(byKey(plan, 'item:Bausparvertrag').bookable).toBe(false); // 30.
    expect(byKey(plan, 'item:Strom').bookable).toBe(true); // 15.
    expect(planDue({ ...base, month: '2026-08' }).every((e) => e.bookable)).toBe(true);
    expect(planDue({ ...base, month: '2026-10' }).some((e) => e.bookable)).toBe(false);
  });

  it('ohne verknüpftes Konto keine Kontoänderung', () => {
    const p = planDue({ ...base, pots: [{ ...base.pots[0]!, accountId: null }] });
    expect(byKey(p, `reserve:${POT_ID}`)).toMatchObject({ name: 'Rücklage', accountDelta: null });
    expect(byKey(p, 'transfer:Haftpflicht und Hausrat').accountDelta).toBeNull();
  });
});

describe('Extra-Tilgung', () => {
  it('geht nach Strategie an einen Kredit und senkt dessen Restschuld vollständig', () => {
    const av = planDue({ ...base, loanBudgetCents: 43500 });
    expect(byKey(av, 'extra:Autokredit')).toMatchObject({
      name: 'Extra-Tilgung Autokredit',
      amountCents: -10000,
      loanDelta: { cents: -10000 },
      date: '2026-09-15',
    });
    const sn = planDue({ ...base, loanBudgetCents: 43500, strategy: 'snowball' });
    expect(byKey(sn, 'extra:Ratenkauf Laptop').amountCents).toBe(-10000);
  });

  it('verteilt einen Rest auf den nächsten Kredit', () => {
    const p = planDue({
      ...base,
      strategy: 'snowball',
      loanBudgetCents: 43500,
      loans: [base.loans[0]!, { ...base.loans[1]!, balanceCents: 9000 }],
    });
    // Laptop: 90 − 75 Rate = 15 € übrig, der Rest geht an den Autokredit
    expect(byKey(p, 'extra:Ratenkauf Laptop').amountCents).toBe(-1500);
    expect(byKey(p, 'extra:Autokredit').amountCents).toBe(-8500);
  });

  it('ist die Rate schon gebucht, wird der Zins nicht erneut angesetzt', () => {
    const p = planDue({
      ...base,
      loanBudgetCents: 1_026_000,
      loans: [{ ...base.loans[0]!, balanceCents: 5000 }],
      booked: new Map([['loan:Autokredit', { amountCents: -26000, date: '2026-09-15' }]]),
    });
    expect(byKey(p, 'extra:Autokredit').amountCents).toBe(-5000);
  });
});

describe('Idempotenz', () => {
  it('bereits Gebuchtes erscheint mit den gebuchten Werten und ist nicht erneut buchbar', () => {
    const booked = new Map([
      ['item:Strom', { amountCents: -7012, date: '2026-09-16' }],
      [`reserve:${POT_ID}`, { amountCents: -12367, date: '2026-09-01' }],
    ]);
    const p = planDue({ ...base, booked });
    expect(byKey(p, 'item:Strom')).toMatchObject({
      booked: true,
      bookable: false,
      amountCents: -7012,
      date: '2026-09-16',
    });
    expect(() => selectDueForBooking(p, ['item:Strom'])).toThrow(DueBookingError);
    expect(selectDueForBooking(p).some((e) => e.booked)).toBe(false);
  });

  it('Extra-Tilgung wird pro Monat nur einmal gebucht', () => {
    const p = planDue({
      ...base,
      loanBudgetCents: 43500,
      booked: new Map([['extra:Autokredit', { amountCents: -10000, date: '2026-09-15' }]]),
    });
    const extras = p.filter((e) => e.type === 'extra');
    expect(extras).toHaveLength(1);
    expect(extras[0]).toMatchObject({ booked: true });
  });
});

describe('Anpassen und Auswählen', () => {
  const plan = planDue(base);

  it('ohne Auswahl: alle buchbaren, Umbuchungen mit ihrem Posten', () => {
    const keys = selectDueForBooking(plan).map((e) => e.key);
    expect(keys).toContain('item:Haftpflicht und Hausrat');
    expect(keys).toContain('transfer:Haftpflicht und Hausrat');
    expect(keys).not.toContain('item:Gehalt');
    expect(keys).not.toContain('transfer:Bausparvertrag');
  });

  it('vorgezogenes Datum macht einen Posten buchbar', () => {
    const adjusted = applyDueOverrides(
      plan,
      [{ key: 'item:Gehalt', date: '2026-09-25' }],
      MONTH,
      TODAY,
    );
    expect(byKey(adjusted, 'item:Gehalt')).toMatchObject({ date: '2026-09-25', bookable: true });
    expect(selectDueForBooking(adjusted, ['item:Gehalt']).map((e) => e.key)).toEqual([
      'item:Gehalt',
    ]);
  });

  it('angepasster Betrag und Tag gelten auch für die Umbuchung', () => {
    const adjusted = applyDueOverrides(
      plan,
      [{ key: 'item:Bausparvertrag', amountCents: 16000, date: '2026-09-20' }],
      MONTH,
      TODAY,
    );
    expect(byKey(adjusted, 'item:Bausparvertrag')).toMatchObject({
      amountCents: -16000,
      bookable: true,
    });
    expect(byKey(adjusted, 'transfer:Bausparvertrag')).toMatchObject({
      amountCents: 16000,
      date: '2026-09-20',
      accountDelta: { cents: -16000 },
    });
  });

  it('angepasste Kreditrate ändert den Tilgungsanteil', () => {
    const adjusted = applyDueOverrides(
      plan,
      [{ key: 'loan:Autokredit', amountCents: 30000 }],
      MONTH,
      TODAY,
    );
    expect(byKey(adjusted, 'loan:Autokredit').loanDelta).toEqual({
      loanId: 'Autokredit',
      cents: 4130 - 30000,
    });
  });

  it('lehnt ungültige Anpassungen ab', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as DueBookingError).code;
      }
      return null;
    };
    expect(
      code(() =>
        applyDueOverrides(plan, [{ key: 'item:Strom', date: '2026-10-01' }], MONTH, TODAY),
      ),
    ).toBe('date_outside_month');
    expect(
      code(() => applyDueOverrides(plan, [{ key: 'item:Strom', amountCents: 0 }], MONTH, TODAY)),
    ).toBe('invalid_amount');
    expect(
      code(() =>
        applyDueOverrides(plan, [{ key: 'transfer:Bausparvertrag', amountCents: 1 }], MONTH, TODAY),
      ),
    ).toBe('transfer_not_selectable');
    expect(code(() => applyDueOverrides(plan, [{ key: 'item:gibtsnicht' }], MONTH, TODAY))).toBe(
      'unknown_key',
    );
    expect(code(() => selectDueForBooking(plan, ['item:Gehalt']))).toBe('not_yet_due');
  });
});

describe('Wirkung der Buchungen', () => {
  it('summiert Konto- und Restschuldänderungen', () => {
    const plan = planDue({ ...base, month: '2026-08', today: '2026-09-25' });
    const { accountDeltas, loanDeltas } = bookingEffects(selectDueForBooking(plan));
    // August: Rücklage rein, nichts über die Rücklage fällig
    expect(accountDeltas.get(RESERVE_ACCOUNT_ID)).toBe(12367);
    expect(loanDeltas.get('Autokredit')).toBe(4130 - 26000);
    expect(loanDeltas.get('Ratenkauf Laptop')).toBe(-7500);
  });

  it('im September: Rücklage minus Umbuchungen', () => {
    const plan = planDue({ ...base, today: '2026-09-30' });
    const { accountDeltas } = bookingEffects(selectDueForBooking(plan));
    expect(accountDeltas.get(RESERVE_ACCOUNT_ID)).toBe(12367 - 3600 - 15000);
  });
});

describe('Obergrenze bei Kreditbeträgen', () => {
  it('Rate höchstens Restschuld plus Zins', () => {
    const plan = planDue(base);
    const loan = plan.find((e) => e.key === 'loan:Ratenkauf Laptop')!;
    expect(loan.maxAmountCents).toBe(90000);
    expect(() =>
      applyDueOverrides(plan, [{ key: 'loan:Ratenkauf Laptop', amountCents: 90001 }], MONTH, TODAY),
    ).toThrow(DueBookingError);
    expect(
      applyDueOverrides(
        plan,
        [{ key: 'loan:Ratenkauf Laptop', amountCents: 90000 }],
        MONTH,
        TODAY,
      ).find((e) => e.key === 'loan:Ratenkauf Laptop')!.loanDelta,
    ).toEqual({ loanId: 'Ratenkauf Laptop', cents: -90000 });
  });
});

describe('Ausgabe gebucht, Umbuchung wieder offen', () => {
  it('Umbuchung ist dann einzeln und ohne Auswahl buchbar', () => {
    const plan = planDue({
      ...base,
      booked: new Map([
        ['item:Haftpflicht und Hausrat', { amountCents: -3600, date: '2026-09-01' }],
      ]),
    });
    expect(selectDueForBooking(plan).map((e) => e.key)).toContain(
      'transfer:Haftpflicht und Hausrat',
    );
    expect(
      selectDueForBooking(plan, ['transfer:Haftpflicht und Hausrat']).map((e) => e.key),
    ).toEqual(['transfer:Haftpflicht und Hausrat']);
  });
});

describe('Umbuchung schon gebucht, Ausgabe wieder offen', () => {
  it('bucht nur die Ausgabe erneut', () => {
    const plan = planDue({
      ...base,
      booked: new Map([
        ['transfer:Haftpflicht und Hausrat', { amountCents: 3600, date: '2026-09-01' }],
      ]),
    });
    expect(selectDueForBooking(plan, ['item:Haftpflicht und Hausrat']).map((e) => e.key)).toEqual([
      'item:Haftpflicht und Hausrat',
    ]);
  });
});
