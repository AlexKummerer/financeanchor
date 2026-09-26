import { describe, expect, it } from 'vitest';
import {
  findLikelyMatch,
  importKeys,
  importLabel,
  looksLikeCardSettlement,
  looksLikeCardPayment,
  suggestCategoryId,
} from '../src/index.js';

const row = (date: string, amountCents: number, counterparty = 'REWE', purpose = 'Einkauf') => ({
  date,
  amountCents,
  counterparty,
  purpose,
});

describe('Fingerabdrücke', () => {
  it('unabhängig vom Umdrehen des Vorzeichens', () => {
    const asInFile = importKeys('amex', [{ ...row('2026-09-01', 1799), fileCents: 1799 }]);
    const flipped = importKeys('amex', [{ ...row('2026-09-01', -1799), fileCents: 1799 }]);
    expect(flipped).toEqual(asInFile);
    // Ältere Zeilen ohne fileCents (vor dem Umdrehen gespeichert) passen weiterhin
    expect(importKeys('amex', [row('2026-09-01', 1799)])).toEqual(asInFile);
  });

  it('stabil, je Konto verschieden, gleiche Zeilen durchnummeriert', () => {
    const rows = [row('2026-09-01', -450), row('2026-09-01', -450), row('2026-09-02', -450)];
    const a = importKeys('giro', rows);
    expect(a).toEqual(importKeys('giro', rows));
    expect(new Set(a).size).toBe(3);
    expect(a[0]).toMatch(/^imp:[0-9a-f]{16}$/);
    expect(importKeys('amex', rows)[0]).not.toBe(a[0]);
    // Groß-/Kleinschreibung und Leerzeichen im Text spielen keine Rolle
    expect(importKeys('giro', [row('2026-09-01', -450, ' rewe ', 'EINKAUF')])[0]).toBe(a[0]);
  });
});

describe('Wahrscheinlich schon gebucht', () => {
  const existing = [
    { id: 'miete', date: '2026-09-01', amountCents: -85000, name: 'Miete', importKey: null },
    { id: 'alt', date: '2026-09-02', amountCents: -85000, name: 'Miete', importKey: 'imp:x' },
    { id: 'rate', date: '2026-09-10', amountCents: -36499, name: 'Rate', importKey: null },
  ];

  it('gleicher Betrag, bis drei Tage Abstand, noch nicht verknüpft', () => {
    expect(findLikelyMatch(row('2026-09-03', -85000), existing)?.id).toBe('miete');
    expect(findLikelyMatch(row('2026-09-05', -85000), existing)).toBeNull();
    expect(findLikelyMatch(row('2026-09-01', -85000), existing, new Set(['miete']))).toBeNull();
    expect(findLikelyMatch(row('2026-09-12', -36499), existing)?.id).toBe('rate');
  });
});

describe('Kartenabbuchung auf dem Girokonto', () => {
  it('erkennt Anbieter und eigene Kartennamen, nur Belastungen', () => {
    expect(
      looksLikeCardPayment(
        row('2026-10-04', -14450, 'American Express Europe S.A.', 'Lastschrift'),
      ),
    ).toBe(true);
    expect(looksLikeCardPayment(row('2026-09-24', -5000, 'DKB AG', 'Kreditkartenabrechnung'))).toBe(
      true,
    );
    expect(
      looksLikeCardPayment(row('2026-09-24', -5000, 'Bank', 'Ausgleich Meine Visa'), [
        'Meine Visa',
      ]),
    ).toBe(true);
    expect(looksLikeCardPayment(row('2026-09-24', 5000, 'American Express', 'Gutschrift'))).toBe(
      false,
    );
    expect(looksLikeCardPayment(row('2026-09-24', -5000, 'REWE', 'Einkauf Karte'))).toBe(false);
  });
});

describe('Kategorie vorschlagen', () => {
  const known = [
    { name: 'REWE', categoryId: 'essen' },
    { name: 'Stadtwerke Strom', categoryId: 'wohnen' },
    { name: 'Stadtwerke', categoryId: 'sonst' },
    { name: 'Ab', categoryId: 'kurz' },
  ];
  it('gleicher Name, sonst längster enthaltener Name', () => {
    expect(suggestCategoryId('rewe', known)).toBe('essen');
    expect(suggestCategoryId('REWE 0887 OLCHING', known)).toBe('essen');
    expect(suggestCategoryId('Stadtwerke Strom Abschlag', known)).toBe('wohnen');
    expect(suggestCategoryId('Abo Netflix', known)).toBeNull();
    expect(sugg('PREWE GmbH')).toBeNull();
  });
  const sugg = (t: string) => suggestCategoryId(t, known);
});

describe('Merkmal zum Wiedererkennen', () => {
  it('ohne wechselnde Nummern', () => {
    expect(importLabel(row('2026-09-01', -899, 'PAYPAL *DISNEYPLUS 800724235230'))).toBe(
      'paypal *disneyplus',
    );
    expect(importLabel(row('2026-10-01', -899, 'PAYPAL *DISNEYPLUS 811111111111'))).toBe(
      'paypal *disneyplus',
    );
    expect(importLabel(row('2026-09-01', -4210, 'LIDL 4691           OLCHING'))).toBe(
      'lidl olching',
    );
    expect(importLabel(row('2026-09-01', -500, '', 'Miete Oktober'))).toBe('miete oktober');
    expect(importLabel(row('2026-09-01', -500, '12345', ''))).toBeNull();
  });
});

describe('Zahlung an die Karte', () => {
  it('nur Gutschriften mit typischem Text', () => {
    expect(
      looksLikeCardSettlement(row('2026-09-15', 50000, 'ZAHLUNG/ÜBERWEISUNG ERHALTEN BESTEN DANK')),
    ).toBe(true);
    expect(
      looksLikeCardSettlement(row('2026-09-15', 1999, 'AMAZON EU', 'Gutschrift Retoure')),
    ).toBe(false);
    expect(looksLikeCardSettlement(row('2026-09-15', -50000, 'ZAHLUNG ERHALTEN'))).toBe(false);
  });
});
