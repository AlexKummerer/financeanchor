import { idSchema } from '@financeanchor/shared';
import type { Context } from 'hono';
import { z } from 'zod';
import { scoped } from '../db/scoped.js';
import { AppError } from '../errors.js';
import type { AppEnv } from '../middleware/context.js';

export const idParam = z.object({ id: idSchema });

export const scopedFrom = (c: Context<AppEnv>) => scoped(c.var.db, c.var.userId);

/** Erste Zeile oder 404. */
export function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new AppError(404, 'not_found', `${what} not found`);
  return row;
}

/** Zeile oder 404. */
export function found<T>(row: T | undefined, what: string): T {
  if (row === undefined) throw new AppError(404, 'not_found', `${what} not found`);
  return row;
}

/** Prüft, ob ein Fehler (oder seine Ursache) eine Fremdschlüsselverletzung ist. */
export function isForeignKeyError(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; e && i < 5; i++) {
    if (e instanceof Error && e.message.includes('FOREIGN KEY')) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
