/** Betrag in ganzen Cent. Negative Werte nur dort, wo ein Vorzeichen fachlich gemeint ist (Buchungen). */
export type Cents = number;
/** Zinssatz in Basispunkten: 5,9 % p. a. = 590. */
export type BasisPoints = number;

/** 1 Mrd. €. Hält Zwischenergebnisse (Betrag × Basispunkte) sicher im Integer-Bereich von `number`. */
export const MAX_CENTS = 100_000_000_000;
/** 100 % p. a. */
export const MAX_BASIS_POINTS = 10_000;

export function isCents(value: unknown): value is Cents {
  return Number.isSafeInteger(value) && Math.abs(value as number) <= MAX_CENTS;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Kaufmännisch gerundet (halbe Cent weg von null), für nicht-ganzzahlige Zwischenergebnisse. */
export function roundHalfAwayFromZero(value: number): Cents {
  const rounded = Math.round(Math.abs(value));
  return value < 0 ? -rounded : rounded;
}

/**
 * Zinsen eines Monats auf einen Saldo: Saldo × Zins p. a. / 12, auf ganze Cent gerundet.
 * Rechnet mit ganzen Zahlen, damit keine Gleitkomma-Artefakte entstehen.
 */
export function monthlyInterest(balance: Cents, rate: BasisPoints): Cents {
  if (balance <= 0 || rate <= 0) return 0;
  const denominator = 10_000 * 12;
  const numerator = balance * rate;
  return Math.floor((numerator + denominator / 2) / denominator);
}

/**
 * Liest einen vom Nutzer eingegebenen Eurobetrag und gibt Cent zurück, oder `null` bei ungültiger Eingabe.
 *
 * Akzeptiert deutsches Format („1.234,56“, „12,5“) und Punkt als Dezimaltrenner, wenn kein Komma
 * vorkommt und nach dem Punkt ein oder zwei Ziffern stehen („12.50“). Ein Punkt mit genau drei
 * Ziffern danach gilt als Tausendertrenner („1.234“ = 1234 €). Mehr als zwei Nachkommastellen sind ungültig.
 */
export function parseEuroToCents(input: string): Cents | null {
  let s = input.trim().replace(/\s|€/g, '');
  if (s === '') return null;
  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  }
  let intPart: string;
  let fracPart = '';
  if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length !== 2) return null;
    [intPart, fracPart] = parts as [string, string];
    if (intPart === '' && fracPart !== '') intPart = '0'; // „,5“
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(intPart)) return null;
    intPart = intPart.replace(/\./g, '');
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [intPart, fracPart] = s.split('.') as [string, string];
  } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) {
    intPart = s.replace(/\./g, '');
  } else {
    return null;
  }
  if (!/^\d{0,2}$/.test(fracPart) || intPart === '') return null;
  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0'));
  if (!isCents(cents)) return null;
  return negative ? -cents : cents;
}

/** Wandelt einen Prozentsatz als Text („5,9“, „5.9“) in Basispunkte um. Höchstens zwei Nachkommastellen. */
export function parsePercentToBasisPoints(input: string): BasisPoints | null {
  const s = input.trim().replace(/\s|%/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.') as [string, string?];
  const bp = Number(i) * 100 + Number(f.padEnd(2, '0'));
  return bp <= MAX_BASIS_POINTS ? bp : null;
}
