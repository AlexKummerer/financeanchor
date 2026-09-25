import { newId } from '@financeanchor/shared';
import { and, eq, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from './client.js';

/** Fachliche Tabelle mit den Pflichtspalten. */
export type UserTable = SQLiteTable & {
  id: SQLiteColumn;
  userId: SQLiteColumn;
  createdAt: SQLiteColumn;
  updatedAt: SQLiteColumn;
};

/** Teiländerung; `undefined` bedeutet „nicht ändern“ (so liefert Zod `.partial()` die Werte). */
type Patch<T extends UserTable> = {
  [K in keyof T['$inferInsert']]?: T['$inferInsert'][K] | undefined;
};

type Insert<T extends UserTable> = Omit<
  T['$inferInsert'],
  'id' | 'userId' | 'createdAt' | 'updatedAt'
> & {
  id?: string | undefined;
};

/**
 * Datenzugriff eines Nutzers. Jede Abfrage und jeder Schreibzugriff ist auf `userId` beschränkt;
 * Routen greifen nur hierüber auf fachliche Tabellen zu.
 */
export function scoped(db: Db, userId: string) {
  const own = <T extends UserTable>(table: T, extra?: SQL) =>
    extra ? and(eq(table.userId, userId), extra) : eq(table.userId, userId);
  const byId = <T extends UserTable>(table: T, id: string) => own(table, eq(table.id, id));

  return {
    db,
    userId,
    own,
    byId,

    list<T extends UserTable>(table: T, where?: SQL) {
      return db
        .select()
        .from(table as SQLiteTable)
        .where(own(table, where)) as unknown as Promise<T['$inferSelect'][]>;
    },

    async get<T extends UserTable>(table: T, id: string): Promise<T['$inferSelect'] | undefined> {
      const rows = (await db
        .select()
        .from(table as SQLiteTable)
        .where(byId(table, id))
        .limit(1)) as T['$inferSelect'][];
      return rows[0];
    },

    /** Zeile mit ID, `userId` und Zeitstempeln für einen Insert. */
    row<T extends UserTable>(_table: T, values: Insert<T>, now = Date.now()): T['$inferInsert'] {
      return {
        ...values,
        id: values.id ?? newId(now),
        userId,
        createdAt: now,
        updatedAt: now,
      } as T['$inferInsert'];
    },

    insert<T extends UserTable>(table: T, values: Insert<T>, now = Date.now()) {
      return db
        .insert(table)
        .values(this.row(table, values, now))
        .returning();
    },

    update<T extends UserTable>(table: T, id: string, patch: Patch<T>, now = Date.now()) {
      const { id: _id, userId: _u, createdAt: _c, ...rest } = patch as Record<string, unknown>;
      const values = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      return db
        .update(table)
        .set({ ...values, updatedAt: now } as T['$inferInsert'])
        .where(byId(table, id))
        .returning();
    },

    remove<T extends UserTable>(table: T, id: string) {
      return db.delete(table).where(byId(table, id)).returning({ id: table.id });
    },
  };
}

export type Scoped = ReturnType<typeof scoped>;
