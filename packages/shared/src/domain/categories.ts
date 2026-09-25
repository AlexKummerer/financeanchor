import type { SystemCategoryKey } from '../schemas/common.js';

/** Systemkategorien werden automatisch vergeben und sind nicht umbenenn- oder löschbar. */
export const systemCategoryNames: Record<SystemCategoryKey, string> = {
  reserve: 'Rücklage',
  transfer: 'Umbuchung',
  loans: 'Kredite',
};

/** Startkategorien für neue Nutzer; frei umbenenn-, lösch- und erweiterbar. */
export const defaultCategoryNames = [
  'Lebensmittel',
  'Wohnen',
  'Mobilität',
  'Versicherungen',
  'Freizeit',
  'Kleidung',
  'Gesundheit',
  'Abos',
  'Geschenke',
  'Essen gehen',
  'Gehalt',
  'Sparen',
  'Sonstiges',
] as const;

/** Vergleichsschlüssel: getrimmt, ohne Unterschied zwischen Groß- und Kleinschreibung. */
export function categoryNameKey(name: string): string {
  return name.trim().toLocaleLowerCase('de');
}

/** Name ist bereits vergeben (eigene oder Systemkategorie), optional ohne die Kategorie `exceptId`. */
export function isCategoryNameTaken(
  name: string,
  categories: readonly { id: string; name: string }[],
  exceptId?: string,
): boolean {
  const key = categoryNameKey(name);
  if (Object.values(systemCategoryNames).some((n) => categoryNameKey(n) === key)) return true;
  return categories.some((c) => c.id !== exceptId && categoryNameKey(c.name) === key);
}
