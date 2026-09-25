import {
  categoryCreateSchema,
  categoryNameKey,
  categoryUpdateSchema,
  idSchema,
  isCategoryNameTaken,
} from '@financeanchor/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { runBatch } from '../db/client.js';
import { categories, recurringItems, transactions } from '../db/schema.js';
import type { Scoped } from '../db/scoped.js';
import { AppError } from '../errors.js';
import { categoryToApi } from '../mappers.js';
import type { AppEnv } from '../middleware/context.js';
import { validate } from '../validation.js';
import { found, idParam, isForeignKeyError, one, scopedFrom } from './util.js';

const countAll = sql<number>`count(*)`.mapWith(Number);

const deleteQuery = z.object({ moveTo: idSchema.optional() });

export const categoryRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const s = scopedFrom(c);
    const rows = await s.db
      .select()
      .from(categories)
      .where(s.own(categories))
      .orderBy(asc(categories.nameKey));
    return c.json(rows.map(categoryToApi));
  })
  /** Anzahl der Buchungen und Posten je Kategorie (für „n Verwendungen“). */
  .get('/usage', async (c) => {
    const s = scopedFrom(c);
    const [tx, items] = await s.db.batch([
      s.db
        .select({ categoryId: transactions.categoryId, n: countAll })
        .from(transactions)
        .where(s.own(transactions))
        .groupBy(transactions.categoryId),
      s.db
        .select({ categoryId: recurringItems.categoryId, n: countAll })
        .from(recurringItems)
        .where(s.own(recurringItems))
        .groupBy(recurringItems.categoryId),
    ]);
    const usage: Record<string, number> = {};
    for (const r of [...tx, ...items]) usage[r.categoryId] = (usage[r.categoryId] ?? 0) + r.n;
    return c.json(usage);
  })
  .post('/', validate('json', categoryCreateSchema), async (c) => {
    const s = scopedFrom(c);
    const { id, name } = c.req.valid('json');
    await assertNameFree(s, name);
    const row = one(
      await s.insert(categories, { id, name, nameKey: categoryNameKey(name), systemKey: null }),
      'category',
    );
    return c.json(categoryToApi(row), 201);
  })
  /** Umbenennen: Buchungen und Posten verweisen per ID und zeigen den neuen Namen sofort. */
  .patch('/:id', validate('param', idParam), validate('json', categoryUpdateSchema), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const cat = found(await s.get(categories, id), 'category');
    if (cat.systemKey) throw new AppError(403, 'system_category', 'System categories are fixed');
    await assertNameFree(s, name, id);
    const row = one(
      await s.update(categories, id, { name, nameKey: categoryNameKey(name) }),
      'category',
    );
    return c.json(categoryToApi(row));
  })
  /** Löschen; wird die Kategorie verwendet, ist `moveTo` Pflicht und alles wird atomar verschoben. */
  .delete('/:id', validate('param', idParam), validate('query', deleteQuery), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    const { moveTo } = c.req.valid('query');
    const cat = found(await s.get(categories, id), 'category');
    if (cat.systemKey) throw new AppError(403, 'system_category', 'System categories are fixed');
    if (moveTo !== undefined) {
      if (moveTo === id) throw new AppError(400, 'invalid_target', 'Target must differ');
      const target = await s.get(categories, moveTo);
      if (!target) throw new AppError(400, 'invalid_target', 'Target category not found');
      if (target.systemKey)
        throw new AppError(400, 'invalid_target', 'Cannot move into a system category');
    }
    const now = Date.now();
    const queries = [];
    if (moveTo) {
      queries.push(
        s.db
          .update(transactions)
          .set({ categoryId: moveTo, updatedAt: now })
          .where(s.own(transactions, eq(transactions.categoryId, id))),
        s.db
          .update(recurringItems)
          .set({ categoryId: moveTo, updatedAt: now })
          .where(s.own(recurringItems, eq(recurringItems.categoryId, id))),
      );
    }
    try {
      await runBatch(s.db, [...queries, s.remove(categories, id)]);
    } catch (err) {
      if (isForeignKeyError(err)) {
        throw new AppError(409, 'category_in_use', 'Category is used; provide moveTo', { id });
      }
      throw err;
    }
    return c.body(null, 204);
  });

async function assertNameFree(s: Scoped, name: string, exceptId?: string) {
  const existing = await s.list(categories);
  if (isCategoryNameTaken(name, existing, exceptId)) {
    throw new AppError(409, 'name_taken', 'Category name already exists');
  }
}
