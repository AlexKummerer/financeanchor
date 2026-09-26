import { cardBalance } from '@financeanchor/shared';
import { asc, eq, isNotNull, or } from 'drizzle-orm';
import type { Scoped } from '../db/scoped.js';
import { accounts, transactions } from '../db/schema.js';
import { AppError } from '../errors.js';

type AccountRow = typeof accounts.$inferSelect;

/** Buchungen, die einen Kartenstand bewegen: Käufe mit Karte und Abbuchungen. */
export function cardMovements(s: Scoped) {
  return s.db
    .select({
      date: transactions.date,
      amountCents: transactions.amountCents,
      kind: transactions.kind,
      accountId: transactions.accountId,
      sourceType: transactions.sourceType,
      sourceId: transactions.sourceId,
      statementMonth: transactions.statementMonth,
    })
    .from(transactions)
    .where(
      s.own(
        transactions,
        or(isNotNull(transactions.accountId), eq(transactions.kind, 'card_payment')),
      ),
    );
}

export type CardMovement = Awaited<ReturnType<typeof cardMovements>>[number];

/**
 * Kreditkarten zeigen ihren aktuellen Stand statt des gespeicherten Startstands. Alle anderen
 * Konten bleiben unverändert.
 */
export function withCardBalances<T extends Pick<AccountRow, 'id' | 'kind' | 'balanceCents'>>(
  rows: T[],
  movements: readonly CardMovement[],
): T[] {
  return rows.map((a) =>
    a.kind === 'credit_card'
      ? { ...a, balanceCents: cardBalance(a.balanceCents, movements, a.id) }
      : a,
  );
}

/** Konten mit aktuellem Stand (Kreditkarten berechnet), sortiert wie in der Oberfläche. */
export async function accountsWithBalances(s: Scoped) {
  const [rows, movements] = await s.db.batch([
    s.db
      .select()
      .from(accounts)
      .where(s.own(accounts))
      .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt)),
    cardMovements(s),
  ]);
  return withCardBalances(rows, movements);
}

/** Konto, von dem eine Karte abgebucht wird: eigenes Konto, keine Kreditkarte, nicht sie selbst. */
export async function assertDebitAccount(
  s: Scoped,
  debitAccountId: string | null,
  cardId?: string,
) {
  if (debitAccountId === null) return;
  const acc = await s.get(accounts, debitAccountId);
  if (!acc || acc.kind === 'credit_card' || acc.id === cardId) {
    throw new AppError(400, 'invalid_debit_account', 'Debit account must be a non-card account');
  }
}

/** „Bezahlt mit“ muss eine eigene Kreditkarte sein. */
export async function assertCardAccount(s: Scoped, accountId: string | null | undefined) {
  if (accountId === null || accountId === undefined) return;
  const acc = await s.get(accounts, accountId);
  if (!acc || acc.kind !== 'credit_card') {
    throw new AppError(400, 'invalid_account', 'Account must be one of your credit cards');
  }
}
