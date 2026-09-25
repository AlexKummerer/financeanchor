import { hasFeature, type Feature } from '@financeanchor/shared';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { entitlements } from '../db/schema.js';
import { AppError } from '../errors.js';
import type { AppEnv } from './context.js';

/**
 * Stelle, an der Abos später geprüft werden: Die Freigabe liegt in `entitlements` und wird in
 * Phase 2/3 von Stripe- bzw. RevenueCat-Webhooks gepflegt (`source`). Die Prüfung selbst bleibt gleich.
 */
export const requireEntitlement = (feature: Feature) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const row = await c.var.db.query.entitlements.findFirst({
      where: eq(entitlements.userId, c.var.userId),
    });
    if (!hasFeature(row ?? null, feature, Date.now())) {
      throw new AppError(402, 'entitlement_required', 'Subscription or trial required', {
        feature,
      });
    }
    await next();
  });
