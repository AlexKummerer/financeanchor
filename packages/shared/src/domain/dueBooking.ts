import type { Cents } from '../money.js';
import { dateInMonth, monthOfDate, type IsoDate, type YearMonth } from '../month.js';
import type { SourceType, SystemCategoryKey, TransactionKind } from '../schemas/common.js';
import type { Account } from '../schemas/entities.js';
import { bookingKeys } from './bookingKeys.js';
import { statementDebitedIn, statementTotal, type CardLike, type StatementDates } from './cards.js';
import { allocateMonth, type PlanLoan } from './loans.js';
import { isDue, viaReserve } from './recurring.js';
import {
  potIdForItem,
  reserveMonthlyAmount,
  reserveNeed,
  type ReserveItemLike,
  type ReservePotLike,
} from './reserve.js';

export type DueEntryType =
  'reserve' | 'item' | 'transfer' | 'withdraw' | 'loan' | 'extra' | 'saving' | 'card';

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
  /** Änderung am Zurückgelegten eines Kredits (Ansparen bzw. Verbrauch bei Fälligkeit) */
  savingDelta: { loanId: string; cents: Cents } | null;
  /** Monatszins, der in einer Kreditrate steckt */
  interestCents: Cents;
  /** Höchstbetrag bei Anpassung (Kredite: offene Restschuld), sonst `null` */
  maxAmountCents: Cents | null;
  /** Umbuchung gehört zu dieser Posten-Ausgabe und wird immer mit ihr gebucht */
  linkedKey: string | null;
  /** Bezahlt mit (Kreditkarte): die Buchung zählt zum Kartenstand */
  paidWith: string | null;
  booked: boolean;
  /** Offen und bis heute fällig */
  bookable: boolean;
}

export interface DueLabels {
  reserve: (accountName: string | null) => string;
  transfer: (itemName: string) => string;
  /** Gesammelte Umbuchung aus der Rücklage */
  withdraw: (accountName: string | null) => string;
  loan: (loanName: string) => string;
  /** Einmalzahlung bei „Tilgen bis Datum“ */
  payment: (loanName: string) => string;
  /** Zurücklegen für eine Einmalzahlung */
  saving: (loanName: string) => string;
  extra: (loanName: string) => string;
  /** Abbuchung einer Kreditkarte */
  card: (cardName: string) => string;
}

export const germanDueLabels: DueLabels = {
  reserve: (account) => (account ? `Rücklage aufs ${account}` : 'Rücklage'),
  transfer: (name) => `Umbuchung Rücklage: ${name}`,
  withdraw: (account) => (account ? `Umbuchung vom ${account}` : 'Umbuchung aus der Rücklage'),
  loan: (name) => `Rate ${name}`,
  payment: (name) => `Zahlung ${name}`,
  saving: (name) => `Rücklage für ${name}`,
  extra: (name) => `Extra-Tilgung ${name}`,
  card: (name) => `Abbuchung ${name}`,
};

export interface DueInput {
  month: YearMonth;
  today: IsoDate;
  items: readonly (ReserveItemLike & {
    name: string;
    categoryId: string;
    dueDay: number;
    accountId?: string | null;
  })[];
  pots: readonly (ReservePotLike & { accountId: string | null; dueDay: number })[];
  accounts: readonly (Pick<Account, 'id' | 'name'> &
    Partial<Pick<Account, 'kind' | 'statementDay' | 'debitDay' | 'debitAccountId'>>)[];
  /** Buchungen der Kreditkarten (für die Summe der Abrechnung) */
  cardTransactions?: readonly Parameters<typeof statementTotal>[0][number][];
  /** Tatsächliche Abrechnungsdaten der Karten, wo sie vom Stichtag abweichen */
  cardStatementDates?: readonly (StatementDates & { accountId: string })[];
  loans: readonly (PlanLoan & { name: string; dueDay: number })[];
  systemCategoryIds: Record<SystemCategoryKey, string>;
  /** Bereits gebuchte Schlüssel des Monats mit dem tatsächlich gebuchten Betrag und Datum */
  booked: ReadonlyMap<string, { amountCents: Cents; date: IsoDate }>;
  labels?: DueLabels;
}

type Draft = Omit<DueEntry, 'booked' | 'bookable'>;

