import { isoDateSchema, netWorth } from '@financeanchor/shared';
import { asc } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { accounts, loans, netWorthSnapshots } from '../db/schema.js';
import { strip } from '../mappers.js';
import type { AppEnv } from '../middleware/context.js';
import { validate } from '../validation.js';
import { found, idParam, one, scopedFrom } from './util.js';

/** Das Datum kommt vom Client, weil nur er die Zeitzone des Nutzers kennt. */
const createBody = z.object({ date: isoDateSchema });

export const snapshotRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const s = scopedFrom(c);
    const rows = await s.db
      .select()
      .from(netWorthSnapshots)
      .where(s.own(netWorthSnapshots))
      .orderBy(asc(netWorthSnapshots.date));
    return c.json(rows.map(strip));
  })
  /** Hält den aktuellen Stand fest; höchstens ein Stand pro Tag, ein neuer ersetzt ihn. */
  .post('/', validate('json', createBody), async (c) => {
    const s = scopedFrom(c);
    const { date } = c.req.valid('json');
    const [accs, ls] = await s.db.batch([
      s.db.select({ balanceCents: accounts.balanceCents }).from(accounts).where(s.own(accounts)),
      s.db.select({ balanceCents: loans.balanceCents }).from(loans).where(s.own(loans)),
    ]);
    const nw = netWorth(accs, ls);
    const now = Date.now();
    const rows = await s.db
      .insert(netWorthSnapshots)
      .values(s.row(netWorthSnapshots, { date, ...nw }, now))
      .onConflictDoUpdate({
        target: [netWorthSnapshots.userId, netWorthSnapshots.date],
        set: { ...nw, updatedAt: now },
      })
      .returning();
    return c.json(strip(one(rows, 'snapshot')), 201);
  })
  .delete('/:id', validate('param', idParam), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    found(await s.get(netWorthSnapshots, id), 'snapshot');
    await s.remove(netWorthSnapshots, id);
    return c.body(null, 204);
  });
