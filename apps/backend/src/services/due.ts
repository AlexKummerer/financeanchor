import {
  addMonths,
  applyDueLinks,
  applyDueOverrides,
  bookingEffects,
  DueBookingError,
  isPlausibleToday,
  newId,
  planDue,
  selectDueForBooking,
  type DueBookRequest,
  type DueEntry,
  type IsoDate,
  type SystemCategoryKey,
  type YearMonth,
  withoutPastEffects,
} from '@financeanchor/shared';
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { chunkedInsert, runBatch } from '../db/client.js';
import {
  accounts,
  bookedItems,
  cardStatementDates,
  categories,
  loans,
  recurringItems,
  reservePots,
  transactions,
  userSettings,
} from '../db/schema.js';
import type { Scoped } from '../db/scoped.js';
import { AppError } from '../errors.js';

export function assertPlausibleToday(today: IsoDate) {
  if (!isPlausibleToday(today, Date.now())) {
    throw new AppError(400, 'invalid_today', 'Date does not match the current day');
  }
}

/** Lädt alles, was für die Fälligkeiten eines Monats gebraucht wird, und plant sie. */
export async function loadDuePlan(
  s: Scoped,
  month: YearMonth,
  today: IsoDate,
): Promise<DueEntry[]> {
  const { db } = s;
  const [items, pots, accs, ls, settings, sysCats, booked, cardTransactions, cardDates] =
    await db.batch([
      db.select().from(recurringItems).where(s.own(recurringItems)),
      db.select().from(reservePots).where(s.own(reservePots)),
      db
        .select({
          id: accounts.id,
          name: accounts.name,
          kind: accounts.kind,
          statementDay: accounts.statementDay,
          debitDay: accounts.debitDay,
          debitAccountId: accounts.debitAccountId,
        })
        .from(accounts)
        .where(s.own(accounts)),
      db.select().from(loans).where(s.own(loans)),
      db.select().from(userSettings).where(eq(userSettings.userId, s.userId)),
      db
        .select({ id: categories.id, systemKey: categories.systemKey })
        .from(categories)
        .where(s.own(categories, isNotNull(categories.systemKey))),
      db
        .select({
          key: bookedItems.bookingKey,
          amountCents: transactions.amountCents,
          date: transactions.date,
        })
        .from(bookedItems)
        .innerJoin(transactions, eq(transactions.id, bookedItems.transactionId))
        .where(s.own(bookedItems, eq(bookedItems.month, month))),
      // Kartenbuchungen der letzten Monate (Abrechnungszeitraum der Abbuchung dieses Monats)
      db
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
            and(
              isNotNull(transactions.accountId),
              gte(transactions.date, `${addMonths(month, -2)}-01`),
            ),
          ),
        ),
      db.select().from(cardStatementDates).where(s.own(cardStatementDates)),
    ]);
  const setting = settings[0];
  const systemCategoryIds = Object.fromEntries(sysCats.map((c) => [c.systemKey, c.id])) as Record<
    SystemCategoryKey,
    string
  >;
  if (
    !setting ||
    !systemCategoryIds.reserve ||
    !systemCategoryIds.transfer ||
    !systemCategoryIds.loans
  ) {
    throw new AppError(500, 'user_not_initialized', 'User data is incomplete');
  }
  return planDue({
    month,
    today,
    items,
    pots,
    accounts: accs,
    cardTransactions,
    cardStatementDates: cardDates,
    loans: ls,
    systemCategoryIds,
    booked: new Map(booked.map((b) => [b.key, { amountCents: b.amountCents, date: b.date }])),
  });
}

/**
 * Bucht die gewählten Fälligkeiten atomar: Buchungen, Markierungen in `booked_items` (Unique je
 * Schlüssel und Monat, daher idempotent), Kontostände und Restschulden in einem D1-Batch.
 */
