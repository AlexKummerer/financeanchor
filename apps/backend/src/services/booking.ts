import { eq, inArray, or, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { accounts, bookedItemParts, bookedItems, loans, transactions } from '../db/schema.js';
import type { Scoped } from '../db/scoped.js';

export type BookedItemRow = typeof bookedItems.$inferSelect;

/** Markierungen der Fälligkeiten, zu denen die Buchung gehört (als Buchung oder als Teil). */
export function bookingEffectsOf(s: Scoped, transactionId: string) {
  const parts = s.db
    .select({ id: bookedItemParts.bookedItemId })
    .from(bookedItemParts)
    .where(s.own(bookedItemParts, eq(bookedItemParts.transactionId, transactionId)));
  return s.db
    .select()
    .from(bookedItems)
    .where(
      s.own(
        bookedItems,
        or(eq(bookedItems.transactionId, transactionId), inArray(bookedItems.id, parts)),
      ),
    );
}

/**
 * Gebuchte Fälligkeiten wieder öffnen: Wirkung auf Rücklagenkonto, Restschuld und Zurückgelegtes
 * zurücknehmen, Markierungen (mit ihren Teilen) entfernen. Die zugehörigen Buchungen bleiben als
 * eigene Buchungen ohne Herkunft – außer `except` (z. B. Buchungen, die gerade gelöscht werden).
 */
export async function releaseBookings(
  s: Scoped,
  booked: readonly BookedItemRow[],
  except: readonly string[] = [],
): Promise<BatchItem<'sqlite'>[]> {
  const now = Date.now();
  const txIds = new Set<string>();
  for (const b of booked) {
    txIds.add(b.transactionId);
    const parts = await s.db
      .select({ id: bookedItemParts.transactionId })
      .from(bookedItemParts)
      .where(s.own(bookedItemParts, eq(bookedItemParts.bookedItemId, b.id)));
    for (const p of parts) txIds.add(p.id);
  }
  for (const id of except) txIds.delete(id);
  return [
    ...booked.flatMap((b) => [
      ...(b.accountId && b.accountDeltaCents
        ? [
            s.db
              .update(accounts)
              .set({
                balanceCents: sql`${accounts.balanceCents} - ${b.accountDeltaCents}`,
                updatedAt: now,
              })
              .where(s.byId(accounts, b.accountId)),
          ]
        : []),
      ...(b.loanId && b.loanSavedDeltaCents
        ? [
            s.db
              .update(loans)
              .set({
                savedCents: sql`max(0, ${loans.savedCents} - ${b.loanSavedDeltaCents})`,
                updatedAt: now,
              })
              .where(s.byId(loans, b.loanId)),
          ]
        : []),
      ...(b.loanId && b.loanDeltaCents
        ? [
            s.db
              .update(loans)
              .set({
                balanceCents: sql`max(0, ${loans.balanceCents} - ${b.loanDeltaCents})`,
                updatedAt: now,
              })
              .where(s.byId(loans, b.loanId)),
          ]
        : []),
      s.db.delete(bookedItems).where(s.byId(bookedItems, b.id)),
    ]),
    ...[...txIds].map((id) =>
      s.db
        .update(transactions)
        .set({ kind: 'normal', sourceType: null, sourceId: null, updatedAt: now })
        .where(s.byId(transactions, id)),
    ),
  ];
}
