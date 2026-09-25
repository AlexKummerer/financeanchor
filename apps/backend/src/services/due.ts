import {
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
} from '@financeanchor/shared';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { chunkedInsert, runBatch } from '../db/client.js';
import {
  accounts,
  bookedItems,
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
  const [items, pots, accs, ls, settings, sysCats, booked] = await db.batch([
    db.select().from(recurringItems).where(s.own(recurringItems)),
    db.select().from(reservePots).where(s.own(reservePots)),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(s.own(accounts)),
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
  let selected: DueEntry[];
  try {
    const plan = applyDueOverrides(
      await loadDuePlan(s, month, req.today),
      req.overrides,
      month,
      req.today,
    );
    selected = selectDueForBooking(plan, req.keys);
  } catch (err) {
    if (err instanceof DueBookingError) {
      throw new AppError(400, err.code, err.message, { key: err.key });
    }
    throw err;
  }
  if (!selected.length) return { bookedCount: 0 };

  const now = Date.now();
  const pairs = selected.map((e) => {
    const tx = {
      id: newId(now),
      userId: s.userId,
      date: e.date,
      name: e.name,
      categoryId: e.categoryId,
      amountCents: e.amountCents,
      kind: e.transactionKind,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
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
  const txRows = pairs.map((p) => p.tx);
  const bookedRows = pairs.map((p) => p.booked);
  const { accountDeltas, loanDeltas, savingDeltas } = bookingEffects(selected);
  try {
    await runBatch(s.db, [
      ...chunkedInsert(s.db, transactions, txRows),
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
