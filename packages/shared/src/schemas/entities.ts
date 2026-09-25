import { z } from 'zod';
import {
  accountKindSchema,
  basisPointsSchema,
  centsSchema,
  currencySchema,
  dueDaySchema,
  idSchema,
  intervalSchema,
  isoDateSchema,
  localeSchema,
  nameSchema,
  nonNegativeCentsSchema,
  positiveCentsSchema,
  recurringKindSchema,
  sourceTypeSchema,
  strategySchema,
  systemCategoryKeySchema,
  timestampSchema,
  transactionKindSchema,
  yearMonthSchema,
} from './common.js';

const meta = { createdAt: timestampSchema, updatedAt: timestampSchema };

// Konten und Depots
export const accountSchema = z.object({
  id: idSchema,
  name: nameSchema,
  kind: accountKindSchema,
  balanceCents: centsSchema,
  sortOrder: z.int(),
  ...meta,
});
export type Account = z.infer<typeof accountSchema>;
export const accountCreateSchema = accountSchema
  .pick({ name: true, kind: true, balanceCents: true })
  .extend({ id: idSchema.optional(), sortOrder: z.int().optional() });
export const accountUpdateSchema = accountCreateSchema.omit({ id: true }).partial();

// Rücklagentöpfe
export const reservePotSchema = z.object({
  id: idSchema,
  name: nameSchema,
  accountId: idSchema.nullable(),
  /** `null` = automatisch aus dem Bedarf berechnet */
  monthlyAmountCents: nonNegativeCentsSchema.nullable(),
  /** Tag, an dem die monatliche Rücklage gebucht wird */
  dueDay: dueDaySchema,
  isDefault: z.boolean(),
  ...meta,
});
export type ReservePot = z.infer<typeof reservePotSchema>;
export const reservePotCreateSchema = reservePotSchema
  .pick({ name: true, accountId: true, monthlyAmountCents: true })
  .extend({ id: idSchema.optional(), dueDay: dueDaySchema.default(1) });
export const reservePotUpdateSchema = reservePotSchema
  .pick({ name: true, accountId: true, monthlyAmountCents: true, dueDay: true })
  .partial();

// Kategorien
export const categorySchema = z.object({
  id: idSchema,
  name: nameSchema,
  systemKey: systemCategoryKeySchema.nullable(),
  ...meta,
});
export type Category = z.infer<typeof categorySchema>;
export const categoryCreateSchema = z.object({ id: idSchema.optional(), name: nameSchema });
export const categoryUpdateSchema = z.object({ name: nameSchema });

// Wiederkehrende Posten
export const recurringItemSchema = z.object({
  id: idSchema,
  name: nameSchema,
  amountCents: positiveCentsSchema,
  intervalMonths: intervalSchema,
  startMonth: yearMonthSchema,
  dueDay: dueDaySchema,
  kind: recurringKindSchema,
  categoryId: idSchema,
  /** `null` = Standardtopf, sofern der Posten über die Rücklage läuft */
  reservePotId: idSchema.nullable(),
  ...meta,
});
export type RecurringItem = z.infer<typeof recurringItemSchema>;
export const recurringItemCreateSchema = recurringItemSchema
  .omit({ id: true, createdAt: true, updatedAt: true, reservePotId: true, dueDay: true })
  .extend({
    id: idSchema.optional(),
    reservePotId: idSchema.nullable().optional(),
    dueDay: dueDaySchema.default(1),
  });
export const recurringItemUpdateSchema = recurringItemSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial();

// Buchungen
export const transactionSchema = z.object({
  id: idSchema,
  date: isoDateSchema,
  name: nameSchema,
  categoryId: idSchema,
  amountCents: centsSchema.refine((v) => v !== 0, { error: 'Betrag darf nicht 0 sein' }),
  kind: transactionKindSchema,
  sourceType: sourceTypeSchema.nullable(),
  sourceId: idSchema.nullable(),
  ...meta,
});
export type Transaction = z.infer<typeof transactionSchema>;
/** Manuell erfasste Buchungen sind immer `normal`; die anderen Arten entstehen nur über „Fällige übernehmen“. */
export const transactionCreateSchema = transactionSchema
  .pick({ date: true, name: true, categoryId: true, amountCents: true })
  .extend({ id: idSchema.optional() });
export const transactionUpdateSchema = transactionCreateSchema.omit({ id: true }).partial();

// Bereits gebuchte Fälligkeiten
export const bookedItemSchema = z.object({
  id: idSchema,
  month: yearMonthSchema,
  bookingKey: z.string().min(1).max(100),
  transactionId: idSchema.nullable(),
  ...meta,
});
export type BookedItem = z.infer<typeof bookedItemSchema>;

// Kredite
export const loanSchema = z.object({
  id: idSchema,
  name: nameSchema,
  balanceCents: nonNegativeCentsSchema,
  originalCents: nonNegativeCentsSchema,
  rateBp: basisPointsSchema,
  paymentCents: positiveCentsSchema,
  dueDay: dueDaySchema,
  ...meta,
});
export type Loan = z.infer<typeof loanSchema>;
export const loanCreateSchema = loanSchema
  .pick({ name: true, balanceCents: true, rateBp: true, paymentCents: true })
  .extend({
    id: idSchema.optional(),
    originalCents: nonNegativeCentsSchema.optional(),
    dueDay: dueDaySchema.default(1),
  });
export const loanUpdateSchema = loanSchema
  .pick({
    name: true,
    balanceCents: true,
    originalCents: true,
    rateBp: true,
    paymentCents: true,
    dueDay: true,
  })
  .partial();

// Vermögensstände
export const netWorthSnapshotSchema = z.object({
  id: idSchema,
  date: isoDateSchema,
  assetsCents: centsSchema,
  debtCents: nonNegativeCentsSchema,
  netCents: centsSchema,
  ...meta,
});
export type NetWorthSnapshot = z.infer<typeof netWorthSnapshotSchema>;

// Einstellungen
export const userSettingsSchema = z.object({
  extraPaymentCents: nonNegativeCentsSchema,
  strategy: strategySchema,
  locale: localeSchema,
  currency: currencySchema,
});
export type UserSettings = z.infer<typeof userSettingsSchema>;
export const userSettingsUpdateSchema = userSettingsSchema.partial();
export const defaultUserSettings: UserSettings = {
  extraPaymentCents: 0,
  strategy: 'avalanche',
  locale: 'de',
  currency: 'EUR',
};

// Funktionsfreigaben
export const plans = ['trial', 'founder', 'monthly', 'yearly', 'internal'] as const;
export const entitlementStatuses = ['active', 'past_due', 'canceled', 'expired'] as const;
export const entitlementSources = ['manual', 'stripe', 'revenuecat'] as const;
export const entitlementSchema = z.object({
  plan: z.enum(plans),
  status: z.enum(entitlementStatuses),
  trialEndsAt: timestampSchema.nullable(),
  currentPeriodEnd: timestampSchema.nullable(),
  features: z.array(z.string()),
  source: z.enum(entitlementSources),
});
export type Entitlement = z.infer<typeof entitlementSchema>;
