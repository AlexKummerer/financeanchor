import {
  addMonths,
  isoDateSchema,
  monthOfDate,
  recurringItemCreateSchema,
  recurringItemUpdateSchema,
  subscriptionCandidates,
  templateSuggestions,
} from '@financeanchor/shared';
import { and, asc, eq, gte, isNull, like, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { bookedItemParts, bookedItems, recurringItems, transactions } from '../db/schema.js';
import { strip } from '../mappers.js';
import { assertCardAccount } from '../services/cards.js';
import type { AppEnv } from '../middleware/context.js';
import { validate } from '../validation.js';
import { found, idParam, one, scopedFrom } from './util.js';

const todayQuery = z.object({ today: isoDateSchema });

export const recurringItemRoutes = new Hono<AppEnv>()
  /**
   * Hinweise: Vorlage anpassen (zweimal derselbe abweichende Betrag) und mögliche Abos (gleiche
   * Ausgabe in mehreren Monaten ohne Posten).
   */
  .get('/insights', validate('query', todayQuery), async (c) => {
    const s = scopedFrom(c);
    const { today } = c.req.valid('query');
    const month = monthOfDate(today);
    const since = addMonths(month, -6);
    const [items, booked, parts, own] = await s.db.batch([
      s.db.select().from(recurringItems).where(s.own(recurringItems)),
      s.db
        .select({
          id: bookedItems.id,
          key: bookedItems.bookingKey,
          month: bookedItems.month,
          amountCents: transactions.amountCents,
        })
        .from(bookedItems)
        .innerJoin(transactions, eq(transactions.id, bookedItems.transactionId))
        .where(
          s.own(
            bookedItems,
            and(like(bookedItems.bookingKey, 'item:%'), gte(bookedItems.month, since)),
          ),
        ),
      s.db
        .select({
          bookedItemId: bookedItemParts.bookedItemId,
          amountCents: transactions.amountCents,
        })
        .from(bookedItemParts)
        .innerJoin(transactions, eq(transactions.id, bookedItemParts.transactionId))
        .where(s.own(bookedItemParts)),
      s.db
        .select({
          date: transactions.date,
          name: transactions.name,
          amountCents: transactions.amountCents,
          categoryId: transactions.categoryId,
          accountId: transactions.accountId,
          importLabel: transactions.importLabel,
        })
        .from(transactions)
        .where(
          s.own(
            transactions,
            and(
              eq(transactions.kind, 'normal'),
              isNull(transactions.sourceType),
              lt(transactions.amountCents, 0),
              gte(transactions.date, `${addMonths(month, -2)}-01`),
            ),
          ),
        ),
    ]);
    const amounts = booked.map((b) => ({
      itemId: b.key.slice('item:'.length),
      month: b.month,
      amountCents: parts
        .filter((p) => p.bookedItemId === b.id)
        .reduce((sum, p) => sum + p.amountCents, b.amountCents),
    }));
    return c.json({
      templates: templateSuggestions(items, amounts),
      subscriptions: subscriptionCandidates(own, items, today),
    });
  })
  .get('/', async (c) => {
    const s = scopedFrom(c);
    const rows = await s.db
      .select()
      .from(recurringItems)
      .where(s.own(recurringItems))
      .orderBy(asc(recurringItems.createdAt));
    return c.json(rows.map(strip));
  })
  .post('/', validate('json', recurringItemCreateSchema), async (c) => {
    const s = scopedFrom(c);
    const body = c.req.valid('json');
    // „Bezahlt mit“ nur mit eigener Kreditkarte
    await assertCardAccount(s, body.accountId);
    const row = one(
      await s.insert(recurringItems, {
        ...body,
        reservePotId: body.reservePotId ?? null,
      }),
      'recurring item',
    );
    return c.json(strip(row), 201);
  })
  .patch(
    '/:id',
    validate('param', idParam),
    validate('json', recurringItemUpdateSchema),
    async (c) => {
      const s = scopedFrom(c);
      await assertCardAccount(s, c.req.valid('json').accountId);
      const row = one(
        await s.update(recurringItems, c.req.valid('param').id, c.req.valid('json')),
        'recurring item',
      );
      return c.json(strip(row));
    },
  )
  .delete('/:id', validate('param', idParam), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    found(await s.get(recurringItems, id), 'recurring item');
    await s.remove(recurringItems, id);
    return c.body(null, 204);
  });
