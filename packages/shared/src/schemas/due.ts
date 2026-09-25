import { z } from 'zod';
import { isoDateSchema, positiveCentsSchema } from './common.js';

export const dueOverrideSchema = z.object({
  key: z.string().min(1).max(100),
  date: isoDateSchema.optional(),
  amountCents: positiveCentsSchema.optional(),
});

/**
 * „Fällige übernehmen“: `today` kommt vom Client (Zeitzone des Nutzers). Ohne `keys` werden alle
 * bis heute fälligen, offenen Einträge gebucht.
 */
export const dueBookRequestSchema = z.object({
  today: isoDateSchema,
  keys: z.array(z.string().min(1).max(100)).max(500).optional(),
  overrides: z.array(dueOverrideSchema).max(500).default([]),
});
export type DueBookRequest = z.infer<typeof dueBookRequestSchema>;