/**
 * Alle Fälligkeiten eines Monats: monatliche Rücklage je Topf, fällige Posten, je Topf eine
 * gesammelte Umbuchung aus der Rücklage für die Posten, die über sie laufen, und die Aufteilung des
 * Kreditbudgets (Raten, Fristen, Extra).
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
      savingDelta: null,
      interestCents: 0,
      maxAmountCents: null,
      linkedKey: null,
      paidWith: null,
    });
  }

  const withdraw = new Map<string, { cents: Cents; date: IsoDate }>();
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
      savingDelta: null,
      interestCents: 0,
      maxAmountCents: null,
      linkedKey: null,
      paidWith: item.accountId ?? null,
    });
    if (!viaReserve(item)) continue;
    const potId = potIdForItem(item, defaultPotId);
    if (!input.booked.has(bookingKeys.transfer(item.id))) {
      // Umgebucht wird gesammelt je Topf (siehe unten)
      const w = withdraw.get(potId) ?? { cents: 0, date };
      withdraw.set(potId, {
        cents: w.cents + item.amountCents,
        date: date < w.date ? date : w.date,
      });
      continue;
    }
    // Früher je Posten gebuchte Umbuchung: bleibt als gebucht sichtbar
    const pot = potById.get(potId);
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
      accountDelta: pot?.accountId ? { accountId: pot.accountId, cents: -item.amountCents } : null,
      loanDelta: null,
      savingDelta: null,
      interestCents: 0,
      maxAmountCents: null,
      linkedKey: itemKey,
      paidWith: null,
    });
  }

  // Umbuchung aus der Rücklage: Summe der in diesem Monat fälligen Posten des Topfs, eine Buchung
  for (const pot of input.pots) {
    const key = bookingKeys.withdraw(pot.id);
    const w = withdraw.get(pot.id);
    if (!w && !input.booked.has(key)) continue;
    const cents = w?.cents ?? 0;
    drafts.push({
      key,
      type: 'withdraw',
      name: labels.withdraw(pot.accountId ? (accountName.get(pot.accountId) ?? null) : null),
      categoryId: sys.transfer,
      amountCents: cents,
      date: w?.date ?? dateInMonth(input.month, 1),
      transactionKind: 'transfer',
      sourceType: 'reserve_pot',
      sourceId: pot.id,
      accountDelta: pot.accountId ? { accountId: pot.accountId, cents: -cents } : null,
      loanDelta: null,
      savingDelta: null,
      interestCents: 0,
      maxAmountCents: null,
      linkedKey: null,
      paidWith: null,
    });
  }

  // Kredite: Raten, Frist-Raten, Zurücklegen und die eigene Extra-Tilgung. Schon gebuchte Raten
  // stecken bereits in der Restschuld. Buchungen gelöschter Kredite spielen keine Rolle.
  const loanIds = new Set(input.loans.map((l) => l.id));
  const loanKeys = [...input.booked.entries()].filter(([k]) => {
    const [prefix, id] = k.split(':');
    return (
      (prefix === 'loan' || prefix === 'extra' || prefix === 'save') &&
      id !== undefined &&
      loanIds.has(id)
    );
  });
  const settled = new Set(
    loanKeys
      .filter(([k]) => k.startsWith('loan:') || k.startsWith('save:'))
      .map(([k]) => k.slice(k.indexOf(':') + 1)),
  );
  const alloc = allocateMonth(input.loans, input.month, {
    settled,
    noExtra: loanKeys.some(([k]) => k.startsWith('extra:')),
  });
  input.loans.forEach((loan, i) => {
    const r = alloc.loans[i];
    if (!r) return;
    const installment = loan.kind === 'installment';
    const lump = loan.kind === 'deadline' && loan.paymentMode === 'lump';
    const push = (
      key: string,
      type: 'loan' | 'extra' | 'saving',
      name: string,
      amount: Cents,
      extra: Partial<Draft>,
    ) => {
      if (input.booked.has(key)) {
        drafts.push(loanDraft(loan, key, type, name, 0, 0, null, sys, input.month));
      } else if (amount > 0) {
        drafts.push({
          ...loanDraft(loan, key, type, name, amount, 0, null, sys, input.month),
          ...extra,
        });
      }
    };
    // Rate bzw. Zahlung an den Kreditgeber
    const payment = installment ? r.regularCents : r.deadlineCents + r.fromSavingsCents;
    push(
      bookingKeys.loan(loan.id),
      'loan',
      lump ? labels.payment(loan.name) : labels.loan(loan.name),
      payment,
      {
        interestCents: r.interestCents,
        loanDelta: { loanId: loan.id, cents: r.interestCents - payment },
        maxAmountCents: r.balanceBeforeCents + r.interestCents,
        savingDelta: r.fromSavingsCents ? { loanId: loan.id, cents: -r.fromSavingsCents } : null,
      },
    );
    // Eigene Extra-Tilgung
    const extra = r.extraCents;
    push(bookingKeys.extra(loan.id), 'extra', labels.extra(loan.name), extra, {
      maxAmountCents: r.balanceAfterCents + extra,
    });
    // Zurücklegen für eine Einmalzahlung
    push(bookingKeys.save(loan.id), 'saving', labels.saving(loan.name), r.savingCents, {
      transactionKind: 'reserve',
      categoryId: sys.reserve,
      loanDelta: null,
      savingDelta: { loanId: loan.id, cents: r.savingCents },
      maxAmountCents: r.balanceBeforeCents + r.interestCents - (r.savedAfterCents - r.savingCents),
    });
  });

  // Kreditkarten: Abbuchung der Abrechnung, die in diesem Monat vom Konto geht – eine Umbuchung
  for (const card of input.accounts) {
    if (card.kind !== 'credit_card' || !card.statementDay || !card.debitDay) continue;
    const dates = (input.cardStatementDates ?? []).filter((d) => d.accountId === card.id);
    const statement = statementDebitedIn(card as CardLike, input.month, dates);
    const total = statementTotal(input.cardTransactions ?? [], card.id, statement).amountCents;
    const key = bookingKeys.card(card.id);
    if (total <= 0 && !input.booked.has(key)) continue;
    drafts.push({
      key,
      type: 'card',
      name: labels.card(card.name),
      categoryId: sys.transfer,
      amountCents: -total,
      date: statement.debitDate,
      transactionKind: 'card_payment',
      sourceType: 'account',
      sourceId: card.id,
      accountDelta: card.debitAccountId ? { accountId: card.debitAccountId, cents: -total } : null,
      loanDelta: null,
      savingDelta: null,
      interestCents: 0,
      maxAmountCents: null,
      linkedKey: null,
      paidWith: null,
    });
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
  loan: { id: string; dueDay: number },
  key: string,
  type: 'loan' | 'extra' | 'saving',
  name: string,
  payment: Cents,
  interest: Cents,
  maxAmountCents: Cents | null,
  sys: Record<SystemCategoryKey, string>,
  month: YearMonth,
): Draft {
  return {
    key,
    type,
    name,
    categoryId: sys.loans,
    amountCents: -payment,
    date: dateInMonth(month, loan.dueDay),
    transactionKind: 'loan_payment',
    sourceType: 'loan',
    sourceId: loan.id,
    accountDelta: null,
    loanDelta: { loanId: loan.id, cents: interest - payment },
    savingDelta: null,
    interestCents: interest,
    maxAmountCents,
    linkedKey: null,
    paidWith: null,
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
      | 'transfer_not_selectable'
      | 'sign_mismatch',
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
      (!Number.isSafeInteger(o.amountCents) ||
        o.amountCents <= 0 ||
        (e.maxAmountCents !== null && o.amountCents > e.maxAmountCents))
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
      if (e.savingDelta) {
        // Ansparen: der angepasste Betrag; Zahlung: höchstens das Angesparte wird verbraucht
        const cents = e.type === 'saving' ? a : -Math.min(-e.savingDelta.cents, a);
        next.savingDelta = { ...e.savingDelta, cents };
      }
    }
    return { ...next, bookable: date <= today };
  });
}

/**
 * Fälligkeiten, die schon von Hand gebucht sind: Tag und Betrag der vorhandenen Buchung gelten
 * (auch für Restschuld und Rücklage), und sie sind buchbar, auch wenn sie laut Plan erst später
 * fällig wären. Zugehörige Umbuchungen folgen.
 */
