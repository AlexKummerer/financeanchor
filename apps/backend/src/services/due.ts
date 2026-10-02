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
  bookedItemParts,
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
import { releaseBookings } from './booking.js';

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
  const [items, pots, accs, ls, settings, sysCats, booked, cardTransactions, cardDates, parts] =
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
      // Weitere Teile von Fälligkeiten, die in mehreren Buchungen erfasst wurden
      db
        .select({ key: bookedItems.bookingKey, amountCents: transactions.amountCents })
        .from(bookedItemParts)
        .innerJoin(bookedItems, eq(bookedItems.id, bookedItemParts.bookedItemId))
        .innerJoin(transactions, eq(transactions.id, bookedItemParts.transactionId))
        .where(s.own(bookedItemParts, eq(bookedItems.month, month))),
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
    booked: new Map(
      booked.map((b) => [
        b.key,
        {
          amountCents: parts
            .filter((p) => p.key === b.key)
            .reduce((sum, p) => sum + p.amountCents, b.amountCents),
          date: b.date,
        },
      ]),
    ),
  });
}

/**
 * Bucht die gewählten Fälligkeiten atomar: Buchungen, Markierungen in `booked_items` (Unique je
 * Schlüssel und Monat, daher idempotent), Kontostände und Restschulden in einem D1-Batch.
 */
