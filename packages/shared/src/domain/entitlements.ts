import type { Entitlement } from '../schemas/entities.js';

/** Dauer der kostenlosen Testphase. */
export const TRIAL_DAYS = 30;

/** Funktionen, die über Freigaben gesteuert werden. `*` gibt alle frei. */
export const features = ['core', 'export'] as const;
export type Feature = (typeof features)[number];

export type EntitlementLike = Pick<
  Entitlement,
  'plan' | 'status' | 'trialEndsAt' | 'currentPeriodEnd' | 'features'
>;

/** Freigabe aktiv: Testphase läuft oder Abo aktiv (und nicht abgelaufen). */
export function isEntitlementActive(e: EntitlementLike | null, now: number): boolean {
  if (!e || e.status !== 'active') return false;
  if (e.plan === 'trial') return e.trialEndsAt !== null && e.trialEndsAt > now;
  return e.currentPeriodEnd === null || e.currentPeriodEnd > now;
}

export function hasFeature(e: EntitlementLike | null, feature: Feature, now: number): boolean {
  if (!e || !isEntitlementActive(e, now)) return false;
  return e.features.includes('*') || e.features.includes(feature);
}
