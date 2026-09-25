import {
  transactionCreateSchema,
  transactionUpdateSchema,
  yearMonthSchema,
} from '@financeanchor/shared';
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { runBatch } from '../db/client.js';
import { accounts, bookedItems, loans, transactions } from '../db/schema.js';
import { AppError } from '../errors.js';
import { strip } from '../mappers.js';
import type { AppEnv } from '../middleware/context.js';
import { validate } from '../validation.js';
import { found, idParam, one, scopedFrom } from './util.js';

const monthQuery = z.object({ month: yearMonthSchema });

export const transactionRoutes = new Hono<AppEnv>()
  .get('/', validate('query', monthQuery), async (c) => {
    const s = scopedFrom(c);
    const rows = await s.db
      .select()
      .from(transactions)
      .where(s.own(transactions, like(transactions.date, `${c.req.valid('query').month}-%`)))
      .orderBy(desc(transactions.date), desc(transactions.createdAt));
    return c.json(rows.map(strip));
  })
  /** Monate, in denen es Buchungen gibt, absteigend. */
  .get('/months', async (c) => {
    const s = scopedFrom(c);
    const month = sql<string>`substr(${transactions.date}, 1, 7)`;
    const rows = await s.db
      .selectDistinct({ month })
      .from(transactions)
      .where(s.own(transactions))
      .orderBy(desc(month));
    return c.json(rows.map((r) => r.month));
  })
  /** Namen früherer Buchungen mit zuletzt verwendeter Kategorie (Vorschläge beim Erfassen). */
  .get('/suggestions', async (c) => {
    const s = scopedFrom(c);
    const rows = await s.db
      .select({ name: transactions.name, categoryId: transactions.categoryId })
      .from(transactions)
      .where(s.own(transactions, eq(transactions.kind, 'normal')))
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(500);
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.name)) seen.set(r.name, r.categoryId);
    return c.json([...seen].slice(0, 100).map(([name, categoryId]) => ({ name, categoryId })));
  })
  .post('/', validate('json', transactionCreateSchema), async (c) => {
    const row = one(
      await scopedFrom(c).insert(transactions, {
        ...c.req.valid('json'),
        kind: 'normal',
        sourceType: null,
        sourceId: null,
      }),
      'transaction',
    );
    return c.json(strip(row), 201);
  })
  .patch(
    '/:id',
    validate('param', idParam),
    validate('json', transactionUpdateSchema),
    async (c) => {
      const s = scopedFrom(c);
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      if (patch.amountCents !== undefined) {
        const effects = await bookingEffectsOf(s.db, s.userId, id);
        if (
          effects.some(
            (b) =>
              b.accountDeltaCents !== 0 || b.loanDeltaCents !== 0 || b.loanSavedDeltaCents !== 0,
          )
        ) {
          // Der Betrag steckt schon in einem Kontostand oder einer Restschuld.
          throw new AppError(
            409,
            'managed_transaction',
            'Delete and book again to change the amount',
          );
        }
      }
      const row = one(await s.update(transactions, id, patch), 'transaction');
      return c.json(strip(row));
    },
  )
  /** Löschen macht Änderungen an Rücklagenkonto oder Restschuld rückgängig; der Posten ist wieder offen. */
  .delete('/:id', validate('param', idParam), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    found(await s.get(transactions, id), 'transaction');
    const now = Date.now();
    const reverts = (await bookingEffectsOf(s.db, s.userId, id)).flatMap((b) => [
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
    ]);
    await runBatch(s.db, [...reverts, s.remove(transactions, id)]);
    return c.body(null, 204);
  });

function bookingEffectsOf(
  db: ReturnType<typeof scopedFrom>['db'],
  userId: string,
  transactionId: string,
) {
  return db
    .select()
    .from(bookedItems)
    .where(and(eq(bookedItems.userId, userId), eq(bookedItems.transactionId, transactionId)));
}
