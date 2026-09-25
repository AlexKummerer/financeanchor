import { describe, expect, it } from 'vitest';
import { hasFeature, isEntitlementActive, type EntitlementLike } from '../src/index.js';

const now = Date.UTC(2026, 8, 25);
const day = 86_400_000;
const base: EntitlementLike = {
  plan: 'trial',
  status: 'active',
  trialEndsAt: now + day,
  currentPeriodEnd: null,
  features: ['*'],
};

describe('Freigaben', () => {
  it('Testphase ist bis zu ihrem Ende aktiv', () => {
    expect(isEntitlementActive(base, now)).toBe(true);
    expect(isEntitlementActive({ ...base, trialEndsAt: now - 1 }, now)).toBe(false);
    expect(isEntitlementActive({ ...base, trialEndsAt: null }, now)).toBe(false);
  });

  it('Abo ist aktiv bis zum Periodenende, ohne Ende unbegrenzt', () => {
    expect(isEntitlementActive({ ...base, plan: 'yearly', currentPeriodEnd: now + day }, now)).toBe(
      true,
    );
    expect(isEntitlementActive({ ...base, plan: 'yearly', currentPeriodEnd: now - day }, now)).toBe(
      false,
    );
    expect(isEntitlementActive({ ...base, plan: 'internal' }, now)).toBe(true);
    expect(isEntitlementActive({ ...base, plan: 'internal', status: 'canceled' }, now)).toBe(false);
    expect(isEntitlementActive(null, now)).toBe(false);
  });

  it('Funktionen: * gibt alles frei, sonst nur die gelisteten', () => {
    expect(hasFeature(base, 'export', now)).toBe(true);
    expect(hasFeature({ ...base, features: ['core'] }, 'export', now)).toBe(false);
    expect(hasFeature({ ...base, features: ['core'] }, 'core', now)).toBe(true);
    expect(hasFeature({ ...base, trialEndsAt: now - 1 }, 'core', now)).toBe(false);
  });
});
