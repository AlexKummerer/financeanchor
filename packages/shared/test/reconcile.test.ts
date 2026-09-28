import { describe, expect, it } from 'vitest';
import { amountTolerance, namesSimilar, reconcile, unmatchedTransactions } from '../src/index.js';

const row = (
  key: string,
  date: string,
  amountCents: number,
  counterparty: string,
  label?: string,
) => ({
  key,
  date,
  amountCents,
  counterparty,
  purpose: '',
  label: label ?? counterparty.toLowerCase(),
});
const tx = (
  id: string,
  date: string,
  amountCents: number,
  name: string,
  source: { type: 'loan' | 'recurring_item'; id: string } | null = null,
) => ({
  id,
  date,
  amountCents,
  name,
  sourceType: source?.type ?? null,
  sourceId: source?.id ?? null,
  linked: false,
});

describe('Abgleich mit vorhandenen Buchungen', () => {
  it('Kreditrate aus „Fällige übernehmen“: gleicher Betrag bis 10 Tage, Name egal – zu prüfen', () => {
    const m = reconcile(
      [row('r1', '2026-09-11', -8200, 'Oldenburgische Landesbank')],
      [tx('olb', '2026-09-04', -8200, 'Rate OLB', { type: 'loan', id: 'l-olb' })],
    );
    expect(m.get('r1')).toEqual({ transactionId: 'olb', certainty: 'likely', group: false });
  });

  it('gelernte Herkunft: nächsten Monat auch mit etwas anderem Datum und Betrag', () => {
    const m = reconcile(
      [row('r1', '2026-10-15', -8250, 'Oldenburgische Landesbank')],
      [tx('olb', '2026-10-04', -8200, 'Rate OLB', { type: 'loan', id: 'l-olb' })],
      new Map([['oldenburgische landesbank', { sourceType: 'loan' as const, sourceId: 'l-olb' }]]),
    );
    expect(m.get('r1')?.transactionId).toBe('olb');
  });

  it('mehrere Abbuchungen ergeben zusammen eine Buchung (Consors 5 × 10 €, Sunrise 2 × ca. 10 €)', () => {
    const rows = [
      ...[1, 2, 3, 4, 5].map((i) => row(`c${i}`, `2026-09-0${i}`, -1000, 'Consorsbank')),
      row('s1', '2026-09-10', -1000, 'Sunrise'),
      row('s2', '2026-09-11', -998, 'Sunrise'),
    ];
    const m = reconcile(rows, [
      tx('consors', '2026-09-01', -5000, 'Consors Sparplan', { type: 'recurring_item', id: 'i1' }),
      tx('sunrise', '2026-09-10', -2000, 'Sunrise Handy', { type: 'recurring_item', id: 'i2' }),
    ]);
    expect([1, 2, 3, 4, 5].map((i) => m.get(`c${i}`))).toEqual(
      Array(5).fill({ transactionId: 'consors', certainty: 'sure', group: true }),
    );
    expect(m.get('s1')).toEqual({ transactionId: 'sunrise', certainty: 'likely', group: true });
    expect(m.get('s2')?.transactionId).toBe('sunrise');
  });

  it('möglich: kleine Abweichung, ähnlicher Name; ohne Namensähnlichkeit nichts', () => {
    const existing = [tx('t', '2026-09-12', -4500, 'Tanken Aral')];
    expect(
      reconcile([row('r', '2026-09-14', -4610, 'ARAL Station 123')], existing).get('r'),
    ).toEqual({
      transactionId: 't',
      certainty: 'likely',
      group: false,
    });
    expect(reconcile([row('r', '2026-09-14', -4610, 'Shell')], existing).size).toBe(0);
  });

  it('jede Buchung nur einmal; schon verknüpfte nie', () => {
    const existing = [
      tx('a', '2026-09-01', -1000, 'X'),
      { ...tx('b', '2026-09-01', -1000, 'X'), linked: true },
    ];
    const m = reconcile(
      [row('r1', '2026-09-01', -1000, 'Y', 'y1'), row('r2', '2026-09-01', -1000, 'Z', 'z1')],
      existing,
    );
    expect(m.get('r1')?.transactionId).toBe('a');
    expect(m.has('r2')).toBe(false);
  });

  it('Gegenprobe: Buchungen ohne passende Zeile im Zeitraum', () => {
    const existing = [
      tx('a', '2026-09-01', -1000, 'A'),
      tx('b', '2026-09-05', -2000, 'B'),
      tx('c', '2026-10-01', -1, 'C'),
    ];
    const m = reconcile([row('r', '2026-09-01', -1000, 'A')], existing);
    expect(
      unmatchedTransactions(existing, m, { from: '2026-09-01', to: '2026-09-30' }).map((t) => t.id),
    ).toEqual(['b']);
  });

  it('Hilfen', () => {
    expect(amountTolerance(-1000)).toBe(200);
    expect(amountTolerance(-100000)).toBe(5000);
    expect(namesSimilar('ARAL Station', 'Tanken Aral')).toBe(true);
    expect(namesSimilar('OLB', 'Oldenburgische Landesbank')).toBe(false);
  });
});
