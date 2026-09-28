import {
  buildPreview,
  dateRange,
  linkCandidates,
  linkedTotals,
  linkRow,
  withoutRow,
  type ImportExisting,
} from './preview';

const tx = (
  id: string,
  date: string,
  amountCents: number,
  name: string,
  more: Partial<ImportExisting> = {},
): ImportExisting => ({
  id,
  date,
  amountCents,
  name,
  sourceType: null,
  sourceId: null,
  linked: false,
  kind: 'normal',
  accountId: null,
  ...more,
});

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
    existing: [] as ImportExisting[],
    suggestions: [{ name: 'REWE', categoryId: 'c-food' }],
    learned: [
      {
        label: 'paypal *disneyplus',
        name: 'Disney+',
        categoryId: 'c-abo',
        sourceType: null,
        sourceId: null,
      },
    ],
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
      existing: [tx('m1', '2026-09-02', -85000, 'Miete warm')],
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

  it('Rate per gelernter Herkunft, Teilbeträge als Gruppe, Gegenprobe', () => {
    const existing = [
      tx('olb', '2026-09-01', -8200, 'Rate OLB', { sourceType: 'loan', sourceId: 'l-olb' }),
      tx('cons', '2026-09-01', -5000, 'Sparplan Consors', {
        sourceType: 'recurring_item',
        sourceId: 'i-c',
      }),
      tx('extra', '2026-09-12', -1999, 'Doppelt erfasst'),
    ];
    const rows = buildPreview({
      ...base,
      existing,
      learned: [
        {
          label: 'oldenburgische landesbank',
          name: 'Rate OLB',
          categoryId: 'c-food',
          sourceType: 'loan',
          sourceId: 'l-olb',
        },
      ],
      rows: [
        row('2026-09-02', -8200, 'Oldenburgische Landesbank'),
        ...[1, 2, 3, 4, 5].map((d) => row(`2026-09-0${d}`, -1000, 'Consorsbank')),
      ],
    });
    expect(rows.map((r) => [r.status, r.match?.id, r.group])).toEqual([
      ['match', 'olb', false],
      ...Array.from({ length: 5 }, () => ['match', 'cons', true]),
    ]);
    expect(linkedTotals(rows).get('cons')).toMatchObject({ count: 5, sumCents: -5000 });
    expect(withoutRow(rows, existing, null, { from: '2026-09-01', to: '2026-09-30' })).toEqual([
      existing[2],
    ]);
  });

  it('von Hand verknüpfen und lösen', () => {
    const existing = [
      tx('a', '2026-09-20', -3000, 'Weit weg'),
      tx('b', '2026-09-03', -2500, 'Nah'),
    ];
    const [r] = buildPreview({ ...base, rows: [row('2026-09-02', -2000, 'Irgendwas')], existing });
    expect(r?.status).toBe('new');
    if (!r) return;
    expect(linkCandidates(r, existing).map((t) => t.id)).toEqual(['b', 'a']);
    const linked = linkRow(r, existing[1] ?? null);
    expect(linked).toMatchObject({ status: 'match', certainty: 'manual' });
    expect(linkRow(linked, null)).toMatchObject({ status: 'new', match: null });
  });
});
