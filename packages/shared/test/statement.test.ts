import { describe, expect, it } from 'vitest';
import {
  cleanSepaPurpose,
  parseStatement,
  parseStatementSections,
  positiveShare,
  splitComdirectText,
} from '../src/index.js';

/** Eigene Beispiele im Format der Bank-Exporte (Kopfzeilen wie im Original, Daten ausgedacht). */
const files = {
  sparkasse: [
    '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
    '"DE00";"05.09.26";"05.09.26";"FOLGELASTSCHRIFT";"Online-Shop";"";"";"";"";"";"";"Shop GmbH";"DE11";"X";"-12,50";"EUR";"Umsatz vorgemerkt"',
    '"DE00";"01.09.26";"01.09.26";"GUTSCHRIFT";"EREF+123 SVWZ+Lohn September ABWA+Firma";"";"";"";"";"";"";"Firma AG";"DE22";"Y";"3.100,00";"EUR";"Umsatz gebucht"',
    '"DE00";"02.09.26";"02.09.26";"BUCHUNG";"KOSTEN KONTO";"";"";"";"";"";"";"Sparkasse";"";"";"-5,95";"EUR";"Umsatz gebucht"',
  ].join('\n'),
  volksbank:
    '﻿Bezeichnung Auftragskonto;IBAN Auftragskonto;BIC Auftragskonto;Bankname Auftragskonto;Buchungstag;Valutadatum;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;BIC (SWIFT-Code) Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag;Waehrung;Saldo nach Buchung;Bemerkung;Gekennzeichneter Umsatz;Glaeubiger ID;Mandatsreferenz\r\n' +
    'Giro;DE00;X;VR;03.09.2026;03.09.2026;Versicherung AG;DE33;Z;Basislastschrift;Beitrag Haftpflicht EREF: 1 MREF: 2 CRED: 3;-45,11;EUR;1.200,00;;;DE9;M1\r\n',
  dkb: [
    '"Girokonto";"DE00"',
    '""',
    '"Kontostand vom 26.09.2026:";"4.093,32 €"',
    '""',
    '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
    '"08.09.26";"08.09.26";"Gebucht";"Max Muster";"Ich";"Nebenkosten";"Eingang";"DE1";"200";"";"";""',
    '"05.09.26";"05.09.26";"Gebucht";"Ich";"Baumarkt GmbH";"Einkauf";"Ausgang";"DE2";"-1.013,47";"";"";""',
    '"06.09.26";"06.09.26";"Vorgemerkt";"Ich";"Café";"Kaffee";"Ausgang";"DE3";"-3,5";"";"";""',
  ].join('\n'),
  ing: [
    'Umsatzanzeige;Datei erstellt am: 26.09.2026 10:00',
    '',
    'IBAN;DE00',
    'Zeitraum;01.09.2026 - 26.09.2026',
    'Saldo;66.331,90;EUR',
    '',
    'In der CSV-Datei finden Sie alle bereits gebuchten Umsätze.',
    '',
    'Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Betrag;Währung',
    '09.09.2026;09.09.2026;Stadtwerke;Lastschrift;Abschlag Strom;-78,00;EUR',
    '10.09.2026;10.09.2026;Tankstelle;Lastschrift;Tanken;-1.234,56;EUR',
  ].join('\n'),
  comdirect: [
    ';',
    '"Umsätze Girokonto";"Zeitraum: 01.09.2026 - 26.09.2026";',
    '',
    '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR";',
    '"offen";"--";"Lastschrift";"Empfänger: Café Kto/IBAN: DE1 Buchungstext: Kaffee";"-3,50";',
    '"04.09.2026";"04.09.2026";"Lastschrift / Belastung";"Empfänger: REWE Markt GmbHKto/IBAN: DE2 BLZ/BIC: X Buchungstext: Einkauf Ref. 123";"-42,10";',
    '',
    '"Umsätze Visa-Karte (Kreditkarte)";"Zeitraum: 01.09.2026 - 26.09.2026";',
    '',
    '"Buchungstag";"Umsatztag";"Vorgang";"Referenz";"Buchungstext";"Umsatz in EUR";',
    '"07.09.2026";"06.09.2026";"Visa-Umsatz";"R1";"AMAZON EU";"-19,99";',
  ].join('\n'),
  amex: [
    'Datum,Beschreibung,Karteninhaber,Konto #,Betrag,Weitere Details,Erscheint auf Ihrer Abrechnung als,Adresse,Stadt,PLZ,Land,Betreff',
    '20/09/2026,LIDL 4691           OLCHING,MAX MUSTER,-11009,"94,23",,LIDL,"STRASSE 1\nHAUS B",OLCHING,82140,DE,\'X1\'',
    '15/09/2026,ZAHLUNG/ÜBERWEISUNG ERHALTEN BESTEN DANK,MAX MUSTER,-11009,"-500,00",,,,,,,',
  ].join('\n'),
};

const brief = (text: string) =>
  parseStatement(text)?.rows.map((r) => [r.date, r.amountCents, r.counterparty, r.purpose]);

