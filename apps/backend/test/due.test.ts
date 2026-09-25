import { addMonths, daysInMonth, monthOfDate } from '@financeanchor/shared';
import { describe, expect, it } from 'vitest';
import { categoryId, newUser, type Api } from './helpers.js';

const today = new Date().toISOString().slice(0, 10);
const thisMonth = monthOfDate(today);
const lastMonth = addMonths(thisMonth, -1);
const isLastDayOfMonth = Number(today.slice(8)) === daysInMonth(thisMonth);

/** Beispielhaushalt: Rücklagenkonto, Miete, vierteljährliche Versicherung, Gehalt am Monatsende, Kredit. */
async function household(api: Api) {
  const reserveAccount = (
    await api.post('/accounts', {
      name: 'Tagesgeld Rücklage',
      kind: 'savings',
      balanceCents: 62000,
    })
  ).body;
  const [pot] = (await api.get('/reserve-pots')).body;
  await api.patch(`/reserve-pots/${pot.id}`, { accountId: reserveAccount.id });
  const item = (
    name: string,
    amountCents: number,
    intervalMonths: number,
    kind: string,
    cat: string,
    dueDay: number,
  ) =>
    api.post('/recurring-items', {
      name,
      amountCents,
      intervalMonths,
      kind,
      dueDay,
      startMonth: lastMonth,
      categoryId: cat,
    });
  await item('Miete', 85000, 1, 'fixed', await categoryId(api, 'Wohnen'), 1);
  await item('Haftpflicht', 3600, 3, 'fixed', await categoryId(api, 'Versicherungen'), 1);
  await item('Gehalt', 310000, 1, 'income', await categoryId(api, 'Gehalt'), 31);
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
  await api.patch(`/loans/${loan.id}`, { extraMonthlyCents: 10000 });
  return { reserveAccount, pot, loan };
}

const balanceOf = async (api: Api, path: string, id: string) =>
  ((await api.get(path)).body as { id: string; balanceCents: number }[]).find((x) => x.id === id)!
    .balanceCents;

describe('Fällige übernehmen', () => {
  it('Vormonat: bucht alles atomar und passt Rücklagenkonto und Restschuld an', async () => {
    const { api } = await newUser();
    const { reserveAccount, pot, loan } = await household(api);

    const plan = (await api.get(`/due/${lastMonth}?today=${today}`)).body;
    const types = plan.map((e: any) => e.type).sort();
    expect(types).toEqual(['extra', 'item', 'item', 'item', 'loan', 'reserve', 'transfer']);
    expect(plan.find((e: any) => e.type === 'reserve').key).toBe(`reserve:${pot.id}`);
    expect(plan.find((e: any) => e.type === 'loan').key).toBe(`loan:${loan.id}`);
    expect(plan.every((e: any) => e.bookable)).toBe(true);

    const res = await api.post(`/due/${lastMonth}/book`, { today });
    expect(res.status).toBe(200);
    expect(res.body.bookedCount).toBe(7);
    expect(res.body.entries.every((e: any) => e.booked)).toBe(true);

    // 620 € + 12 € Rücklage (36 € / 3) − 36 € Umbuchung
    expect(await balanceOf(api, '/accounts', reserveAccount.id)).toBe(62000 + 1200 - 3600);
    // 8.400 € + 41,30 € Zins − 260 € Rate − 100 € Extra
    expect(await balanceOf(api, '/loans', loan.id)).toBe(840000 + 4130 - 26000 - 10000);

    const txs = (await api.get(`/transactions?month=${lastMonth}`)).body;
    expect(txs).toHaveLength(7);
    expect(txs.map((t: any) => t.kind).sort()).toEqual(
      ['loan_payment', 'loan_payment', 'normal', 'normal', 'normal', 'reserve', 'transfer'].sort(),
    );
    expect(txs.find((t: any) => t.kind === 'transfer')).toMatchObject({
      amountCents: 3600,
      name: 'Umbuchung Rücklage: Haftpflicht',
    });
    expect(txs.find((t: any) => t.name === 'Gehalt').date).toBe(
      `${lastMonth}-${String(daysInMonth(lastMonth)).padStart(2, '0')}`,
    );
  });

  it('ist idempotent: zweiter Aufruf bucht nichts, Stände bleiben', async () => {
    const { api } = await newUser();
    const { reserveAccount, loan } = await household(api);
    await api.post(`/due/${lastMonth}/book`, { today });
    const again = await api.post(`/due/${lastMonth}/book`, { today });
    expect(again.body.bookedCount).toBe(0);
    expect((await api.get(`/transactions?month=${lastMonth}`)).body).toHaveLength(7);
    expect(await balanceOf(api, '/accounts', reserveAccount.id)).toBe(59600);
    expect(await balanceOf(api, '/loans', loan.id)).toBe(808130);
  });

  it('parallele Aufrufe buchen trotzdem nur einmal', async () => {
    const { api } = await newUser();
    const { reserveAccount } = await household(api);
    const results = await Promise.all([
      api.post(`/due/${lastMonth}/book`, { today }),
      api.post(`/due/${lastMonth}/book`, { today }),
    ]);
    expect(results.map((r) => r.status).every((s) => s === 200 || s === 409)).toBe(true);
    expect((await api.get(`/transactions?month=${lastMonth}`)).body).toHaveLength(7);
    expect(await balanceOf(api, '/accounts', reserveAccount.id)).toBe(59600);
  });

  it('Löschen einer gebuchten Umbuchung macht sie rückgängig und wieder buchbar', async () => {
    const { api } = await newUser();
    const { reserveAccount } = await household(api);
    await api.post(`/due/${lastMonth}/book`, { today });
    const transfer = (await api.get(`/transactions?month=${lastMonth}`)).body.find(
      (t: any) => t.kind === 'transfer',
    );
    expect((await api.patch(`/transactions/${transfer.id}`, { amountCents: 1 })).status).toBe(409);
    expect((await api.del(`/transactions/${transfer.id}`)).status).toBe(204);
    expect(await balanceOf(api, '/accounts', reserveAccount.id)).toBe(59600 + 3600);

    const plan = (await api.get(`/due/${lastMonth}?today=${today}`)).body;
    expect(plan.filter((e: any) => !e.booked).map((e: any) => e.type)).toEqual(['transfer']);
    // Umbuchungen sind nicht einzeln wählbar, ohne Auswahl wird aber alles Offene gebucht
    expect((await api.post(`/due/${lastMonth}/book`, { today })).body.bookedCount).toBe(1);
    expect(await balanceOf(api, '/accounts', reserveAccount.id)).toBe(59600);
  });

  it('laufender Monat: nur bis heute Fälliges; vorgezogenes Datum macht es buchbar', async () => {
    const { api } = await newUser();
    await household(api);
    const plan = (await api.get(`/due/${thisMonth}?today=${today}`)).body;
    const salary = plan.find((e: any) => e.name === 'Gehalt');
    expect(salary.bookable).toBe(isLastDayOfMonth);
    if (!isLastDayOfMonth) {
      const notYet = await api.post(`/due/${thisMonth}/book`, { today, keys: [salary.key] });
      expect(notYet.body).toMatchObject({ error: { code: 'not_yet_due' } });
    }
    const res = await api.post(`/due/${thisMonth}/book`, {
      today,
      keys: [salary.key],
      overrides: [{ key: salary.key, date: today, amountCents: 312345 }],
    });
    expect(res.body.bookedCount).toBe(1);
    const tx = (await api.get(`/transactions?month=${thisMonth}`)).body.find(
      (t: any) => t.name === 'Gehalt',
    );
    expect(tx).toMatchObject({ date: today, amountCents: 312345 });
  });

  it('lehnt ungültige Anfragen ab', async () => {
    const { api } = await newUser();
    const { loan } = await household(api);
    expect((await api.get(`/due/${thisMonth}?today=2000-01-01`)).body).toMatchObject({
      error: { code: 'invalid_today' },
    });
    expect(
      (
        await api.post(`/due/${lastMonth}/book`, {
          today,
          overrides: [{ key: `loan:${loan.id}`, amountCents: 99_999_999 }],
        })
      ).body,
    ).toMatchObject({ error: { code: 'invalid_amount' } });
    expect(
      (
        await api.post(`/due/${lastMonth}/book`, {
          today,
          overrides: [{ key: 'item:x', date: today }],
        })
      ).body,
    ).toMatchObject({ error: { code: 'unknown_key' } });
    expect((await api.get('/due/2026-13?today=' + today)).status).toBe(400);
  });

  it('Mandantentrennung: fremde Fälligkeiten sind unsichtbar und unbuchbar', async () => {
    const alice = await newUser('alice');
    const bob = await newUser('bob');
    const { reserveAccount } = await household(alice.api);
    const alicePlan = (await alice.api.get(`/due/${lastMonth}?today=${today}`)).body;
    const bobPlan = (await bob.api.get(`/due/${lastMonth}?today=${today}`)).body;
    expect(bobPlan).toEqual([]);
    const res = await bob.api.post(`/due/${lastMonth}/book`, { today, keys: [alicePlan[1].key] });
    expect(res.body).toMatchObject({ error: { code: 'unknown_key' } });
    expect(await balanceOf(alice.api, '/accounts', reserveAccount.id)).toBe(62000);
  });
});

