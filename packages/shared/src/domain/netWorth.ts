import type { Cents } from '../money.js';
import type { IsoDate } from '../month.js';

export interface NetWorth {
  assetsCents: Cents;
  debtCents: Cents;
  netCents: Cents;
}

/** Summe der Konten und Depots minus Restschulden der Kredite. */
export function netWorth(
  accounts: readonly { balanceCents: Cents }[],
  loans: readonly { balanceCents: Cents }[],
): NetWorth {
  const assetsCents = accounts.reduce((s, a) => s + a.balanceCents, 0);
  const debtCents = loans.reduce((s, l) => s + Math.max(0, l.balanceCents), 0);
  return { assetsCents, debtCents, netCents: assetsCents - debtCents };
}

/** Veränderung des Nettovermögens zwischen den letzten beiden Ständen. */
export function netWorthChange(
  snapshots: readonly { date: IsoDate; netCents: Cents }[],
): { deltaCents: Cents; sinceDate: IsoDate } | null {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const cur = sorted.at(-1);
  const prev = sorted.at(-2);
  if (!cur || !prev) return null;
  return { deltaCents: cur.netCents - prev.netCents, sinceDate: prev.date };
}
