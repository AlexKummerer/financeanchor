import { monthlyInterest, type Cents } from '../money.js';
import { dateInMonth, monthOfDate, type IsoDate, type YearMonth } from '../month.js';
import type {
  SourceType,
  Strategy,
  SystemCategoryKey,
  TransactionKind,
} from '../schemas/common.js';
import { bookingKeys } from './bookingKeys.js';
import { extraPaymentOrder, type LoanState } from './loans.js';
import { isDue, viaReserve } from './recurring.js';
import {
  potIdForItem,
  reserveMonthlyAmount,
  reserveNeed,
  type ReserveItemLike,
  type ReservePotLike,
} from './reserve.js';

export type DueEntryType = 'reserve' | 'item' | 'transfer' | 'loan' | 'extra';

export interface DueEntry {
  key: string;
  type: DueEntryType;
  name: string;
  categoryId: string;
  /** Mit Vorzeichen, wie er gebucht wird */
  amountCents: Cents;
  date: IsoDate;
  transactionKind: TransactionKind;
  sourceType: SourceType;
  sourceId: string;
  /** Änderung am Stand eines Kontos (Rücklagenkonto) */
  accountDelta: { accountId: string; cents: Cents } | null;
  /** Änderung der Restschuld (negativ = Tilgung) */
  loanDelta: { loanId: string; cents: Cents } | null;
  /** Monatszins, der in einer Kreditrate steckt */
  interestCents: Cents;
  /** Umbuchung gehört zu dieser Posten-Ausgabe und wird immer mit ihr gebucht */
  linkedKey: string | null;
  booked: boolean;
  /** Offen und bis heute fällig */
  bookable: boolean;
}

export interface DueLabels {
  reserve: (accountName: string | null) => string;
  transfer: (itemName: string) => string;
  loan: (loanName: string) => string;
  extra: (loanName: string) => string;
}

export const germanDueLabels: DueLabels = {
  reserve: (account) => (account ? `Rücklage aufs ${account}` : 'Rücklage'),
  transfer: (name) => `Umbuchung Rücklage: ${name}`,
  loan: (name) => `Rate ${name}`,
  extra: (name) => `Extra-Tilgung ${name}`,
};

export interface DueInput {
  month: YearMonth;
  today: IsoDate;
  items: readonly (ReserveItemLike & { name: string; categoryId: string; dueDay: number })[];
  pots: readonly (ReservePotLike & { accountId: string | null; dueDay: number })[];
  accounts: readonly { id: string; name: string }[];
  loans: readonly (LoanState & { name: string; dueDay: number })[];
  extraPaymentCents: Cents;
  strategy: Strategy;
  systemCategoryIds: Record<SystemCategoryKey, string>;
  /** Bereits gebuchte Schlüssel des Monats mit dem tatsächlich gebuchten Betrag und Datum */
  booked: ReadonlyMap<string, { amountCents: Cents; date: IsoDate }>;
  labels?: DueLabels;
}

type Draft = Omit<DueEntry, 'booked' | 'bookable'>;

/**
 * Alle Fälligkeiten eines Monats: monatliche Rücklage je Topf, fällige Posten (über die Rücklage
 * zusätzlich die Umbuchung), Kreditraten und Extra-Tilgung nach Strategie.
 * Bereits gebuchte Einträge erscheinen mit den tatsächlich gebuchten Werten.
 */
