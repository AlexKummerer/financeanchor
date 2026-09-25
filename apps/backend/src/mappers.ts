import type * as t from './db/schema.js';

/** Datenbankzeilen → API-Form (ohne `userId` und interne Spalten). */
export function strip<T extends { userId: string }>(row: T): Omit<T, 'userId'> {
  const { userId: _userId, ...rest } = row;
  return rest;
}

export function categoryToApi(row: typeof t.categories.$inferSelect) {
  const { userId: _u, nameKey: _k, ...rest } = row;
  return rest;
}
