import { buildPreview, dateRange } from './preview';

const row = (date: string, amountCents: number, counterparty: string, purpose = '') => ({
  line: 2,
  date,
  amountCents,
  counterparty,
  purpose,
});

describe('buildPreview', () => {
  const base = {
    scope: 'giro',
    isCard: false,
    cardNames: ['Amex'],
    known: new Set<string>(),
    existing: [],
    suggestions: [{ name: 'REWE', categoryId: 'c-food' }],
    learned: new Map([['paypal *disneyplus', { name: 'Disney+', categoryId: 'c-abo' }]]),
    categoryName: (id: string) => ({ 'c-food': 'Lebensmittel', 'c-abo': 'Abos' })[id] ?? '?',
  };

  it('Status, Vorschläge; nichts ist ausgewählt', () => {
    const rows = [
      row('2026-09-01', -4210, 'REWE Markt 0887', 'Einkauf'),
      row('2026-09-01', -85000, 'Vermieter', 'Miete'),
      row('2026-09-04', -14450, 'American Express Europe', 'Lastschrift'),
    ];
    const preview = buildPreview({
      ...base,
      rows,
      existing: [
        { id: 'm1', date: '2026-09-02', amountCents: -85000, name: 'Miete warm', importKey: null },
      ],
    });
    expect(preview.map((r) => [r.status, r.name, r.category, r.selected])).toEqual([
      ['new', 'REWE Markt 0887', 'Lebensmittel', false],
      ['match', 'Vermieter', '', false],
      ['card', 'American Express Europe', '', false],
    ]);
    expect(preview[1]?.match?.id).toBe('m1');

    // Beim zweiten Einlesen sind übernommene Zeilen bekannt
    const again = buildPreview({ ...base, rows, known: new Set([preview[0]?.key ?? '']) });
    expect(again[0]?.status).toBe('known');
  });

  it('Kartenimport: keine Kartenabbuchungen', () => {
    const [r] = buildPreview({
      ...base,
      isCard: true,
      rows: [row('2026-09-04', -500, 'American Express Gebühr')],
    });
    expect(r?.status).toBe('new');
  });

  it('Zeitraum der Datei', () => {
    expect(dateRange([row('2026-09-10', 1, 'a'), row('2026-09-02', 1, 'b')])).toEqual({
      from: '2026-09-02',
      to: '2026-09-10',
    });
    expect(dateRange([])).toBeNull();
  });

  it('Gelerntes: Name und Kategorie wie beim letzten Mal', () => {
    const [r] = buildPreview({
      ...base,
      isCard: true,
      rows: [row('2026-10-15', -899, 'PAYPAL *DISNEYPLUS 811111111111')],
    });
    expect(r).toMatchObject({ status: 'new', learned: true, name: 'Disney+', category: 'Abos' });
  });

  it('Kartenimport: Zahlung an die Karte ist keine Einnahme', () => {
    const [r] = buildPreview({
      ...base,
      isCard: true,
      rows: [row('2026-09-15', 50000, 'ZAHLUNG/ÜBERWEISUNG ERHALTEN BESTEN DANK')],
    });
    expect(r?.status).toBe('card');
  });
});