export function planDue(input: DueInput): DueEntry[] {
  const labels = input.labels ?? germanDueLabels;
  const sys = input.systemCategoryIds;
  const defaultPotId = input.pots.find((p) => p.isDefault)?.id ?? input.pots[0]?.id ?? '';
  const potById = new Map(input.pots.map((p) => [p.id, p]));
  const accountName = new Map(input.accounts.map((a) => [a.id, a.name]));
  const drafts: Draft[] = [];

  for (const pot of input.pots) {
    const amount = reserveMonthlyAmount(pot, reserveNeed(input.items, pot.id, defaultPotId));
    if (amount <= 0) continue;
    drafts.push({
      key: bookingKeys.reserve(pot.id),
      type: 'reserve',
      name: labels.reserve(pot.accountId ? (accountName.get(pot.accountId) ?? null) : null),
      categoryId: sys.reserve,
      amountCents: -amount,
      date: dateInMonth(input.month, pot.dueDay),
      transactionKind: 'reserve',
      sourceType: 'reserve_pot',
      sourceId: pot.id,
      accountDelta: pot.accountId ? { accountId: pot.accountId, cents: amount } : null,
      loanDelta: null,
      interestCents: 0,
      linkedKey: null,
    });
  }

  for (const item of input.items) {
    if (!isDue(item, input.month)) continue;
    const date = dateInMonth(input.month, item.dueDay);
    const itemKey = bookingKeys.item(item.id);
    drafts.push({
      key: itemKey,
      type: 'item',
      name: item.name,
      categoryId: item.categoryId,
      amountCents: item.kind === 'income' ? item.amountCents : -item.amountCents,
      date,
      transactionKind: 'normal',
      sourceType: 'recurring_item',
      sourceId: item.id,
      accountDelta: null,
      loanDelta: null,
      interestCents: 0,
      linkedKey: null,
    });
    if (viaReserve(item)) {
      const pot = potById.get(potIdForItem(item, defaultPotId));
      drafts.push({
        key: bookingKeys.transfer(item.id),
        type: 'transfer',
        name: labels.transfer(item.name),
        categoryId: sys.transfer,
        amountCents: item.amountCents,
        date,
        transactionKind: 'transfer',
        sourceType: 'recurring_item',
        sourceId: item.id,
        accountDelta: pot?.accountId
          ? { accountId: pot.accountId, cents: -item.amountCents }
          : null,
        loanDelta: null,
        interestCents: 0,
        linkedKey: itemKey,
      });
    }
  }

  // Kreditraten: Zins auf die aktuelle Restschuld, Rate höchstens Restschuld plus Zins.
  // Ist die Rate schon gebucht, steckt sie bereits in der Restschuld.
  const afterRegular = new Map<string, Cents>();
  for (const loan of input.loans) {
    if (loan.balanceCents <= 0) continue;
    const key = bookingKeys.loan(loan.id);
    if (input.booked.has(key)) {
      afterRegular.set(loan.id, loan.balanceCents);
      drafts.push(loanDraft(loan, key, 'loan', 0, 0, labels, sys.loans, input.month));
      continue;
    }
    const interest = monthlyInterest(loan.balanceCents, loan.rateBp);
    const payment = Math.min(loan.paymentCents, loan.balanceCents + interest);
    afterRegular.set(loan.id, loan.balanceCents + interest - payment);
    drafts.push(loanDraft(loan, key, 'loan', payment, interest, labels, sys.loans, input.month));
  }

  // Extra-Tilgung wird je Monat als Ganzes gebucht.
  const bookedExtras = [...input.booked.keys()].filter((k) => k.startsWith('extra:'));
  if (bookedExtras.length) {
    for (const loan of input.loans) {
      const key = bookingKeys.extra(loan.id);
      if (input.booked.has(key)) {
        drafts.push(loanDraft(loan, key, 'extra', 0, 0, labels, sys.loans, input.month));
      }
    }
  } else if (input.extraPaymentCents > 0) {
    let available = input.extraPaymentCents;
    const open = input.loans
      .filter((l) => (afterRegular.get(l.id) ?? 0) > 0)
      .map((l) => ({ loan: l, balanceCents: afterRegular.get(l.id) ?? 0, rateBp: l.rateBp }));
    for (const { loan, balanceCents } of extraPaymentOrder(open, input.strategy)) {
      if (available <= 0) break;
      const p = Math.min(available, balanceCents);
      available -= p;
      const key = bookingKeys.extra(loan.id);
      drafts.push(loanDraft(loan, key, 'extra', p, 0, labels, sys.loans, input.month));
    }
  }

  return drafts.map((d) => {
    const booked = input.booked.get(d.key);
    if (booked) {
      return {
        ...d,
        amountCents: booked.amountCents,
        date: booked.date,
        booked: true,
        bookable: false,
      };
    }
    return { ...d, booked: false, bookable: d.date <= input.today };
  });
}

function loanDraft(
  loan: { id: string; name: string; dueDay: number },
  key: string,
  type: 'loan' | 'extra',
  payment: Cents,
  interest: Cents,
  labels: DueLabels,
  categoryId: string,
  month: YearMonth,
): Draft {
  return {
    key,
    type,
    name: type === 'loan' ? labels.loan(loan.name) : labels.extra(loan.name),
    categoryId,
    amountCents: -payment,
    date: dateInMonth(month, loan.dueDay),
    transactionKind: 'loan_payment',
    sourceType: 'loan',
    sourceId: loan.id,
    accountDelta: null,
    loanDelta: { loanId: loan.id, cents: interest - payment },
    interestCents: interest,
    linkedKey: null,
  };
}

