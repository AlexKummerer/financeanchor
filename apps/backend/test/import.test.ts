import { describe, expect, it } from 'vitest';
import { categoryId, newUser } from './helpers.js';

describe('CSV-Import', () => {
  it('übernimmt bestätigte Zeilen atomar, verknüpft Vorhandenes, merkt die Zuordnung', async () => {
    const { api } = await newUser();
    const essen = await categoryId(api, 'Lebensmittel');
    const giro = (await api.post('/accounts', { name: 'Giro', kind: 'checking', balanceCents: 0 }))
      .body;
    const amex = (
      await api.post('/accounts', {
        name: 'Amex',
        kind: 'credit_card',
        balanceCents: 0,
        statementDay: 31,
        debitDay: 4,
      })
    ).body;
    const manual = (
      await api.post('/transactions', {
        date: '2026-09-03',
        name: 'Rewe von Hand',
        categoryId: essen,
        amountCents: -2000,
      })
    ).body;

    const profile = {
      preset: 'amex',
      delimiter: ',',
      mapping: { date: 'Datum', amount: 'Betrag', counterparty: 'Beschreibung', invertSign: true },
    };
    const res = await api.post('/transactions/import', {
      accountId: amex.id,
      items: [
        {
          date: '2026-09-01',
          name: 'Tankstelle',
          categoryId: essen,
          amountCents: -4550,
          importKey: 'imp:a',
        },
        {
          date: '2026-09-02',
          name: 'Gutschrift',
          categoryId: essen,
          amountCents: 1000,
          importKey: 'imp:b',
        },
      ],
      links: [{ transactionId: manual.id, importKey: 'imp:c' }],
      profile: { accountId: amex.id, profile },
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ created: 2, linked: 1 });

    const accounts = (await api.get('/accounts')).body as {
      id: string;
      balanceCents: number;
      importProfile: unknown;
    }[];
    const card = accounts.find((a) => a.id === amex.id)!;
    expect(card.balanceCents).toBe(-3550);
    expect(card.importProfile).toEqual(profile);

    const check = (
      await api.post('/transactions/import/check', {
        keys: ['imp:a', 'imp:c', 'imp:neu'],
        from: '2026-09-01',
        to: '2026-09-30',
      })
    ).body as { known: string[]; existing: { id: string; importKey: string | null }[] };
    expect(check.known.sort()).toEqual(['imp:a', 'imp:c']);
    expect(check.existing.find((t) => t.id === manual.id)?.importKey).toBe('imp:c');

    // Nochmal dieselbe Zeile: alles oder nichts
    const again = await api.post('/transactions/import', {
      accountId: amex.id,
      items: [
        {
          date: '2026-09-05',
          name: 'Neu',
          categoryId: essen,
          amountCents: -100,
          importKey: 'imp:d',
        },
        {
          date: '2026-09-01',
          name: 'Tankstelle',
          categoryId: essen,
          amountCents: -4550,
          importKey: 'imp:a',
        },
      ],
      links: [],
    });
    expect(again.status).toBe(409);
    const september = (await api.get('/transactions?month=2026-09')).body as { name: string }[];
    expect(september.some((t) => t.name === 'Neu')).toBe(false);

    // „Bezahlt mit“ nur für Kreditkarten; beim Girokonto-Import bleibt es leer
    expect(
      (await api.post('/transactions/import', { accountId: giro.id, items: [], links: [] })).status,
    ).toBe(400);
    const girkoImport = await api.post('/transactions/import', {
      accountId: null,
      items: [
        {
          date: '2026-09-06',
          name: 'Gehalt',
          categoryId: essen,
          amountCents: 300000,
          importKey: 'imp:e',
        },
      ],
      links: [],
    });
    expect(girkoImport.status).toBe(201);
  });

  it('fremde Buchungen lassen sich nicht verknüpfen', async () => {
    const alice = await newUser('alice');
    const bob = await newUser('bob');
    const tx = (
      await alice.api.post('/transactions', {
        date: '2026-09-03',
        name: 'Privat',
        categoryId: await categoryId(alice.api, 'Lebensmittel'),
        amountCents: -2000,
      })
    ).body;
    const res = await bob.api.post('/transactions/import', {
      accountId: null,
      items: [],
      links: [{ transactionId: tx.id, importKey: 'imp:x' }],
    });
    expect(res.status).toBe(201);
    const check = (
      await alice.api.post('/transactions/import/check', {
        keys: ['imp:x'],
        from: '2026-09-01',
        to: '2026-09-30',
      })
    ).body as { known: string[] };
    expect(check.known).toEqual([]);
  });
});
