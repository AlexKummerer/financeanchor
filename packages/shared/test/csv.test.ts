import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseAmount, parseCsv, parseDate } from '../src/import/csv.js';

describe('CSV lesen', () => {
  it('Anführungszeichen, Trennzeichen und Zeilenumbrüche im Feld', () => {
    const text =
      '﻿"Datum";"Text";"Betrag"\r\n"01.09.2026";"Miete; warm\nSeptember";"-850,00"\n\n"02.09.2026";"Er sagte ""hallo""";"12,5"';
    expect(parseCsv(text, ';')).toEqual([
      ['Datum', 'Text', 'Betrag'],
      ['01.09.2026', 'Miete; warm\nSeptember', '-850,00'],
      ['02.09.2026', 'Er sagte "hallo"', '12,5'],
    ]);
  });

  it('erkennt das Trennzeichen trotz Vorspann-Zeilen', () => {
    const semi =
      'Umsatzanzeige;Datei erstellt am: 26.09.2026\nIBAN;DE12 3456\n\nBuchung;Valuta;Auftraggeber;Buchungstext;Betrag\n01.09.2026;01.09.2026;X;Y;-1,00\n02.09.2026;02.09.2026;X;Y;-2,00';
    expect(detectDelimiter(semi)).toBe(';');
    expect(
      detectDelimiter(
        'Datum,Beschreibung,Betrag\n01/09/2026,"Shop, Berlin",12.50\n02/09/2026,Tanken,45.00',
      ),
    ).toBe(',');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });
});

describe('Beträge und Datum', () => {
  it.each([
    ['-1.234,56', -123456],
    ['1234,56 €', 123456],
    ['-45.50', -4550],
    ['1,234.56', 123456],
    ['12,5', 1250],
    ['+3,00', 300],
    ['(12,00)', -1200],
    ['12,00-', -1200],
    ['1.000', 100000],
    ['−7,10', -710],
    ['abc', null],
    ['', null],
  ])('%s → %s', (raw, cents) => expect(parseAmount(raw)).toBe(cents));

  it.each([
    ['31.12.2026', '2026-12-31'],
    ['01.09.26', '2026-09-01'],
    ['1.9.2026', '2026-09-01'],
    ['15/09/2026', '2026-09-15'],
    ['2026-09-15', '2026-09-15'],
    ['31.02.2026', null],
    ['Umsatz', null],
  ])('%s → %s', (raw, iso) => expect(parseDate(raw)).toBe(iso));
});
