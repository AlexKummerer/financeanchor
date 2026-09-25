import { loanCreateSchema, loanUpdateSchema } from '@financeanchor/shared';
import { asc } from 'drizzle-orm';
import { Hono } from 'hono';
import { loans } from '../db/schema.js';
import { strip } from '../mappers.js';
import type { AppEnv } from '../middleware/context.js';
import { validate } from '../validation.js';
import { found, idParam, one, scopedFrom } from './util.js';

export const loanRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const s = scopedFrom(c);
    const rows = await s.db.select().from(loans).where(s.own(loans)).orderBy(asc(loans.createdAt));
    return c.json(rows.map(strip));
  })
  .post('/', validate('json', loanCreateSchema), async (c) => {
    const body = c.req.valid('json');
    const row = one(
      await scopedFrom(c).insert(loans, {
        ...body,
        originalCents: body.originalCents ?? body.balanceCents,
      }),
      'loan',
    );
    return c.json(strip(row), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', loanUpdateSchema), async (c) => {
    const s = scopedFrom(c);
    const row = one(await s.update(loans, c.req.valid('param').id, c.req.valid('json')), 'loan');
    return c.json(strip(row));
  })
  .delete('/:id', validate('param', idParam), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    found(await s.get(loans, id), 'loan');
    await s.remove(loans, id);
    return c.body(null, 204);
  });
