import { accountCreateSchema, accountUpdateSchema } from '@financeanchor/shared';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { runBatch } from '../db/client.js';
import { accounts, reservePots } from '../db/schema.js';
import { strip } from '../mappers.js';
import type { AppEnv } from '../middleware/context.js';
import { validate } from '../validation.js';
import { found, idParam, one, scopedFrom } from './util.js';

export const accountRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const s = scopedFrom(c);
    const rows = await s.db
      .select()
      .from(accounts)
      .where(s.own(accounts))
      .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt));
    return c.json(rows.map(strip));
  })
  .post('/', validate('json', accountCreateSchema), async (c) => {
    const row = one(await scopedFrom(c).insert(accounts, c.req.valid('json')), 'account');
    return c.json(strip(row), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', accountUpdateSchema), async (c) => {
    const s = scopedFrom(c);
    const row = one(
      await s.update(accounts, c.req.valid('param').id, c.req.valid('json')),
      'account',
    );
    return c.json(strip(row));
  })
  .delete('/:id', validate('param', idParam), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    found(await s.get(accounts, id), 'account');
    // Verknüpfte Rücklagentöpfe verlieren ihr Konto, statt die Löschung zu blockieren.
    await runBatch(s.db, [
      s.db
        .update(reservePots)
        .set({ accountId: null, updatedAt: Date.now() })
        .where(s.own(reservePots, eq(reservePots.accountId, id))),
      s.remove(accounts, id),
    ]);
    return c.body(null, 204);
  });
