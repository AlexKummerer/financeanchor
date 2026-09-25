import type { Cents } from '../money.js';
import { addMonths, type YearMonth } from '../month.js';
import type { ReservePot } from '../schemas/entities.js';
import { bookingKeys } from './bookingKeys.js';
import { isDue, monthlyShareTimes12, viaReserve, type RecurringLike } from './recurring.js';

export type ReserveItemLike = RecurringLike & { reservePotId: string | null };
export type ReservePotLike = Pick<ReservePot, 'id' | 'monthlyAmountCents' | 'isDefault'>;

/** Topf, über den ein Posten läuft: der zugeordnete oder der Standardtopf. */
export function potIdForItem(item: Pick<ReserveItemLike, 'reservePotId'>, defaultPotId: string) {
  return item.reservePotId ?? defaultPotId;
}

/** Alle Posten, die über den angegebenen Topf laufen. */
export function reserveItems<T extends ReserveItemLike>(
  items: readonly T[],
  potId: string,
  defaultPotId: string,
): T[] {
  return items.filter((i) => viaReserve(i) && potIdForItem(i, defaultPotId) === potId);
}

/**
 * Rechnerischer Monatsbedarf eines Topfs: Summe der Umlagen, exakt gerechnet und nur auf den
 * nächsten ganzen Cent aufgerundet.
 */
export function reserveNeed(
  items: readonly ReserveItemLike[],
  potId: string,
  defaultPotId: string,
) {
  const times12 = reserveItems(items, potId, defaultPotId).reduce(
    (sum, i) => sum + monthlyShareTimes12(i),
    0,
  );
  return Math.ceil(times12 / 12);
}

/** Monatlicher Rücklagenbetrag: eigener Betrag, wenn gesetzt (> 0), sonst der Bedarf. */
export function reserveMonthlyAmount(pot: Pick<ReservePotLike, 'monthlyAmountCents'>, need: Cents) {
  return pot.monthlyAmountCents && pot.monthlyAmountCents > 0 ? pot.monthlyAmountCents : need;
}

export interface ReserveForecastInput {
  items: readonly ReserveItemLike[];
  potId: string;
  defaultPotId: string;
  monthlyAmountCents: Cents;
  /** Aktueller Stand des verknüpften Kontos (0, wenn keins verknüpft ist). */
  startBalanceCents: Cents;
  fromMonth: YearMonth;
  /** Im Startmonat bereits gebuchte Schlüssel – deren Wirkung steckt schon im Kontostand. */
  bookedKeysInFromMonth?: ReadonlySet<string>;
  months?: number;
}

export interface ReserveForecastPoint {
  month: YearMonth;
  balanceCents: Cents;
}

/** Voraussichtlicher Stand des Topfs, jeweils nach den Buchungen des Monats. */
export function reserveForecast(input: ReserveForecastInput): ReserveForecastPoint[] {
  const booked = input.bookedKeysInFromMonth ?? new Set<string>();
  const items = reserveItems(input.items, input.potId, input.defaultPotId);
  const out: ReserveForecastPoint[] = [];
  let balance = input.startBalanceCents;
  for (let i = 0; i < (input.months ?? 12); i++) {
    const month = addMonths(input.fromMonth, i);
    const first = i === 0;
    if (!(first && booked.has(bookingKeys.reserve(input.potId)))) {
      balance += input.monthlyAmountCents;
    }
    for (const item of items) {
      if (!isDue(item, month)) continue;
      if (first && booked.has(bookingKeys.transfer(item.id))) continue;
      balance -= item.amountCents;
    }
    out.push({ month, balanceCents: balance });
  }
  return out;
}

export interface ReserveStatus {
  needCents: Cents;
  monthlyAmountCents: Cents;
  hasItems: boolean;
  forecast: ReserveForecastPoint[];
  lowestBalanceCents: Cents | null;
  /** Eigener Betrag liegt unter dem Bedarf. */
  belowNeed: boolean;
  /** Stand wird in der Vorschau negativ. */
  goesNegative: boolean;
}

/** Bedarf, Monatsbetrag, Vorschau und Warnungen für einen Topf. */
export function reserveStatus(
  input: Omit<ReserveForecastInput, 'monthlyAmountCents'> & {
    pot: Pick<ReservePotLike, 'monthlyAmountCents'>;
  },
): ReserveStatus {
  const needCents = reserveNeed(input.items, input.potId, input.defaultPotId);
  const monthlyAmountCents = reserveMonthlyAmount(input.pot, needCents);
  const hasItems = reserveItems(input.items, input.potId, input.defaultPotId).length > 0;
  const forecast = reserveForecast({ ...input, monthlyAmountCents });
  const lowestBalanceCents = forecast.length
    ? Math.min(...forecast.map((p) => p.balanceCents))
    : null;
  return {
    needCents,
    monthlyAmountCents,
    hasItems,
    forecast,
    lowestBalanceCents,
    belowNeed: hasItems && monthlyAmountCents < needCents,
    goesNegative: hasItems && lowestBalanceCents !== null && lowestBalanceCents < 0,
  };
}