export async function bookDue(s: Scoped, month: YearMonth, req: DueBookRequest) {
  assertPlausibleToday(req.today);
  const linked = await linkTransactions(s, req.links);
  let selected: DueEntry[];
  try {
    const plan = applyDueLinks(
      applyDueOverrides(await loadDuePlan(s, month, req.today), req.overrides, month, req.today),
      req.links.map((l) => {
        const tx = linked.get(l.transactionId);
        if (!tx) throw new AppError(400, 'invalid_link', 'Unknown transaction');
        return { key: l.key, date: tx.date, amountCents: tx.amountCents };
      }),
      month,
      req.today,
    );
    const keys = req.keys && [...new Set([...req.keys, ...req.links.map((l) => l.key)])];
    selected = selectDueForBooking(plan, keys);
  } catch (err) {
    if (err instanceof DueBookingError) {
      throw new AppError(400, err.code, err.message, { key: err.key });
    }
    throw err;
  }
  if (!selected.length) return { bookedCount: 0 };
  // Stand-Datum: Fälligkeiten bis dahin sind in den eingetragenen Ständen schon enthalten
  const [accountDates, loanDates] = await s.db.batch([
    s.db
      .select({ id: accounts.id, date: accounts.balanceDate })
      .from(accounts)
      .where(s.own(accounts)),
    s.db.select({ id: loans.id, date: loans.balanceDate }).from(loans).where(s.own(loans)),
  ]);
  selected = withoutPastEffects(selected, {
    accounts: new Map(accountDates.map((a) => [a.id, a.date])),
    loans: new Map(loanDates.map((l) => [l.id, l.date])),
  });

  const now = Date.now();
  const linkByKey = new Map(req.links.map((l) => [l.key, l.transactionId]));
  const pairs = selected.map((e) => {
    const tx = {
      id: linkByKey.get(e.key) ?? newId(now),
      userId: s.userId,
      date: e.date,
      name: e.name,
      categoryId: e.categoryId,
      amountCents: e.amountCents,
      kind: e.transactionKind,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      accountId: e.paidWith,
      createdAt: now,
      updatedAt: now,
    };
    const booked = {
      id: newId(now),
      userId: s.userId,
      month,
      bookingKey: e.key,
      transactionId: tx.id,
      accountId: e.accountDelta?.accountId ?? null,
      accountDeltaCents: e.accountDelta?.cents ?? 0,
      loanId: e.loanDelta?.loanId ?? e.savingDelta?.loanId ?? null,
      loanDeltaCents: e.loanDelta?.cents ?? 0,
      loanSavedDeltaCents: e.savingDelta?.cents ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    return { tx, booked };
  });
  const txRows = pairs.map((p) => p.tx).filter((t) => !linked.has(t.id));
  // Schon von Hand gebucht: Buchung wird zur Fälligkeit (Art, Herkunft, Kategorie), Name bleibt
  const linkUpdates = pairs
    .filter((p) => linked.has(p.tx.id))
    .map(({ tx }) =>
      s.db
        .update(transactions)
        .set({
          kind: tx.kind,
          sourceType: tx.sourceType,
          sourceId: tx.sourceId,
          categoryId: tx.categoryId,
          accountId: sql`coalesce(${transactions.accountId}, ${tx.accountId})`,
          updatedAt: now,
        })
        .where(s.byId(transactions, tx.id)),
    );
  const bookedRows = pairs.map((p) => p.booked);
  const { accountDeltas, loanDeltas, savingDeltas } = bookingEffects(selected);
  try {
    await runBatch(s.db, [
      ...chunkedInsert(s.db, transactions, txRows),
      ...linkUpdates,
      ...chunkedInsert(s.db, bookedItems, bookedRows),
      ...[...accountDeltas].map(([id, delta]) =>
        s.db
          .update(accounts)
          .set({ balanceCents: sql`${accounts.balanceCents} + ${delta}`, updatedAt: now })
          .where(s.byId(accounts, id)),
      ),
      ...[...savingDeltas].map(([id, delta]) =>
        s.db
          .update(loans)
          .set({ savedCents: sql`max(0, ${loans.savedCents} + ${delta})`, updatedAt: now })
          .where(s.byId(loans, id)),
      ),
      ...[...loanDeltas].map(([id, delta]) =>
        s.db
          .update(loans)
          .set({ balanceCents: sql`${loans.balanceCents} + ${delta}`, updatedAt: now })
          .where(s.byId(loans, id)),
      ),
    ]);
  } catch (err) {
    if (
      String(err).includes('UNIQUE') ||
      String((err as { cause?: unknown }).cause).includes('UNIQUE')
    ) {
      // Parallel wurde schon gebucht; der Batch ist vollständig zurückgerollt.
      throw new AppError(409, 'already_booked', 'Some entries were booked in the meantime');
    }
    throw err;
  }
  return { bookedCount: selected.length };
}

/**
 * Buchungen, mit denen Fälligkeiten verknüpft werden sollen: eigene, von Hand erfasste Buchungen
 * (Art „normal“, ohne Herkunft), jede höchstens einmal.
 */
async function linkTransactions(s: Scoped, links: DueBookRequest['links']) {
  const ids = links.map((l) => l.transactionId);
  const found = new Map<string, { date: IsoDate; amountCents: number }>();
  if (!ids.length) return found;
  if (new Set(ids).size !== ids.length || new Set(links.map((l) => l.key)).size !== ids.length) {
    throw new AppError(400, 'invalid_link', 'Each transaction can only be linked once');
  }
  const [rows, booked] = await s.db.batch([
    s.db
      .select({
        id: transactions.id,
        date: transactions.date,
        amountCents: transactions.amountCents,
        kind: transactions.kind,
        sourceType: transactions.sourceType,
      })
      .from(transactions)
      .where(s.own(transactions, inArray(transactions.id, ids))),
    s.db
      .select({ id: bookedItems.transactionId })
      .from(bookedItems)
      .where(s.own(bookedItems, inArray(bookedItems.transactionId, ids))),
  ]);
  for (const r of rows) {
    if (r.kind === 'normal' && r.sourceType === null) found.set(r.id, r);
  }
  if (found.size !== ids.length || booked.length) {
    throw new AppError(400, 'invalid_link', 'Transaction cannot be linked');
  }
  return found;
}
