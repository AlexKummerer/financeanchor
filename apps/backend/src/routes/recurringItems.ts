import { recurringItemCreateSchema, recurringItemUpdateSchema } from '@financeanchor/shared';
import { asc } from 'drizzle-orm';
import { Hono } from 'hono';
import { recurringItems } from '../db/schema.js';
import { strip } from '../mappers.js';
import type { AppEnv } from '../middleware/context.js';
import { validate } from '../validation.js';
import { found, idParam, one, scopedFrom } from './util.js';

export const recurringItemRoutes = new Hono<AppEnv>()
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
    const body = c.req.valid('json');
    const row = one(
      await scopedFrom(c).insert(recurringItems, {
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
