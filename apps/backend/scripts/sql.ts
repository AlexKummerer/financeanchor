import { getTableColumns, getTableName } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/** SQL-Literal für die Werte, die unsere Tabellen speichern. */
export function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Ungültige Zahl: ${value}`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return String(value.getTime());
  if (typeof value === 'object') return literal(JSON.stringify(value));
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Erzeugt INSERT-Anweisungen mit den echten Spaltennamen aus dem Drizzle-Schema. */
export function insertSql<T extends SQLiteTable>(table: T, rows: T['$inferInsert'][]): string[] {
  const columns = Object.entries(getTableColumns(table));
  return rows.map((row) => {
    const present = columns.filter(([key]) => (row as Record<string, unknown>)[key] !== undefined);
    const names = present.map(([, col]) => `"${col.name}"`).join(', ');
    const values = present
      .map(([key]) => literal((row as Record<string, unknown>)[key]))
      .join(', ');
    return `INSERT INTO "${getTableName(table)}" (${names}) VALUES (${values});`;
  });
}
