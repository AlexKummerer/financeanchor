import { describe, expect, it } from 'vitest';
import { categoryId, newUser } from './helpers.js';

describe('CSV-Import', () => {
  it('übernimmt bestätigte Zeilen atomar, verknüpft Vorhandenes, merkt die Zuordnung', async () => {
    const { api } = await newUser();
    const essen = await categoryId(api, 'Lebensmittel');
    const giro = (
      await api.post('/accounts', {
        balanceDate: '2000-01-01',
        name: 'Giro',
        kind: 'checking',
        balanceCents: 0,
      })
    ).body;
    const amex = (
      await api.post('/accounts', {
        balanceDate: '2000-01-01',
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
    expect(res.body).toEqual({ created: 2, linked: 1, adjusted: 0 });

    const accounts = (await api.get('/accounts')).body as {
      id: string;
      balanceCents: number;
      importProfile: unknown;
    }[];
    const card = accounts.find((a) => a.id === amex.id)!;
    // Käufe mit der Karte (-45,50 + 10,00) und die verknüpfte eigene Buchung (-20,00), die nun
    // der Karte zugeordnet ist
    expect(card.balanceCents).toBe(-5550);
    expect(card.importProfile).toEqual(profile);

    const check = (
      await api.post('/transactions/import/check', {
        keys: ['imp:a', 'imp:c', 'imp:neu'],
        from: '2026-09-01',
        to: '2026-09-30',
      })
    ).body as { known: string[]; existing: { id: string; linked: boolean }[] };
    expect(check.known.sort()).toEqual(['imp:a', 'imp:c']);
    expect(check.existing.find((t) => t.id === manual.id)?.linked).toBe(true);

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
    expect(res.status).toBe(400);
    const check = (
      await alice.api.post('/transactions/import/check', {
        keys: ['imp:x'],
        from: '2026-09-01',
        to: '2026-09-30',
      })
    ).body as { known: string[] };
    expect(check.known).toEqual([]);
  });

  it('lernt Name und Kategorie je Merkmal; Verknüpfen beim Kartenimport trägt die Karte nach', async () => {
    const { api } = await newUser();
    const abos = (await api.post('/categories', { name: 'Streaming Test' })).body;
    const amex = (
      await api.post('/accounts', {
        balanceDate: '2000-01-01',
        name: 'Amex',
        kind: 'credit_card',
        balanceCents: 0,
        statementDay: 31,
        debitDay: 4,
      })
    ).body;
    await api.post('/transactions/import', {
      accountId: amex.id,
      items: [
        {
          date: '2026-08-15',
          name: 'Disney+',
          categoryId: abos.id,
          amountCents: -899,
          importKey: 'imp:aug',
          importLabel: 'paypal *disneyplus',
        },
      ],
      links: [],
    });
    const check = (
      await api.post('/transactions/import/check', {
        keys: [],
        labels: ['paypal *disneyplus', 'unbekannt'],
        from: '2026-09-01',
        to: '2026-09-30',
      })
    ).body as { learned: { label: string; name: string; categoryId: string }[] };
    expect(check.learned).toEqual([
      {
        label: 'paypal *disneyplus',
        name: 'Disney+',
        sourceType: null,
        sourceId: null,
        categoryId: abos.id,
      },
    ]);

    // Von Hand ohne Karte erfasst, dann über den Kartenimport verknüpft
    const manual = (
      await api.post('/transactions', {
        date: '2026-09-15',
        name: 'Disney+',
        categoryId: abos.id,
        amountCents: -899,
      })
    ).body;
    await api.post('/transactions/import', {
      accountId: amex.id,
      items: [],
      links: [
        { transactionId: manual.id, importKey: 'imp:sep', importLabel: 'paypal *disneyplus' },
      ],
    });
    const september = (await api.get('/transactions?month=2026-09')).body as {
      id: string;
      accountId: string | null;
    }[];
    expect(september.find((t) => t.id === manual.id)?.accountId).toBe(amex.id);
    const card = ((await api.get('/accounts')).body as { id: string; balanceCents: number }[]).find(
      (a) => a.id === amex.id,
    );
    expect(card?.balanceCents).toBe(-1798);
  });

  it('verknüpft mehrere Zeilen mit einer Buchung, gleicht den Betrag an und lernt die Herkunft', async () => {
    const { api } = await newUser();
    const essen = await categoryId(api, 'Lebensmittel');
    const rate = (
      await api.post('/transactions', {
        date: '2026-09-01',
        name: 'Sparplan Consors',
        categoryId: essen,
        amountCents: -5000,
      })
    ).body;
    const res = await api.post('/transactions/import', {
      accountId: null,
      items: [],
      links: [1, 2, 3, 4].map((n) => ({
        transactionId: rate.id,
        importKey: `imp:c${n}`,
        importLabel: 'consorsbank',
      })),
      adjust: [{ transactionId: rate.id, amountCents: -4000 }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ created: 0, linked: 4, adjusted: 1 });

    const check = (
      await api.post('/transactions/import/check', {
        keys: ['imp:c1', 'imp:c4', 'imp:c5'],
        labels: ['consorsbank'],
        from: '2026-09-01',
        to: '2026-09-30',
      })
    ).body as {
      known: string[];
      existing: { id: string; amountCents: number; linked: boolean }[];
      learned: { label: string; name: string }[];
    };
    expect(check.known.sort()).toEqual(['imp:c1', 'imp:c4']);
    expect(check.existing).toEqual([
      expect.objectContaining({ id: rate.id, amountCents: -4000, linked: true }),
    ]);
    expect(check.learned).toEqual([
      expect.objectContaining({ label: 'consorsbank', name: 'Sparplan Consors' }),
    ]);

    // Schon verknüpfte Zeile ein zweites Mal: abgelehnt
    const again = await api.post('/transactions/import', {
      accountId: null,
      items: [],
      links: [{ transactionId: rate.id, importKey: 'imp:c1' }],
    });
    expect(again.status).toBe(409);

    // Löschen der Buchung entfernt die Verknüpfungen
    await api.del(`/transactions/${rate.id}`);
    const after = (
      await api.post('/transactions/import/check', {
        keys: ['imp:c1'],
        from: '2026-09-01',
        to: '2026-09-30',
      })
    ).body as { known: string[] };
    expect(after.known).toEqual([]);
  });
});
