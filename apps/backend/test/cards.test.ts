import { addMonths, monthOfDate } from '@financeanchor/shared';
import { describe, expect, it } from 'vitest';
import { categoryId, newUser, type Api } from './helpers.js';

const today = new Date().toISOString().slice(0, 10);
const thisMonth = monthOfDate(today);
const lastMonth = addMonths(thisMonth, -1);
/** Abrechnungsmonat der Abbuchung, die im Vormonat am 4. vom Konto ging */
const statementMonth = addMonths(thisMonth, -2);

async function setup(api: Api) {
  const giro = (
    await api.post('/accounts', { name: 'Giro', kind: 'checking', balanceCents: 200000 })
  ).body;
  const amex = (
    await api.post('/accounts', {
      name: 'Amex',
      kind: 'credit_card',
      balanceCents: 0,
      statementDay: 31,
      debitDay: 4,
      debitAccountId: giro.id,
    })
  ).body;
  const essen = await categoryId(api, 'Lebensmittel');
  const buy = (date: string, amountCents: number, accountId: string | null = amex.id) =>
    api.post('/transactions', { date, name: 'Einkauf', categoryId: essen, amountCents, accountId });
  return { giro, amex, essen, buy };
}

const accountById = async (api: Api, id: string) =>
  ((await api.get('/accounts')).body as { id: string; balanceCents: number }[]).find(
    (a) => a.id === id,
  )!;

