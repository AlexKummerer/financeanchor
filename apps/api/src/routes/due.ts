import { dueBookRequestSchema, isoDateSchema, yearMonthSchema } from '@financeanchor/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../middleware/context.js';
import { assertPlausibleToday, bookDue, loadDuePlan } from '../services/due.js';
import { validate } from '../validation.js';
import { scopedFrom } from './util.js';

const monthParam = z.object({ month: yearMonthSchema });
const todayQuery = z.object({ today: isoDateSchema });

export const dueRoutes = new Hono<AppEnv>()
  /** Fälligkeiten des Monats mit Status gebucht / buchbar. */
  .get('/:month', validate('param', monthParam), validate('query', todayQuery), async (c) => {
    const { today } = c.req.valid('query');
    assertPlausibleToday(today);
    return c.json(await loadDuePlan(scopedFrom(c), c.req.valid('param').month, today));
  })
  /** Fällige übernehmen; liefert danach den aktuellen Stand. */
  .post(
    '/:month/book',
    validate('param', monthParam),
    validate('json', dueBookRequestSchema),
    async (c) => {
      const s = scopedFrom(c);
      const { month } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await bookDue(s, month, body);
      return c.json({ ...result, entries: await loadDuePlan(s, month, body.today) });
    },
  );