export function applyDueLinks(
  entries: readonly DueEntry[],
  links: readonly { key: string; date: IsoDate; amountCents: Cents }[],
  month: YearMonth,
  today: IsoDate,
): DueEntry[] {
  for (const l of links) {
    const e = entries.find((x) => x.key === l.key);
    if (!e) throw new DueBookingError('unknown_key', l.key);
    if (Math.sign(e.amountCents) !== Math.sign(l.amountCents)) {
      throw new DueBookingError('sign_mismatch', l.key);
    }
  }
  const withAmounts = applyDueOverrides(
    entries,
    links.map((l) => ({ key: l.key, amountCents: Math.abs(l.amountCents) })),
    month,
    today,
  );
  const byKey = new Map(links.map((l) => [l.key, l]));
  return withAmounts.map((e) => {
    const l = byKey.get(e.linkedKey ?? e.key);
    if (!l || e.booked) return e;
    const date = e.key === l.key || monthOfDate(l.date) === month ? l.date : e.date;
    return { ...e, date, bookable: true };
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
  const bookedKeys = new Set(entries.filter((e) => e.booked).map((e) => e.key));
  // Eine Umbuchung ist nur dann einzeln wählbar, wenn ihre Ausgabe schon gebucht ist.
  const orphan = (e: DueEntry) => e.linkedKey !== null && bookedKeys.has(e.linkedKey);
  let chosen: Set<string>;
  if (keys) {
    chosen = new Set();
    for (const key of keys) {
      const e = entries.find((x) => x.key === key);
      if (!e) throw new DueBookingError('unknown_key', key);
      if (e.booked) throw new DueBookingError('already_booked', key);
      if (e.type === 'transfer' && !orphan(e)) {
        throw new DueBookingError('transfer_not_selectable', key);
      }
      if (!e.bookable) throw new DueBookingError('not_yet_due', key);
      chosen.add(key);
    }
  } else {
    chosen = new Set(
      entries.filter((e) => e.bookable && (e.type !== 'transfer' || orphan(e))).map((e) => e.key),
    );
  }
  return entries.filter(
    (e) => !e.booked && (chosen.has(e.key) || (e.linkedKey !== null && chosen.has(e.linkedKey))),
  );
}

export interface BookingEffects {
  accountDeltas: Map<string, Cents>;
  loanDeltas: Map<string, Cents>;
  savingDeltas: Map<string, Cents>;
}

/**
 * Stand-Datum beachten: Fälligkeiten mit Datum vor dem Stand-Datum eines Kontos bzw. Kredits sind
 * im eingetragenen Stand schon enthalten. Die Buchung entsteht trotzdem (Monatssummen), sie ändert
 * den Stand aber nicht – auch beim Löschen wird dann nichts zurückgerechnet.
 */
export function withoutPastEffects(
  entries: readonly DueEntry[],
  balanceDates: {
    accounts: ReadonlyMap<string, IsoDate | null>;
    loans: ReadonlyMap<string, IsoDate | null>;
  },
): DueEntry[] {
  const past = (since: IsoDate | null | undefined, date: IsoDate) => !!since && date < since;
  return entries.map((e) => ({
    ...e,
    accountDelta:
      e.accountDelta && past(balanceDates.accounts.get(e.accountDelta.accountId), e.date)
        ? null
        : e.accountDelta,
    loanDelta:
      e.loanDelta && past(balanceDates.loans.get(e.loanDelta.loanId), e.date) ? null : e.loanDelta,
    savingDelta:
      e.savingDelta && past(balanceDates.loans.get(e.savingDelta.loanId), e.date)
        ? null
        : e.savingDelta,
  }));
}

/** Summierte Änderungen an Kontoständen und Restschulden. */
export function bookingEffects(entries: readonly DueEntry[]): BookingEffects {
  const accountDeltas = new Map<string, Cents>();
  const loanDeltas = new Map<string, Cents>();
  const savingDeltas = new Map<string, Cents>();
  for (const e of entries) {
    if (e.savingDelta) {
      const { loanId, cents } = e.savingDelta;
      savingDeltas.set(loanId, (savingDeltas.get(loanId) ?? 0) + cents);
    }
    if (e.accountDelta) {
      const { accountId, cents } = e.accountDelta;
      accountDeltas.set(accountId, (accountDeltas.get(accountId) ?? 0) + cents);
    }
    if (e.loanDelta) {
      const { loanId, cents } = e.loanDelta;
      loanDeltas.set(loanId, (loanDeltas.get(loanId) ?? 0) + cents);
    }
  }
  return { accountDeltas, loanDeltas, savingDeltas };
}