describe('Kreditkarten', () => {
  it('Karte braucht Stichtag und Abbuchungstag; abgebucht wird von einem normalen Konto', async () => {
    const { api } = await newUser();
    const { amex } = await setup(api);
    expect(amex).toMatchObject({ kind: 'credit_card', statementDay: 31, debitDay: 4 });
    expect(
      (await api.post('/accounts', { name: 'X', kind: 'credit_card', balanceCents: 0 })).status,
    ).toBe(400);
    expect(
      (
        await api.post('/accounts', {
          name: 'Y',
          kind: 'credit_card',
          balanceCents: 0,
          statementDay: 24,
          debitDay: 24,
          debitAccountId: amex.id,
        })
      ).status,
    ).toBe(400);
    // Andere Konten tragen keine Kartenfelder
    const giro2 = (
      await api.post('/accounts', { name: 'G', kind: 'checking', balanceCents: 0, statementDay: 5 })
    ).body;
    expect(giro2.statementDay).toBeNull();
  });

  it('Käufe mit der Karte bestimmen den Stand; nur Karten sind als „bezahlt mit“ erlaubt', async () => {
    const { api } = await newUser();
    const { giro, amex, buy } = await setup(api);
    expect((await buy(`${thisMonth}-01`, -4550)).status).toBe(201);
    await buy(`${thisMonth}-02`, 1000); // Gutschrift
    expect((await buy(`${thisMonth}-03`, -100, giro.id)).status).toBe(400);
    expect((await accountById(api, amex.id)).balanceCents).toBe(-3550);

    // Stand von Hand setzen: angezeigt wird der eingegebene Wert
    const patched = (await api.patch(`/accounts/${amex.id}`, { balanceCents: -5000 })).body;
    expect(patched.balanceCents).toBe(-5000);
    expect((await accountById(api, amex.id)).balanceCents).toBe(-5000);
    // Umbenennen lässt Stand und Kartenfelder in Ruhe
    const renamed = (await api.patch(`/accounts/${amex.id}`, { name: 'Amex Gold' })).body;
    expect(renamed).toMatchObject({ balanceCents: -5000, debitDay: 4, debitAccountId: giro.id });
  });

  it('Abbuchung: Summe des Zeitraums, Girokonto sinkt, Karte wieder ausgeglichen', async () => {
    const { api } = await newUser();
    const { giro, amex, buy } = await setup(api);
    await buy(`${statementMonth}-05`, -4550);
    await buy(`${statementMonth}-20`, -9900);
    await buy(`${lastMonth}-02`, -1000); // nächste Abrechnung

    const plan = (await api.get(`/due/${lastMonth}?today=${today}`)).body as {
      key: string;
      amountCents: number;
      date: string;
      bookable: boolean;
    }[];
    const card = plan.find((e) => e.key === `card:${amex.id}`)!;
    expect(card).toMatchObject({ amountCents: -14450, date: `${lastMonth}-04`, bookable: true });

    const res = await api.post(`/due/${lastMonth}/book`, { today, keys: [card.key] });
    expect(res.status).toBe(200);
    expect((await accountById(api, giro.id)).balanceCents).toBe(200000 - 14450);
    expect((await accountById(api, amex.id)).balanceCents).toBe(-1000);

    // Die Abbuchung ist keine Ausgabe: Art card_payment
    const txs = (await api.get(`/transactions?month=${lastMonth}`)).body as {
      id: string;
      kind: string;
      amountCents: number;
    }[];
    const payment = txs.find((t) => t.kind === 'card_payment')!;
    expect(payment.amountCents).toBe(-14450);

    // Löschen der Abbuchung macht beides rückgängig
    expect((await api.del(`/transactions/${payment.id}`)).status).toBe(204);
    expect((await accountById(api, giro.id)).balanceCents).toBe(200000);
    expect((await accountById(api, amex.id)).balanceCents).toBe(-15450);
  });

  it('Karte löschen: Käufe bleiben als Ausgaben ohne Karte', async () => {
    const { api } = await newUser();
    const { amex, buy } = await setup(api);
    const tx = (await buy(`${thisMonth}-01`, -4550)).body;
    expect((await api.del(`/accounts/${amex.id}`)).status).toBe(204);
    const txs = (await api.get(`/transactions?month=${thisMonth}`)).body as {
      id: string;
      accountId: string | null;
    }[];
    expect(txs.find((t) => t.id === tx.id)!.accountId).toBeNull();
  });

  it('Sicherung und Wiederherstellen behalten Karte, Abbuchungskonto und „bezahlt mit“', async () => {
    const alice = await newUser('alice');
    const { buy } = await setup(alice.api);
    await buy(`${thisMonth}-01`, -4550);
    const backup = (await alice.api.get('/export')).body;
    const bob = await newUser('bob');
    expect((await bob.api.post('/import', backup)).status).toBe(200);
    const accs = (await bob.api.get('/accounts')).body as {
      id: string;
      kind: string;
      debitAccountId: string | null;
      balanceCents: number;
    }[];
    const card = accs.find((a) => a.kind === 'credit_card')!;
    const giro = accs.find((a) => a.kind === 'checking')!;
    expect(card).toMatchObject({ debitAccountId: giro.id, balanceCents: -4550 });
  });

  it('Abrechnungen zum Abgleich: laufende und letzte mit Summe, Buchungen und Status', async () => {
    const { api } = await newUser();
    const { amex, buy } = await setup(api);
    await buy(`${lastMonth}-05`, -4550);
    await buy(`${lastMonth}-06`, -1000);
    await buy(`${thisMonth}-01`, -700);
    const [st] = (await api.get(`/accounts/card-statements?today=${today}`)).body as {
      cardId: string;
      current: { from: string; to: string; amountCents: number; count: number; paid: boolean };
      previous: {
        from: string;
        debitDate: string;
        amountCents: number;
        count: number;
        paid: boolean;
        transactions: { name: string; amountCents: number }[];
      };
    }[];
    expect(st!.cardId).toBe(amex.id);
    expect(st!.current).toMatchObject({ from: `${thisMonth}-01`, amountCents: 700, count: 1 });
    expect(st!.previous).toMatchObject({
      from: `${lastMonth}-01`,
      debitDate: `${thisMonth}-04`,
      amountCents: 5550,
      count: 2,
    });
    expect(st!.previous.transactions.map((t) => t.amountCents)).toEqual([-4550, -1000]);
    expect((await api.get('/accounts/card-statements')).status).toBe(400);
  });
});
