import {
  categoryNameKey,
  defaultCategoryNames,
  newId,
  systemCategoryKeys,
  systemCategoryNames,
  TRIAL_DAYS,
} from '@financeanchor/shared';
import { chunkedInsert, runBatch, type Db } from '../db/client.js';
import { categories, entitlements, reservePots, userSettings } from '../db/schema.js';

export type InitialPlan = 'trial' | 'internal';

/** Startdaten eines neuen Nutzers: Kategorien, Systemkategorien, Einstellungen, Standardtopf, Freigabe. */
export function initialUserRows(userId: string, now: number, plan: InitialPlan) {
  const meta = { userId, createdAt: now, updatedAt: now };
  return {
    categories: [
      ...defaultCategoryNames.map((name) => ({
        id: newId(now),
        name,
        nameKey: categoryNameKey(name),
        systemKey: null,
        ...meta,
      })),
      ...systemCategoryKeys.map((key) => ({
        id: newId(now),
        name: systemCategoryNames[key],
        nameKey: categoryNameKey(systemCategoryNames[key]),
        systemKey: key,
        ...meta,
      })),
    ],
    settings: { id: newId(now), ...meta },
    reservePot: {
      id: newId(now),
      name: 'Rücklage',
      accountId: null,
      monthlyAmountCents: null,
      dueDay: 1,
      isDefault: true,
      ...meta,
    },
    entitlement:
      plan === 'internal'
        ? {
            id: newId(now),
            plan: 'internal' as const,
            status: 'active' as const,
            trialEndsAt: null,
            currentPeriodEnd: null,
            features: ['*'],
            source: 'manual' as const,
            ...meta,
          }
        : {
            id: newId(now),
            plan: 'trial' as const,
            status: 'active' as const,
            trialEndsAt: now + TRIAL_DAYS * 86_400_000,
            currentPeriodEnd: null,
            features: ['*'],
            source: 'manual' as const,
            ...meta,
          },
  };
}

export async function initializeUser(db: Db, userId: string, plan: InitialPlan, now = Date.now()) {
  const rows = initialUserRows(userId, now, plan);
  await runBatch(db, [
    ...chunkedInsert(db, categories, rows.categories),
    db.insert(userSettings).values(rows.settings),
    db.insert(reservePots).values(rows.reservePot),
    db.insert(entitlements).values(rows.entitlement),
  ]);
}
