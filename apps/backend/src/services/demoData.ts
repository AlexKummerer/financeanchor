import {
  dateInMonth,
  monthOfDate,
  newId,
  type IntervalMonths,
  type IsoDate,
  type RecurringKind,
} from '@financeanchor/shared';

/**
 * Beispieldaten aus dem Prototyp („Beispieldaten laden“), bezogen auf `today`.
 * Fälligkeitstage sind ergänzt, weil der Prototyp keine kannte.
 */
export function demoRows(
  userId: string,
  today: IsoDate,
  categoryIdByName: ReadonlyMap<string, string>,
  now = Date.now(),
) {
  const meta = { userId, createdAt: now, updatedAt: now };
  const month = monthOfDate(today);
  const year = month.slice(0, 4);
  const cat = (name: string) => {
    const id = categoryIdByName.get(name);
    if (!id) throw new Error(`Kategorie fehlt: ${name}`);
    return id;
  };

  const accounts = [
    { name: 'Girokonto', kind: 'checking' as const, balanceCents: 185000, sortOrder: 0 },
    { name: 'Tagesgeld Rücklage', kind: 'savings' as const, balanceCents: 62000, sortOrder: 1 },
    { name: 'Tagesgeld Notgroschen', kind: 'savings' as const, balanceCents: 360000, sortOrder: 2 },
    { name: 'ETF-Depot', kind: 'depot' as const, balanceCents: 730000, sortOrder: 3 },
  ].map((a) => ({ ...a, ...meta, id: newId(now) }));

  const item = (
    name: string,
    euro: number,
    intervalMonths: IntervalMonths,
    kind: RecurringKind,
    startMonth: string,
    category: string,
    dueDay: number,
  ) => ({
    ...meta,
    id: newId(now),
    name,
    amountCents: Math.round(euro * 100),
    intervalMonths,
    kind,
    startMonth,
    categoryId: cat(category),
    reservePotId: null,
    dueDay,
  });
  const recurringItems = [
    item('Gehalt', 3100, 1, 'income', `${year}-01`, 'Gehalt', 28),
    item('Miete warm', 850, 1, 'fixed', `${year}-01`, 'Wohnen', 1),
    item('Strom', 65, 1, 'fixed', `${year}-01`, 'Wohnen', 15),
    item('Handy und Internet', 55, 1, 'fixed', `${year}-01`, 'Abos', 5),
    item('Haftpflicht und Hausrat', 36, 3, 'fixed', month, 'Versicherungen', 1),
    item('Vereinsbeitrag', 60, 12, 'fixed', `${year}-03`, 'Freizeit', 1),
    item('ETF-Sparplan', 200, 1, 'saving', `${year}-01`, 'Sparen', 2),
    item('Bausparvertrag', 150, 3, 'saving', month, 'Sparen', 30),
    item('Kfz-Steuer', 180, 12, 'fixed', `${year}-07`, 'Mobilität', 10),
    item('Kfz-Versicherung Halbjahr', 250, 6, 'fixed', `${year}-01`, 'Versicherungen', 1),
  ];

  const loans = [
    {
      name: 'Autokredit',
      balanceCents: 840000,
      originalCents: 1400000,
      rateBp: 590,
      paymentCents: 26000,
      dueDay: 15,
    },
    {
      name: 'Ratenkauf Laptop',
      balanceCents: 90000,
      originalCents: 150000,
      rateBp: 0,
      paymentCents: 7500,
      dueDay: 1,
    },
  ].map((l) => ({ ...l, ...meta, id: newId(now) }));

  const day = Number(today.slice(8));
  const transactions = (
    [
      [3, 'Edeka', 'Lebensmittel', -6430],
      [5, 'Tankstelle', 'Mobilität', -5800],
      [8, 'Kino', 'Freizeit', -2400],
      [10, 'dm', 'Gesundheit', -1890],
      [12, 'Lidl', 'Lebensmittel', -4120],
      [14, 'Pizzeria', 'Essen gehen', -3200],
    ] as const
  )
    .filter(([d]) => d <= day)
    .map(([d, name, category, amountCents]) => ({
      ...meta,
      id: newId(now),
      date: dateInMonth(month, d),
      name,
      categoryId: cat(category),
      amountCents,
      kind: 'normal' as const,
      sourceType: null,
      sourceId: null,
    }));

  // Verlauf: elf Stände im Abstand von zwei Wochen, wie im Prototyp
  const snapshots = Array.from({ length: 11 }, (_, k) => {
    const i = 10 - k;
    const date = new Date(Date.parse(`${today}T12:00:00Z`) - i * 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const assetsCents = (11500 + (10 - i) * 190 + (i % 3) * 120) * 100;
    const debtCents = (9300 - (10 - i) * 290) * 100;
    return {
      ...meta,
      id: newId(now),
      date,
      assetsCents,
      debtCents,
      netCents: assetsCents - debtCents,
    };
  });

  return {
    accounts,
    reserveAccountId: accounts.find((a) => a.name === 'Tagesgeld Rücklage')?.id ?? null,
    recurringItems,
    loans,
    transactions,
    snapshots,
  };
}
