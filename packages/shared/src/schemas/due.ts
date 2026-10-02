import { z } from 'zod';
import { isoDateSchema, positiveCentsSchema } from './common.js';

export const dueOverrideSchema = z.object({
  key: z.string().min(1).max(100),
  date: isoDateSchema.optional(),
  amountCents: positiveCentsSchema.optional(),
});

/**
 * Fälligkeit ist schon von Hand gebucht: mit diesen Buchungen verknüpfen statt neu anlegen (auch in
 * mehreren Teilen, z. B. 2 × 36 € für 72 €).
 */
export const dueLinkSchema = z.object({
  key: z.string().min(1).max(100),
  transactionIds: z.array(z.string().min(1).max(64)).min(1).max(20),
});
export type DueLink = z.infer<typeof dueLinkSchema>;

/**
 * „Fällige übernehmen“: `today` kommt vom Client (Zeitzone des Nutzers). Ohne `keys` werden alle
 * bis heute fälligen, offenen Einträge gebucht. `links` werden zusätzlich gebucht, aber mit der
 * vorhandenen Buchung (deren Tag und Betrag gelten).
 */
export const dueBookRequestSchema = z.object({
  today: isoDateSchema,
  keys: z.array(z.string().min(1).max(100)).max(500).optional(),
  overrides: z.array(dueOverrideSchema).max(500).default([]),
  links: z.array(dueLinkSchema).max(100).default([]),
});
export type DueBookRequest = z.infer<typeof dueBookRequestSchema>;

/** Gebuchte Fälligkeit wieder öffnen; die Buchungen bleiben als eigene Buchungen. */
export const dueUnbookRequestSchema = z.object({
  today: isoDateSchema,
  key: z.string().min(1).max(100),
});
export type DueUnbookRequest = z.infer<typeof dueUnbookRequestSchema>;
