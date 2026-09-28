import { addMonths, monthOfDate } from '@financeanchor/shared';
import { describe, expect, it } from 'vitest';
import { categoryId, newUser, type Api } from './helpers.js';

const today = new Date().toISOString().slice(0, 10);
const lastMonth = addMonths(monthOfDate(today), -1);

const balance = async (api: Api, path: string, id: string) =>
  (
    (await api.get(path)).body as { id: string; balanceCents: number; balanceDate: string | null }[]
  ).find((x) => x.id === id)!;

describe('Stand vom', () => {
  it('Kreditkarte: Ausgabe vor dem Stand ändert ihn nicht, ab dem Stand-Datum schon', async () => {
    const { api } = await newUser();
    const essen = await categoryId(api, 'Lebensmittel');
    const card = (
      await api.post('/accounts', {
        name: 'Karte',
        kind: 'credit_card',
        balanceCents: -150000,
        balanceDate: '2026-09-28',
        statementDay: 31,
        debitDay: 4,
      })
    ).body;
    const buy = (date: string, amountCents: number) =>
      api.post('/transactions', {
        date,
        name: 'Kauf',
        categoryId: essen,
        amountCents,
        accountId: card.id,
      });
    await buy('2026-09-15', -30000);
    expect((await balance(api, '/accounts', card.id)).balanceCents).toBe(-150000);
    await buy('2026-09-29', -2000);
    expect((await balance(api, '/accounts', card.id)).balanceCents).toBe(-152000);

    // Neuer Stand setzt das Stand-Datum; spätere Käufe zählen weiter
    const patched = (
      await api.patch(`/accounts/${card.id}`, { balanceCents: -100000, balanceDate: '2026-09-30' })
    ).body;
    expect(patched).toMatchObject({ balanceCents: -100000, balanceDate: '2026-09-30' });
    await buy('2026-10-01', -500);
    expect((await balance(api, '/accounts', card.id)).balanceCents).toBe(-100500);
  });

  it('Fällige aus der Zeit vor dem Stand ändern Konto und Restschuld nicht – auch nicht beim Löschen', async () => {
    const { api } = await newUser();
    // Heute eingetragen: Stand-Datum = heute
    const reserve = (
      await api.post('/accounts', { name: 'Rücklage', kind: 'savings', balanceCents: 62000 })
    ).body;
    expect(reserve.balanceDate).toBe(today);
    const [pot] = (await api.get('/reserve-pots')).body;
    await api.patch(`/reserve-pots/${pot.id}`, { accountId: reserve.id, monthlyAmountCents: 5000 });
    const loan = (
      await api.post('/loans', {
        kind: 'installment',
        name: 'Auto',
        balanceCents: 840000,
        rateBp: 590,
        paymentCents: 26000,
        dueDay: 1,
      })
    ).body;

    const res = await api.post(`/due/${lastMonth}/book`, {
      today,
      keys: [`reserve:${pot.id}`, `loan:${loan.id}`],
    });
    expect(res.status).toBe(200);
    expect((await balance(api, '/accounts', reserve.id)).balanceCents).toBe(62000);
    expect((await balance(api, '/loans', loan.id)).balanceCents).toBe(840000);

    // Buchungen sind trotzdem da; Löschen rechnet nichts zurück
    const txs = (await api.get(`/transactions?month=${lastMonth}`)).body as { id: string }[];
    expect(txs.length).toBe(2);
    for (const t of txs) await api.del(`/transactions/${t.id}`);
    expect((await balance(api, '/accounts', reserve.id)).balanceCents).toBe(62000);
    expect((await balance(api, '/loans', loan.id)).balanceCents).toBe(840000);
  });

  it('Kredit: nur eine geänderte Restschuld setzt das Stand-Datum neu', async () => {
    const { api } = await newUser();
    const loan = (
      await api.post('/loans', {
        kind: 'installment',
        name: 'Auto',
        balanceCents: 500000,
        paymentCents: 20000,
        balanceDate: '2026-01-01',
      })
    ).body;
    expect(loan.balanceDate).toBe('2026-01-01');
    const same = (await api.patch(`/loans/${loan.id}`, { balanceCents: 500000, name: 'Auto 2' }))
      .body;
    expect(same.balanceDate).toBe('2026-01-01');
    const changed = (
      await api.patch(`/loans/${loan.id}`, { balanceCents: 480000, balanceDate: '2026-09-28' })
    ).body;
    expect(changed.balanceDate).toBe('2026-09-28');
  });
});
