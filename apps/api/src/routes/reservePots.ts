import { reservePotCreateSchema, reservePotUpdateSchema } from '@financeanchor/shared';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { runBatch } from '../db/client.js';
import { recurringItems, reservePots } from '../db/schema.js';
import { AppError } from '../errors.js';
import { strip } from '../mappers.js';
import type { AppEnv } from '../middleware/context.js';
import { validate } from '../validation.js';
import { found, idParam, one, scopedFrom } from './util.js';

export const reservePotRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const s = scopedFrom(c);
    const rows = await s.db
      .select()
      .from(reservePots)
      .where(s.own(reservePots))
      .orderBy(asc(reservePots.createdAt));
    return c.json(rows.map(strip));
  })
  .post('/', validate('json', reservePotCreateSchema), async (c) => {
    const row = one(
      await scopedFrom(c).insert(reservePots, { ...c.req.valid('json'), isDefault: false }),
      'reserve pot',
    );
    return c.json(strip(row), 201);
  })
  .patch(
    '/:id',
    validate('param', idParam),
    validate('json', reservePotUpdateSchema),
    async (c) => {
      const s = scopedFrom(c);
      const row = one(
        await s.update(reservePots, c.req.valid('param').id, c.req.valid('json')),
        'reserve pot',
      );
      return c.json(strip(row));
    },
  )
  .delete('/:id', validate('param', idParam), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    const pot = found(await s.get(reservePots, id), 'reserve pot');
    if (pot.isDefault) throw new AppError(409, 'default_pot', 'The default pot cannot be deleted');
    // Posten dieses Topfs laufen danach wieder über den Standardtopf.
    await runBatch(s.db, [
      s.db
        .update(recurringItems)
        .set({ reservePotId: null, updatedAt: Date.now() })
        .where(s.own(recurringItems, eq(recurringItems.reservePotId, id))),
      s.remove(reservePots, id),
    ]);
    return c.body(null, 204);
  });
