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
  transactionId: idSchema,
  accountId: idSchema.nullable(),
  accountDeltaCents: centsSchema,
  loanId: idSchema.nullable(),
  loanDeltaCents: centsSchema,
  /** Änderung am Zurückgelegten eines Kredits (Ansparen für Einmalzahlung) */
  loanSavedDeltaCents: centsSchema.default(0),
  ...meta,
});
export type BookedItem = z.infer<typeof bookedItemSchema>;

// Kredite
export const loanKinds = ['installment', 'deadline'] as const;
export const loanKindSchema = z.enum(loanKinds);
export type LoanKind = z.infer<typeof loanKindSchema>;
/** Bei „Tilgen bis Datum“: in Teilen bis zur Frist oder in einer Summe am Fälligkeitstag. */
export const paymentModes = ['spread', 'lump'] as const;
export const paymentModeSchema = z.enum(paymentModes);
export type PaymentMode = z.infer<typeof paymentModeSchema>;

const loanFields = z.object({
  id: idSchema,
  name: nameSchema,
  /** `installment` = Ratenkredit mit fester Rate, `deadline` = ohne Rate, aber mit Frist */
  kind: loanKindSchema,
  balanceCents: nonNegativeCentsSchema,
  originalCents: nonNegativeCentsSchema,
  rateBp: basisPointsSchema,
  /** Monatliche Mindestrate; nur bei Ratenkrediten */
  paymentCents: positiveCentsSchema.nullable(),
  /** Buchungstag der Rate (bei Fristen aus dem Fälligkeitsdatum) */
  dueDay: dueDaySchema,
  /** Optionales Ziel „getilgt bis“ (Monat); nur bei Ratenkrediten */
  targetMonth: yearMonthSchema.nullable(),
  /** Frist; nur bei „Tilgen bis Datum“ */
  dueDate: isoDateSchema.nullable(),
  paymentMode: paymentModeSchema.nullable(),
  /** Für eine Einmalzahlung schon zurückgelegt */
  savedCents: nonNegativeCentsSchema.default(0),
  /** Selbst festgelegte Extra-Tilgung pro Monat (nicht bei Einmalzahlungen) */
  extraMonthlyCents: nonNegativeCentsSchema.default(0),
  ...meta,
});

type LoanShape = Pick<
  z.infer<typeof loanFields>,
  'kind' | 'paymentCents' | 'targetMonth' | 'dueDate' | 'paymentMode'
>;

/** Welche Felder zu welcher Art gehören. Liefert Fehlermeldungen je Feld (leer = in Ordnung). */
export function loanShapeIssues(l: LoanShape): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (l.kind === 'installment') {
    if (l.paymentCents === null) issues.push({ path: 'paymentCents', message: 'Rate fehlt' });
    if (l.dueDate !== null) issues.push({ path: 'dueDate', message: 'Nur bei Fristen' });
    if (l.paymentMode !== null) issues.push({ path: 'paymentMode', message: 'Nur bei Fristen' });
  } else {
    if (l.dueDate === null) issues.push({ path: 'dueDate', message: 'Frist fehlt' });
    if (l.paymentMode === null) issues.push({ path: 'paymentMode', message: 'Zahlweise fehlt' });
    if (l.paymentCents !== null)
      issues.push({ path: 'paymentCents', message: 'Keine Rate bei Fristen' });
    if (l.targetMonth !== null)
      issues.push({ path: 'targetMonth', message: 'Ziel ergibt sich aus der Frist' });
  }
  return issues;
}

export const loanSchema = loanFields.superRefine((l, ctx) => {
  for (const i of loanShapeIssues(l))
    ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
});
export type Loan = z.infer<typeof loanSchema>;

const loanCreateCommon = {
  id: idSchema.optional(),
  name: nameSchema,
  balanceCents: nonNegativeCentsSchema,
  originalCents: nonNegativeCentsSchema.optional(),
  rateBp: basisPointsSchema.default(0),
};
export const loanCreateSchema = z.discriminatedUnion('kind', [
  z.object({
    ...loanCreateCommon,
    kind: z.literal('installment'),
    paymentCents: positiveCentsSchema,
    dueDay: dueDaySchema.default(1),
    targetMonth: yearMonthSchema.nullable().default(null),
    extraMonthlyCents: nonNegativeCentsSchema.default(0),
  }),
  z.object({
    ...loanCreateCommon,
    kind: z.literal('deadline'),
    dueDate: isoDateSchema,
    paymentMode: paymentModeSchema,
    savedCents: nonNegativeCentsSchema.default(0),
    extraMonthlyCents: nonNegativeCentsSchema.default(0),
  }),
]);
export type LoanCreate = z.infer<typeof loanCreateSchema>;
/** Teiländerung; der Server prüft danach den Gesamtstand mit `loanShapeIssues`. */
export const loanUpdateSchema = loanFields
  .pick({
    name: true,
    kind: true,
    balanceCents: true,
    originalCents: true,
    rateBp: true,
    paymentCents: true,
    dueDay: true,
    targetMonth: true,
    dueDate: true,
    paymentMode: true,
    savedCents: true,
    extraMonthlyCents: true,
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
  /**
   * Monatlich für Kredite verfügbares Geld (optional). Ändert keinen Plan, sondern dient nur für
   * Vorschläge zur Extra-Tilgung.
   */
  loanBudgetCents: nonNegativeCentsSchema.nullable(),
  strategy: strategySchema,
  locale: localeSchema,
  currency: currencySchema,
});
export type UserSettings = z.infer<typeof userSettingsSchema>;
export const userSettingsUpdateSchema = userSettingsSchema.partial();
export const defaultUserSettings: UserSettings = {
  loanBudgetCents: null,
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

// Antwort von GET /api/me
export const meSchema = z.object({
  user: z.object({ id: idSchema, name: z.string(), email: z.string() }),
  settings: userSettingsSchema,
  entitlement: entitlementSchema.extend({ active: z.boolean() }).nullable(),
});
export type Me = z.infer<typeof meSchema>;