describe('Ansparen für Einmalzahlungen', () => {
  it('bucht die Rücklage, erhöht das Zurückgelegte und macht das beim Löschen rückgängig', async () => {
    const { api } = await newUser();
    const nextMonth = addMonths(thisMonth, 3);
    const loan = (
      await api.post('/loans', {
        kind: 'deadline',
        name: 'Privatkredit',
        balanceCents: 120000,
        dueDate: `${nextMonth}-01`,
        paymentMode: 'lump',
      })
    ).body;
    const plan = (await api.get(`/due/${lastMonth}?today=${today}`)).body;
    const saving = plan.find((e: any) => e.key === `save:${loan.id}`);
    // Vormonat bis Fälligkeit: fünf Monate → 240 € je Monat
    expect(saving).toMatchObject({ type: 'saving', amountCents: -24000 });

    await api.post(`/due/${lastMonth}/book`, { today, keys: [saving.key] });
    const saved = () => api.get('/loans').then((r) => r.body[0]);
    expect(await saved()).toMatchObject({ savedCents: 24000, balanceCents: 120000 });

    const tx = (await api.get(`/transactions?month=${lastMonth}`)).body.find(
      (t: any) => t.name === 'Rücklage für Privatkredit',
    );
    expect(tx).toMatchObject({ kind: 'reserve', amountCents: -24000 });
    expect((await api.del(`/transactions/${tx.id}`)).status).toBe(204);
    expect(await saved()).toMatchObject({ savedCents: 0 });
  });

  it('Zurückgelegtes lässt sich beim Kredit eintragen; bei Teilzahlungen gibt es keins', async () => {
    const { api } = await newUser();
    const loan = (
      await api.post('/loans', {
        kind: 'deadline',
        name: 'FC',
        balanceCents: 320000,
        dueDate: '2027-03-01',
        paymentMode: 'lump',
        savedCents: 50000,
      })
    ).body;
    expect(loan.savedCents).toBe(50000);
    const spread = await api.patch(`/loans/${loan.id}`, { paymentMode: 'spread' });
    expect(spread.body.savedCents).toBe(0);
  });
});