export async function bookDue(s: Scoped, month: YearMonth, req: DueBookRequest) {
  assertPlausibleToday(req.today);
  const groups = await linkGroups(s, req.links);
  let selected: DueEntry[];
  try {
    const adjusted = applyDueOverrides(
      await loadDuePlan(s, month, req.today),
      req.overrides,
      month,
      req.today,
    );
    splitAmounts(groups, adjusted);
    const plan = applyDueLinks(
      adjusted,
      [...groups].map(([key, g]) => ({ key, date: g.date, amountCents: g.amountCents })),
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
  const pairs = selected.map((e) => {
    const tx = {
      id: groups.get(e.key)?.ids[0] ?? newId(now),
      userId: s.userId,
      date: e.date,
      name: e.name,
      categoryId: e.categoryId,
      amountCents: e.amountCents,
      kind: e.transactionKind,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      accountId: groups.get(e.key)?.accountId ?? e.paidWith,
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
    return { tx, booked, group: groups.get(e.key) ?? null };
  });
  // Neu angelegt: ohne Verknüpfung und beim Aufteilen die weiteren Fälligkeiten
  const txRows = pairs.filter((p) => !p.group?.ids.length).map((p) => p.tx);
  // Schon von Hand gebucht: die Buchungen werden zur Fälligkeit (Art, Herkunft, Kategorie), Namen
  // bleiben; ab der zweiten Buchung als Teil der Markierung
  const linkUpdates = pairs.flatMap(({ tx, group }) =>
    (group?.ids ?? []).map((id) =>
      s.db
        .update(transactions)
        .set({
          kind: tx.kind,
          sourceType: tx.sourceType,
          sourceId: tx.sourceId,
          categoryId: tx.categoryId,
          accountId: sql`coalesce(${transactions.accountId}, ${tx.accountId})`,
          // Aufgeteilt: es bleibt der Rest nach den übrigen Fälligkeiten
          ...(group?.split ? { amountCents: tx.amountCents } : {}),
          updatedAt: now,
        })
        .where(s.byId(transactions, id)),
    ),
  );
  const partRows = pairs.flatMap(({ booked, group }) =>
    (group?.ids.slice(1) ?? []).map((transactionId) => ({
      id: newId(now),
      userId: s.userId,
      bookedItemId: booked.id,
      transactionId,
      createdAt: now,
      updatedAt: now,
    })),
  );
  const bookedRows = pairs.map((p) => p.booked);
  const { accountDeltas, loanDeltas, savingDeltas } = bookingEffects(selected);
  try {
    await runBatch(s.db, [
      ...chunkedInsert(s.db, transactions, txRows),
      ...linkUpdates,
      ...chunkedInsert(s.db, bookedItems, bookedRows),
      ...chunkedInsert(s.db, bookedItemParts, partRows),
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

interface LinkGroup {
  /** Verknüpfte Buchungen (nach Datum); leer bei den weiteren Fälligkeiten einer Aufteilung */
  ids: string[];
  date: IsoDate;
  amountCents: number;
  accountId: string | null;
  /** Eine Buchung für mehrere Fälligkeiten (z. B. 72 € für 30 € und 42 €) */
  split: { transactionId: string; totalCents: number; first: boolean } | null;
}

/**
 * Buchungen, mit denen Fälligkeiten verknüpft werden sollen: eigene, von Hand erfasste Buchungen
 * (Art „normal“, ohne Herkunft). Je Fälligkeit nach Datum sortiert (die erste wird die Buchung der
 * Markierung), mit Summe und letztem Tag. Eine Buchung darf nur dann bei mehreren Fälligkeiten
 * stehen, wenn sie dort jeweils allein steht – dann wird sie aufgeteilt.
 */
async function linkGroups(s: Scoped, links: DueBookRequest['links']) {
  const groups = new Map<string, LinkGroup>();
  const all = links.flatMap((l) => l.transactionIds);
  const ids = [...new Set(all)];
  if (!ids.length) return groups;
  const count = new Map<string, number>();
  for (const id of all) count.set(id, (count.get(id) ?? 0) + 1);
  const mixed = links.some(
    (l) => l.transactionIds.length > 1 && l.transactionIds.some((id) => (count.get(id) ?? 0) > 1),
  );
  if (mixed || new Set(links.map((l) => l.key)).size !== links.length) {
    throw new AppError(400, 'invalid_link', 'Each transaction can only be linked once');
  }
  const [rows, booked, parts] = await s.db.batch([
    s.db
      .select({
        id: transactions.id,
        date: transactions.date,
        amountCents: transactions.amountCents,
        kind: transactions.kind,
        sourceType: transactions.sourceType,
        accountId: transactions.accountId,
      })
      .from(transactions)
      .where(s.own(transactions, inArray(transactions.id, ids))),
    s.db
      .select({ id: bookedItems.transactionId })
      .from(bookedItems)
      .where(s.own(bookedItems, inArray(bookedItems.transactionId, ids))),
    s.db
      .select({ id: bookedItemParts.transactionId })
      .from(bookedItemParts)
      .where(s.own(bookedItemParts, inArray(bookedItemParts.transactionId, ids))),
  ]);
  const found = new Map(
    rows.filter((r) => r.kind === 'normal' && r.sourceType === null).map((r) => [r.id, r]),
  );
  if (found.size !== ids.length || booked.length || parts.length) {
    throw new AppError(400, 'invalid_link', 'Transaction cannot be linked');
  }
  const seen = new Set<string>();
  for (const l of links) {
    const txs = l.transactionIds
      .map((id) => found.get(id))
      .filter((t) => t !== undefined)
      .sort((a, b) => a.date.localeCompare(b.date));
    const amountCents = txs.reduce((sum, t) => sum + t.amountCents, 0);
    // Teile mit unterschiedlichem Vorzeichen passen nicht zu einer Fälligkeit
    if (txs.some((t) => Math.sign(t.amountCents) !== Math.sign(amountCents))) {
      throw new AppError(400, 'invalid_link', 'Parts must have the same sign');
    }
    const [only] = txs;
    const shared = txs.length === 1 && only && (count.get(only.id) ?? 0) > 1 ? only : null;
    const first = !!shared && !seen.has(shared.id);
    if (shared) seen.add(shared.id);
    groups.set(l.key, {
      ids: shared && !first ? [] : txs.map((t) => t.id),
      date: txs[txs.length - 1]?.date ?? '',
      amountCents,
      accountId: only?.accountId ?? null,
      split: shared ? { transactionId: shared.id, totalCents: shared.amountCents, first } : null,
    });
  }
  return groups;
}

/**
 * Aufteilen: die weiteren Fälligkeiten behalten ihren (ggf. angepassten) Betrag, die erste bekommt
 * den Rest der Buchung.
 */
function splitAmounts(groups: Map<string, LinkGroup>, entries: readonly DueEntry[]) {
  const others = new Map<string, number>();
  for (const [key, g] of groups) {
    if (!g.split || g.split.first) continue;
    const e = entries.find((x) => x.key === key);
    if (!e) throw new DueBookingError('unknown_key', key);
    g.amountCents = e.amountCents;
    others.set(g.split.transactionId, (others.get(g.split.transactionId) ?? 0) + e.amountCents);
  }
  for (const [key, g] of groups) {
    if (!g.split?.first) continue;
    g.amountCents = g.split.totalCents - (others.get(g.split.transactionId) ?? 0);
    if (Math.sign(g.amountCents) !== Math.sign(g.split.totalCents)) {
      throw new DueBookingError('invalid_amount', key);
    }
  }
}

/**
 * Gebuchte Fälligkeit wieder öffnen („Verknüpfung lösen“): Wirkung zurück, Markierung weg, die
 * Buchungen bleiben als eigene Buchungen.
 */
export async function unbookDue(s: Scoped, month: YearMonth, key: string) {
  const rows = await s.db
    .select()
    .from(bookedItems)
    .where(s.own(bookedItems, and(eq(bookedItems.month, month), eq(bookedItems.bookingKey, key))));
  if (!rows.length) throw new AppError(404, 'not_booked', 'This entry is not booked');
  await runBatch(s.db, await releaseBookings(s, rows));
}