describe('Bank-Exporte', () => {
  it('Sparkasse: vorgemerkte übersprungen, SEPA-Zweck aufbereitet', () => {
    const s = parseStatement(files.sparkasse);
    expect(s?.profile.preset).toBe('sparkasse');
    expect(s?.skipped).toEqual([{ line: 2, reason: 'filtered' }]);
    expect(brief(files.sparkasse)).toEqual([
      ['2026-09-01', 310000, 'Firma AG', 'Lohn September'],
      ['2026-09-02', -595, 'Sparkasse', 'KOSTEN KONTO · BUCHUNG'],
    ]);
  });

  it('Volksbank: BOM, Kürzel im Zweck entfernt', () => {
    expect(parseStatement(files.volksbank)?.profile.preset).toBe('volksbank');
    expect(brief(files.volksbank)).toEqual([
      ['2026-09-03', -4511, 'Versicherung AG', 'Beitrag Haftpflicht'],
    ]);
  });

  it('DKB: Vorspann, Gegenpart je nach Richtung, vorgemerkte übersprungen', () => {
    expect(parseStatement(files.dkb)?.profile.preset).toBe('dkb');
    expect(brief(files.dkb)).toEqual([
      ['2026-09-08', 20000, 'Max Muster', 'Nebenkosten'],
      ['2026-09-05', -101347, 'Baumarkt GmbH', 'Einkauf'],
    ]);
  });

  it('ING: langer Vorspann mit Saldo, Semikolon trotz Komma im Betrag', () => {
    expect(parseStatement(files.ing)?.profile).toMatchObject({ preset: 'ing', delimiter: ';' });
    expect(brief(files.ing)).toEqual([
      ['2026-09-09', -7800, 'Stadtwerke', 'Abschlag Strom · Lastschrift'],
      ['2026-09-10', -123456, 'Tankstelle', 'Tanken · Lastschrift'],
    ]);
  });

  it('Comdirect: Abschnitte, Buchungstext zerlegt, „offen“ übersprungen', () => {
    const sections = parseStatementSections(files.comdirect);
    expect(sections.map((s) => [s.title, s.profile.preset, s.rows.length])).toEqual([
      ['Umsätze Girokonto', 'comdirect', 1],
      ['Umsätze Visa-Karte (Kreditkarte)', 'comdirect', 1],
    ]);
    expect(sections[0]?.rows[0]).toMatchObject({
      date: '2026-09-04',
      amountCents: -4210,
      counterparty: 'REWE Markt GmbH',
      purpose: 'Einkauf',
    });
    expect(sections[1]?.rows[0]).toMatchObject({ amountCents: -1999, counterparty: 'AMAZON EU' });
    // Visa-Abschnitt hat Buchungs- und Umsatztag zur Auswahl
    expect(sections[1]?.dateColumns).toEqual(['Buchungstag', 'Umsatztag']);
    const byPurchase = parseStatementSections(files.comdirect, {
      ...sections[1]!.profile,
      mapping: { ...sections[1]!.profile.mapping, date: 'Umsatztag' },
    });
    expect(byPurchase.find((x) => x.profile.mapping.date === 'Umsatztag')?.rows[0]?.date).toBe(
      '2026-09-06',
    );
  });

  it('Amex: Komma getrennt, Belastungen positiv, mehrzeilige Adresse', () => {
    expect(parseStatement(files.amex)?.profile).toMatchObject({ preset: 'amex', delimiter: ',' });
    expect(brief(files.amex)).toEqual([
      ['2026-09-20', -9423, 'LIDL 4691 OLCHING', ''],
      ['2026-09-15', 50000, 'ZAHLUNG/ÜBERWEISUNG ERHALTEN BESTEN DANK', ''],
    ]);
  });

  it('Amex auch in der kurzen Form „Datum, Beschreibung, Betrag“', () => {
    const short = 'Datum,Beschreibung,Betrag\n01/09/2026,GOOGLE*GOOGLE PLAY,"17,99"';
    expect(parseStatement(short)?.profile.preset).toBe('amex');
    expect(brief(short)).toEqual([['2026-09-01', -1799, 'GOOGLE*GOOGLE PLAY', '']]);
    expect(
      positiveShare([{ amountCents: 1 }, { amountCents: 2 }, { amountCents: -1 }]),
    ).toBeCloseTo(2 / 3);
  });

  it('gespeicherte Zuordnung wird wiederverwendet, auch mit eigenen Spaltennamen', () => {
    const text = 'Tag;Wert;Wer\n01.09.2026;-5,00;Bäcker';
    expect(parseStatement(text)).toBeNull();
    const s = parseStatement(text, {
      preset: 'custom',
      delimiter: ';',
      mapping: { date: 'Tag', amount: 'Wert', counterparty: 'Wer' },
    });
    expect(s?.rows).toEqual([
      {
        line: 2,
        date: '2026-09-01',
        amountCents: -500,
        fileCents: -500,
        counterparty: 'Bäcker',
        purpose: '',
      },
    ]);
  });
});

describe('Text aufbereiten', () => {
  it('SEPA', () => {
    expect(cleanSepaPurpose('EREF+1 MREF+2 SVWZ+Miete Oktober ABWA+X')).toBe('Miete Oktober');
    expect(cleanSepaPurpose('Beitrag EREF: 1 MREF: 2')).toBe('Beitrag');
    expect(cleanSepaPurpose('Einfacher Text')).toBe('Einfacher Text');
  });

  it('Comdirect', () => {
    expect(splitComdirectText('Auftraggeber: Firma AG Buchungstext: Gehalt Ref. 9')).toEqual({
      counterparty: 'Firma AG',
      purpose: 'Gehalt',
    });
    expect(splitComdirectText('AMAZON EU')).toEqual({ counterparty: 'AMAZON EU', purpose: '' });
  });
});