export interface DueOverride {
  key: string;
  date?: IsoDate | undefined;
  /** Betrag ohne Vorzeichen (> 0); das Vorzeichen ergibt sich aus der Art */
  amountCents?: Cents | undefined;
}

export class DueBookingError extends Error {
  constructor(
    readonly code:
      | 'unknown_key'
      | 'already_booked'
      | 'not_yet_due'
      | 'date_outside_month'
      | 'invalid_amount'
      | 'transfer_not_selectable',
    readonly key: string,
  ) {
    super(`${code}: ${key}`);
    this.name = 'DueBookingError';
  }
}

/**
 * Übernimmt angepasste Tage und Beträge. Eine angepasste Posten-Ausgabe überträgt Tag und Betrag
 * auf ihre Umbuchung. Danach wird `bookable` anhand von `today` neu bestimmt.
 */
export function applyDueOverrides(
  entries: readonly DueEntry[],
  overrides: readonly DueOverride[],
  month: YearMonth,
  today: IsoDate,
): DueEntry[] {
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  for (const o of overrides) {
    const e = entries.find((x) => x.key === o.key);
    if (!e) throw new DueBookingError('unknown_key', o.key);
    if (e.booked) throw new DueBookingError('already_booked', o.key);
    if (e.type === 'transfer') throw new DueBookingError('transfer_not_selectable', o.key);
    if (o.date !== undefined && monthOfDate(o.date) !== month) {
      throw new DueBookingError('date_outside_month', o.key);
    }
    if (
      o.amountCents !== undefined &&
      (!Number.isSafeInteger(o.amountCents) || o.amountCents <= 0)
    ) {
      throw new DueBookingError('invalid_amount', o.key);
    }
  }
  return entries.map((e) => {
    const o = byKey.get(e.linkedKey ?? e.key);
    if (!o || e.booked) return e;
    const date = o.date ?? e.date;
    let next: DueEntry = { ...e, date };
    if (o.amountCents !== undefined) {
      const a = o.amountCents;
      next = { ...next, amountCents: e.amountCents > 0 ? a : -a };
      if (e.accountDelta) {
        next.accountDelta = { ...e.accountDelta, cents: Math.sign(e.accountDelta.cents) * a };
      }
      if (e.loanDelta) {
        next.loanDelta = { ...e.loanDelta, cents: e.interestCents - a };
      }
    }
    return { ...next, bookable: date <= today };
  });
}

/**
 * Wählt die zu buchenden Einträge: die angegebenen Schlüssel oder alle buchbaren.
 * Umbuchungen kommen immer mit ihrer Posten-Ausgabe.
 */
export function selectDueForBooking(
  entries: readonly DueEntry[],
  keys?: readonly string[],
): DueEntry[] {
  let chosen: Set<string>;
  if (keys) {
    chosen = new Set();
    for (const key of keys) {
      const e = entries.find((x) => x.key === key);
      if (!e) throw new DueBookingError('unknown_key', key);
      if (e.type === 'transfer') throw new DueBookingError('transfer_not_selectable', key);
      if (e.booked) throw new DueBookingError('already_booked', key);
      if (!e.bookable) throw new DueBookingError('not_yet_due', key);
      chosen.add(key);
    }
  } else {
    chosen = new Set(entries.filter((e) => e.bookable && e.type !== 'transfer').map((e) => e.key));
  }
  return entries.filter(
    (e) => chosen.has(e.key) || (e.linkedKey !== null && chosen.has(e.linkedKey)),
  );
}

export interface BookingEffects {
  accountDeltas: Map<string, Cents>;
  loanDeltas: Map<string, Cents>;
}

/** Summierte Änderungen an Kontoständen und Restschulden. */
export function bookingEffects(entries: readonly DueEntry[]): BookingEffects {
  const accountDeltas = new Map<string, Cents>();
  const loanDeltas = new Map<string, Cents>();
  for (const e of entries) {
    if (e.accountDelta) {
      const { accountId, cents } = e.accountDelta;
      accountDeltas.set(accountId, (accountDeltas.get(accountId) ?? 0) + cents);
    }
    if (e.loanDelta) {
      const { loanId, cents } = e.loanDelta;
      loanDeltas.set(loanId, (loanDeltas.get(loanId) ?? 0) + cents);
    }
  }
  return { accountDeltas, loanDeltas };
}
