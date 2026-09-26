import type { Cents } from '../money.js';
import { addMonths, dateInMonth, monthOfDate, type IsoDate, type YearMonth } from '../month.js';
import type { Account, Transaction } from '../schemas/entities.js';

export type CardLike = Pick<Account, 'id' | 'statementDay' | 'debitDay'>;
type CardTransaction = Pick<
  Transaction,
  'date' | 'amountCents' | 'kind' | 'accountId' | 'sourceType' | 'sourceId'
> &
  Partial<Pick<Transaction, 'statementMonth'>>;

export interface Statement {
  /** Monat, in dem der Abrechnungszeitraum endet */
  closeMonth: YearMonth;
  /** Erster Tag des Zeitraums (Tag nach dem vorigen Stichtag) */
  from: IsoDate;
  /** Stichtag (einschließlich) */
  to: IsoDate;
  /** Tag der Abbuchung vom Konto */
  debitDate: IsoDate;
}

function nextDay(date: IsoDate): IsoDate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Wird am Abbuchungstag im Monat des Stichtags abgebucht (sonst im Folgemonat)? */
function debitSameMonth(card: CardLike): boolean {
  return (card.debitDay ?? 1) >= (card.statementDay ?? 31);
}

/**
 * Tatsächliche Daten einer Abrechnung laut Bank, wenn sie vom Stichtag in den Einstellungen
 * abweichen (der Stichtag schwankt bei manchen Karten von Monat zu Monat).
 */
export interface StatementDates {
  /** Monat des Stichtags der Abrechnung */
  closeMonth: YearMonth;
  closingDate: IsoDate;
  debitDate: IsoDate | null;
}

function datesFor(dates: readonly StatementDates[], closeMonth: YearMonth) {
  return dates.find((d) => d.closeMonth === closeMonth) ?? null;
}

/** Abrechnung, deren Zeitraum im angegebenen Monat endet. */
export function statementClosingIn(
  card: CardLike,
  closeMonth: YearMonth,
  dates: readonly StatementDates[] = [],
): Statement {
  const day = card.statementDay ?? 31;
  const own = datesFor(dates, closeMonth);
  const previous = datesFor(dates, addMonths(closeMonth, -1));
  const to = own?.closingDate ?? dateInMonth(closeMonth, day);
  const from = nextDay(previous?.closingDate ?? dateInMonth(addMonths(closeMonth, -1), day));
  const debitMonth = debitSameMonth(card) ? closeMonth : addMonths(closeMonth, 1);
  const debitDate = own?.debitDate ?? dateInMonth(debitMonth, card.debitDay ?? 1);
  return { closeMonth, from, to, debitDate };
}

/** Abrechnung, die im angegebenen Monat abgebucht wird. */
export function statementDebitedIn(
  card: CardLike,
  month: YearMonth,
  dates: readonly StatementDates[] = [],
): Statement {
  // Mit abweichendem Abbuchungsdatum kann auch die andere Abrechnung in diesen Monat fallen
  const candidates = [month, addMonths(month, -1)].map((m) => statementClosingIn(card, m, dates));
  return (
    candidates.find((st) => monthOfDate(st.debitDate) === month) ??
    statementClosingIn(card, debitSameMonth(card) ? month : addMonths(month, -1), dates)
  );
}

/** Abrechnungszeitraum, in den ein Kauf an diesem Tag fällt. */
export function statementFor(
  card: CardLike,
  date: IsoDate,
  dates: readonly StatementDates[] = [],
): Statement {
  const month = monthOfDate(date);
  const current = statementClosingIn(card, month, dates);
  if (date > current.to) return statementClosingIn(card, addMonths(month, 1), dates);
  if (date < current.from) return statementClosingIn(card, addMonths(month, -1), dates);
  return current;
}

/** Käufe (negativ) und Gutschriften (positiv) mit dieser Karte, ohne die Abbuchungen. */
function isPurchase(t: CardTransaction, cardId: string): boolean {
  return t.accountId === cardId && t.kind !== 'card_payment';
}

/** Abbuchung dieser Karte vom Konto. */
function isPaymentFor(t: CardTransaction, cardId: string): boolean {
  return t.kind === 'card_payment' && t.sourceType === 'account' && t.sourceId === cardId;
}

/**
 * Gehört die Buchung zu dieser Abrechnung? Normalerweise nach Datum; am Stichtag kann die Bank je
 * nach Uhrzeit schon die nächste Abrechnung nehmen – dann ist die Abrechnung an der Buchung
 * festgehalten (`statementMonth` = Monat des Stichtags der Abrechnung).
 */
export function inStatement(
  t: Pick<CardTransaction, 'date' | 'statementMonth'>,
  statement: Pick<Statement, 'from' | 'to' | 'closeMonth'>,
): boolean {
  if (t.statementMonth) return t.statementMonth === statement.closeMonth;
  return t.date >= statement.from && t.date <= statement.to;
}

/**
 * Summe eines Abrechnungszeitraums: was abgebucht werden müsste (positiv), und wie viele
 * Buchungen dazu gehören – zum Abgleich mit der Abrechnung der Bank.
 */
export function statementTotal(
  transactions: readonly CardTransaction[],
  cardId: string,
  statement: Pick<Statement, 'from' | 'to' | 'closeMonth'>,
): { amountCents: Cents; count: number } {
  let amountCents = 0;
  let count = 0;
  for (const t of transactions) {
    if (!isPurchase(t, cardId) || !inStatement(t, statement)) continue;
    amountCents -= t.amountCents;
    count++;
  }
  return { amountCents, count };
}

/**
 * Aktueller Stand der Karte: Startstand plus Käufe/Gutschriften, zurückgesetzt durch die
 * gebuchten Abbuchungen. Negativ = so viel ist auf der Karte offen.
 */
export function cardBalance(
  startCents: Cents,
  transactions: readonly CardTransaction[],
  cardId: string,
): Cents {
  let balance = startCents;
  for (const t of transactions) {
    if (isPurchase(t, cardId)) balance += t.amountCents;
    else if (isPaymentFor(t, cardId)) balance -= t.amountCents;
  }
  return balance;
}
