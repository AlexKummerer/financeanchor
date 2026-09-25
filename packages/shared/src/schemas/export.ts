import { z } from 'zod';
import {
  basisPointsSchema,
  currencySchema,
  dueDaySchema,
  idSchema,
  localeSchema,
  nameSchema,
  nonNegativeCentsSchema,
  positiveCentsSchema,
  strategySchema,
  timestampSchema,
} from './common.js';
import {
  accountSchema,
  bookedItemSchema,
  categorySchema,
  loanSchema,
  netWorthSnapshotSchema,
  recurringItemSchema,
  reservePotSchema,
  transactionSchema,
  userSettingsSchema,
} from './entities.js';

export const EXPORT_FORMAT = 'financeanchor-export';
export const EXPORT_VERSION = 2;

const common = {
  accounts: z.array(accountSchema),
  reservePots: z.array(reservePotSchema),
  categories: z.array(categorySchema),
  recurringItems: z.array(recurringItemSchema),
  transactions: z.array(transactionSchema),
  bookedItems: z.array(bookedItemSchema),
  snapshots: z.array(netWorthSnapshotSchema),
};

/** Vollständige Sicherung aller Daten eines Nutzers (Version 2). */
export const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  data: z.object({
    settings: userSettingsSchema,
    loans: z.array(loanSchema),
    ...common,
  }),
});
export type ExportFile = z.infer<typeof exportSchema>;

/** Version 1: nur Ratenkredite, Extra-Tilgung statt Budget. */
const exportV1Schema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  data: z.object({
    settings: z.object({
      extraPaymentCents: nonNegativeCentsSchema,
      strategy: strategySchema,
      locale: localeSchema,
      currency: currencySchema,
    }),
    loans: z.array(
      z.object({
        id: idSchema,
        name: nameSchema,
        balanceCents: nonNegativeCentsSchema,
        originalCents: nonNegativeCentsSchema,
        rateBp: basisPointsSchema,
        paymentCents: positiveCentsSchema,
        dueDay: dueDaySchema,
        createdAt: timestampSchema,
        updatedAt: timestampSchema,
      }),
    ),
    ...common,
  }),
});

/** Nimmt Sicherungen aller Versionen an und liefert immer die aktuelle Form. */
export const importFileSchema = z
  .union([exportSchema, exportV1Schema])
  .transform((file): ExportFile => {
    if (file.version === EXPORT_VERSION) return file;
    const { extraPaymentCents, ...settings } = file.data.settings;
    const openPayments = file.data.loans
      .filter((l) => l.balanceCents > 0)
      .reduce((s, l) => s + l.paymentCents, 0);
    return {
      ...file,
      version: EXPORT_VERSION,
      data: {
        ...file.data,
        // Wie bei der Datenbank-Migration: Budget nur dort, wo es eine Extra-Tilgung gab
        settings: {
          ...settings,
          loanBudgetCents: extraPaymentCents > 0 ? openPayments + extraPaymentCents : null,
          // (Version 1 kannte nur die Extra-Tilgung; sie wird als verfügbares Geld übernommen.)
        },
        loans: file.data.loans.map((l) => ({
          ...l,
          kind: 'installment' as const,
          targetMonth: null,
          dueDate: null,
          paymentMode: null,
          savedCents: 0,
          extraMonthlyCents: 0,
        })),
      },
    };
  });
