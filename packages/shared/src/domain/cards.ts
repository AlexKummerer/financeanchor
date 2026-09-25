import type { Cents } from '../money.js';
import { addMonths, dateInMonth, monthOfDate, type IsoDate, type YearMonth } from '../month.js';
import type { Account, Transaction } from '../schemas/entities.js';

export type CardLike = Pick<Account, 'id' | 'statementDay' | 'debitDay'>;
type CardTransaction = Pick<
  Transaction,
  'date' | 'amountCents' | 'kind' | 'accountId' | 'sourceType' | 'sourceId'
>;

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

/** Abrechnung, deren Zeitraum im angegebenen Monat endet. */
export function statementClosingIn(card: CardLike, closeMonth: YearMonth): Statement {
  const day = card.statementDay ?? 31;
  const to = dateInMonth(closeMonth, day);
  const from = nextDay(dateInMonth(addMonths(closeMonth, -1), day));
  const debitMonth = debitSameMonth(card) ? closeMonth : addMonths(closeMonth, 1);
  return { closeMonth, from, to, debitDate: dateInMonth(debitMonth, card.debitDay ?? 1) };
}

/** Abrechnung, die im angegebenen Monat abgebucht wird. */
export function statementDebitedIn(card: CardLike, month: YearMonth): Statement {
  return statementClosingIn(card, debitSameMonth(card) ? month : addMonths(month, -1));
}

/** Abrechnungszeitraum, in den ein Kauf an diesem Tag fällt. */
export function statementFor(card: CardLike, date: IsoDate): Statement {
  const month = monthOfDate(date);
  const current = statementClosingIn(card, month);
  return date <= current.to ? current : statementClosingIn(card, addMonths(month, 1));
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
 * Summe eines Abrechnungszeitraums: was abgebucht werden müsste (positiv), und wie viele
 * Buchungen dazu gehören – zum Abgleich mit der Abrechnung der Bank.
 */
export function statementTotal(
  transactions: readonly CardTransaction[],
  cardId: string,
  statement: Pick<Statement, 'from' | 'to'>,
): { amountCents: Cents; count: number } {
  let amountCents = 0;
  let count = 0;
  for (const t of transactions) {
    if (!isPurchase(t, cardId) || t.date < statement.from || t.date > statement.to) continue;
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
