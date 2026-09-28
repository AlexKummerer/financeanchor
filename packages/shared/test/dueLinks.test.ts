import { describe, expect, it } from 'vitest';
import { suggestDueLinks } from '../src/index.js';

const due = (key: string, name: string, amountCents: number, date = '2026-09-05') => ({
  key,
  name,
  date,
  amountCents,
});
const tx = (id: string, name: string, amountCents: number, date = '2026-09-05') => ({
  id,
  name,
  date,
  amountCents,
});

describe('Vorschläge „Schon von Hand gebucht?“', () => {
  it('gleicher Betrag in der Nähe, Name egal', () => {
    const m = suggestDueLinks(
      [due('miete', 'Miete', -85000)],
      [tx('t', 'Vermieter', -85000, '2026-09-03')],
    );
    expect(m.get('miete')?.map((t) => t.id)).toEqual(['t']);
  });

  it('in zwei Teilen: Summe passt', () => {
    const m = suggestDueLinks(
      [due('strato', 'Strato', -7200)],
      [
        tx('b', 'Strato Domain', -3600, '2026-09-12'),
        tx('a', 'Strato Server', -3600, '2026-09-02'),
        tx('x', 'Rewe', -3600),
      ],
    );
    expect(m.get('strato')?.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('ein Teil mit anderem Betrag, ähnlicher Name', () => {
    const m = suggestDueLinks(
      [due('strom', 'Strom', -9000)],
      [tx('s', 'Strom EWE', -9480, '2026-09-20')],
    );
    expect(m.get('strom')?.map((t) => t.id)).toEqual(['s']);
  });

  it('jede Buchung nur einmal; anderes Vorzeichen passt nicht', () => {
    const m = suggestDueLinks(
      [due('a', 'Miete', -85000), due('b', 'Miete Garage', -85000), due('c', 'Gehalt', 310000)],
      [tx('t', 'Miete', -85000), tx('g', 'Gehalt Rückbuchung', -310000)],
    );
    expect(m.get('a')?.map((t) => t.id)).toEqual(['t']);
    expect(m.has('b')).toBe(false);
    expect(m.has('c')).toBe(false);
  });

  it('eine Buchung für zwei Fälligkeiten: wird bei beiden vorgeschlagen', () => {
    const m = suggestDueLinks(
      [due('server', 'Strato Server', -3000), due('domain', 'Strato Domain', -4200)],
      [tx('t', 'Strato', -7200)],
    );
    expect(m.get('server')?.map((t) => t.id)).toEqual(['t']);
    expect(m.get('domain')?.map((t) => t.id)).toEqual(['t']);
  });
});
