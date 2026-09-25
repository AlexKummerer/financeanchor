/** Kalendermonat im Format `YYYY-MM`. */
export type YearMonth = string;
/** Kalendertag im Format `YYYY-MM-DD`. */
export type IsoDate = string;

const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isYearMonth(value: string): value is YearMonth {
  return YM.test(value);
}

export function isIsoDate(value: string): value is IsoDate {
  const m = DATE.exec(value);
  if (!m) return false;
  return Number(m[3]) <= daysInMonth(`${m[1]}-${m[2]}`);
}

/** Fortlaufende Monatsnummer (Jahr × 12 + Monat − 1), damit Monatsabstände einfache Subtraktion sind. */
export function monthIndex(ym: YearMonth): number {
  const m = YM.exec(ym);
  if (!m) throw new Error(`Ungültiger Monat: ${ym}`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

export function fromMonthIndex(index: number): YearMonth {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  return fromMonthIndex(monthIndex(ym) + n);
}

export function monthsBetween(from: YearMonth, to: YearMonth): number {
  return monthIndex(to) - monthIndex(from);
}

export function monthOfDate(date: IsoDate): YearMonth {
  return date.slice(0, 7);
}

/** Monat im Jahr, 1–12. */
export function monthNumber(ym: YearMonth): number {
  return (monthIndex(ym) % 12) + 1;
}

export function yearOf(ym: YearMonth): number {
  return Math.floor(monthIndex(ym) / 12);
}

export function daysInMonth(ym: YearMonth): number {
  const idx = monthIndex(ym);
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Tag im Monat; liegt `day` hinter dem Monatsende, wird der letzte Tag genommen (31. im Februar → 28./29.). */
export function dateInMonth(ym: YearMonth, day: number): IsoDate {
  const d = Math.min(Math.max(1, day), daysInMonth(ym));
  return `${ym}-${String(d).padStart(2, '0')}`;
}

/** Tagesdifferenz zweier Daten (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Plausibilität eines vom Client gemeldeten „heute“: höchstens einen Tag vom UTC-Datum des Servers
 * entfernt (Zeitzonen reichen von UTC−12 bis UTC+14).
 */
export function isPlausibleToday(clientToday: IsoDate, serverNow: number): boolean {
  const serverToday = new Date(serverNow).toISOString().slice(0, 10);
  return Math.abs(daysBetween(serverToday, clientToday)) <= 1;
}
