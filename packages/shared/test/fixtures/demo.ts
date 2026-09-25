/**
 * Beispieldaten aus dem Prototyp („Beispieldaten laden“), mit „heute“ = 25.09.2026.
 * Startmonate des Prototyps (nur Kalendermonat) sind auf das Jahr 2026 gelegt.
 */
import type { IntervalMonths, RecurringKind } from '../../src/index.js';

export const TODAY = '2026-09-25';
export const MONTH = '2026-09';

export const POT_ID = 'pot-default';
export const RESERVE_ACCOUNT_ID = 'acc-reserve';

const item = (
  id: string,
  amountEuro: number,
  intervalMonths: IntervalMonths,
  kind: RecurringKind,
  startMonth: string,
  categoryId: string,
) => ({
  id,
  name: id,
  amountCents: Math.round(amountEuro * 100),
  intervalMonths,
  kind,
  startMonth,
  categoryId,
  reservePotId: null,
});

export const items = [
  item('Gehalt', 3100, 1, 'income', '2026-01', 'cat-gehalt'),
  item('Miete warm', 850, 1, 'fixed', '2026-01', 'cat-wohnen'),
  item('Strom', 65, 1, 'fixed', '2026-01', 'cat-wohnen'),
  item('Handy und Internet', 55, 1, 'fixed', '2026-01', 'cat-abos'),
  item('Haftpflicht und Hausrat', 36, 3, 'fixed', '2026-09', 'cat-vers'),
  item('Vereinsbeitrag', 60, 12, 'fixed', '2026-03', 'cat-freizeit'),
  item('ETF-Sparplan', 200, 1, 'saving', '2026-01', 'cat-sparen'),
  item('Bausparvertrag', 150, 3, 'saving', '2026-09', 'cat-sparen'),
  item('Kfz-Steuer', 180, 12, 'fixed', '2026-07', 'cat-mobil'),
  item('Kfz-Versicherung Halbjahr', 250, 6, 'fixed', '2026-01', 'cat-vers'),
];

export const pots = [
  { id: POT_ID, monthlyAmountCents: null, isDefault: true, accountId: RESERVE_ACCOUNT_ID },
];

export const loans = [
  {
    id: 'Autokredit',
    balanceCents: 840000,
    originalCents: 1400000,
    rateBp: 590,
    paymentCents: 26000,
  },
  {
    id: 'Ratenkauf Laptop',
    balanceCents: 90000,
    originalCents: 150000,
    rateBp: 0,
    paymentCents: 7500,
  },
];

export const accounts = [
  { id: 'acc-giro', kind: 'checking' as const, balanceCents: 185000 },
  { id: RESERVE_ACCOUNT_ID, kind: 'savings' as const, balanceCents: 62000 },
  { id: 'acc-notgroschen', kind: 'savings' as const, balanceCents: 360000 },
  { id: 'acc-etf', kind: 'depot' as const, balanceCents: 730000 },
];
