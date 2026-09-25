import { userSettingsUpdateSchema } from '@financeanchor/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { userSettings } from '../db/schema.js';
import type { AppEnv } from '../middleware/context.js';
import { validate } from '../validation.js';
import { one } from './util.js';

export const settingsRoutes = new Hono<AppEnv>().patch(
  '/',
  validate('json', userSettingsUpdateSchema),
  async (c) => {
    const { db, userId } = c.var;
    const rows = await db
      .update(userSettings)
      .set({ ...c.req.valid('json'), updatedAt: Date.now() })
      .where(eq(userSettings.userId, userId))
      .returning();
    const s = one(rows, 'settings');
    return c.json({
      extraPaymentCents: s.extraPaymentCents,
      strategy: s.strategy,
      locale: s.locale,
      currency: s.currency,
    });
  },
);
