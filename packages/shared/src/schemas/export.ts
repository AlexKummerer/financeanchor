import { z } from 'zod';
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
export const EXPORT_VERSION = 1;

/** Vollständige Sicherung aller Daten eines Nutzers. */
export const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  data: z.object({
    settings: userSettingsSchema,
    accounts: z.array(accountSchema),
    reservePots: z.array(reservePotSchema),
    categories: z.array(categorySchema),
    recurringItems: z.array(recurringItemSchema),
    transactions: z.array(transactionSchema),
    bookedItems: z.array(bookedItemSchema),
    loans: z.array(loanSchema),
    snapshots: z.array(netWorthSnapshotSchema),
  }),
});
export type ExportFile = z.infer<typeof exportSchema>;
