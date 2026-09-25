import { getTableColumns } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { drizzle } from 'drizzle-orm/d1';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.js';

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;

/** D1 erlaubt höchstens 100 gebundene Parameter je Abfrage. */
export const D1_MAX_PARAMS = 100;

/**
 * Teilt einen Insert so auf, dass keine Abfrage mehr als 100 Parameter hat.
 * Ergebnis ist eine Liste von Abfragen für `db.batch()` (dadurch weiterhin atomar).
 */
export function chunkedInsert<T extends SQLiteTable>(db: Db, table: T, rows: T['$inferInsert'][]) {
  const columns = Object.keys(getTableColumns(table)).length;
  const size = Math.max(1, Math.floor(D1_MAX_PARAMS / columns));
  const queries = [];
  for (let i = 0; i < rows.length; i += size) {
    queries.push(db.insert(table).values(rows.slice(i, i + size)));
  }
  return queries;
}

/** Führt Abfragen atomar als D1-Batch aus; eine leere Liste ist ein No-op. */
export async function runBatch(db: Db, queries: BatchItem<'sqlite'>[]) {
  const [first, ...rest] = queries;
  if (!first) return [];
  return db.batch([first, ...rest]);
}
