import { z } from 'zod';
import { isoDateSchema, positiveCentsSchema } from './common.js';

export const dueOverrideSchema = z.object({
  key: z.string().min(1).max(100),
  date: isoDateSchema.optional(),
  amountCents: positiveCentsSchema.optional(),
});

/** Fälligkeit ist schon von Hand gebucht: mit dieser Buchung verknüpfen statt neu anlegen. */
export const dueLinkSchema = z.object({
  key: z.string().min(1).max(100),
  transactionId: z.string().min(1).max(64),
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
