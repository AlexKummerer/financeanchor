import { isEntitlementActive } from '@financeanchor/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { entitlements, user, userSettings } from '../db/schema.js';
import { notFound } from '../errors.js';
import type { AppEnv } from '../middleware/context.js';

export const meRoutes = new Hono<AppEnv>().get('/', async (c) => {
  const { db, userId } = c.var;
  const [u, settings, entitlement] = await db.batch([
    db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId)),
    db.select().from(userSettings).where(eq(userSettings.userId, userId)),
    db.select().from(entitlements).where(eq(entitlements.userId, userId)),
  ]);
  const me = u[0];
  const s = settings[0];
  const e = entitlement[0];
  if (!me || !s) throw notFound('user');
  return c.json({
    user: me,
    settings: {
      extraPaymentCents: s.extraPaymentCents,
      strategy: s.strategy,
      locale: s.locale,
      currency: s.currency,
    },
    entitlement: e
      ? {
          plan: e.plan,
          status: e.status,
          trialEndsAt: e.trialEndsAt,
          currentPeriodEnd: e.currentPeriodEnd,
          features: e.features,
          source: e.source,
          active: isEntitlementActive(e, Date.now()),
        }
      : null,
  });
});
