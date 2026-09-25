import { describe, expect, it } from 'vitest';
import { categoryId, env, newUser, request, type Api } from './helpers.js';

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

async function fill(api: Api) {
  const acc = (
    await api.post('/accounts', { name: 'Tagesgeld', kind: 'savings', balanceCents: 62000 })
  ).body;
  const [pot] = (await api.get('/reserve-pots')).body;
  await api.patch(`/reserve-pots/${pot.id}`, { accountId: acc.id });
  const urlaub = (await api.post('/categories', { name: 'Urlaub' })).body;
  await api.post('/recurring-items', {
    name: 'Haftpflicht',
    amountCents: 3600,
    intervalMonths: 3,
    startMonth: month,
    kind: 'fixed',
    categoryId: await categoryId(api, 'Versicherungen'),
  });
  await api.post('/transactions', {
    date: today,
    name: 'Hotel',
    categoryId: urlaub.id,
    amountCents: -25000,
  });
  await api.post('/loans', {
    kind: 'installment',
    name: 'Auto',
    balanceCents: 840000,
    rateBp: 590,
    paymentCents: 26000,
  });
  await api.post(`/due/${month}/book`, { today, overrides: [] });
  await api.post('/snapshots', { date: today });
  await api.patch('/settings', { loanBudgetCents: 31000, strategy: 'snowball' });
}

/** Vergleichbare Form ohne IDs und Zeitstempel. */
function essence(file: any) {
  const d = file.data;
  const catName = new Map(d.categories.map((c: any) => [c.id, c.name]));
  const sortBy = (xs: any[], k: string) =>
    [...xs].sort((a, b) => String(a[k]).localeCompare(String(b[k])));
  return {
    settings: d.settings,
    accounts: sortBy(d.accounts, 'name').map((a: any) => [a.name, a.kind, a.balanceCents]),
    categories: sortBy(d.categories, 'name').map((c: any) => [c.name, c.systemKey]),
    items: d.recurringItems.map((i: any) => [i.name, i.amountCents, catName.get(i.categoryId)]),
    transactions: sortBy(d.transactions, 'name').map((t: any) => [
      t.name,
      t.amountCents,
      t.kind,
      catName.get(t.categoryId),
    ]),
    booked: d.bookedItems.map((b: any) => b.bookingKey.split(':')[0]).sort(),
    loans: d.loans.map((l: any) => [l.name, l.balanceCents]),
    snapshots: d.snapshots.map((s: any) => [s.date, s.netCents]),
  };
}

describe('Export und Import', () => {
  it('Export enthält alle eigenen Daten als Datei-Download', async () => {
    const { api, cookie } = await newUser();
    await fill(api);
    const res = await request('/api/export', { cookie });
    expect(res.headers.get('content-disposition')).toMatch(
      /attachment; filename="financeanchor-sicherung-/,
    );
    const file = await res.json<any>();
    expect(file).toMatchObject({ format: 'financeanchor-export', version: 2 });
    expect(file.data.transactions.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(file)).not.toContain('userId');
  });

  it('Rundreise in einen anderen Account: gleiche Inhalte, neue IDs, Verweise intakt', async () => {
    const alice = await newUser('alice');
    await fill(alice.api);
    const original = (await alice.api.get('/export')).body;

    const bob = await newUser('bob');
    await bob.api.post('/transactions', {
      date: today,
      name: 'Wird ersetzt',
      categoryId: await categoryId(bob.api, 'Sonstiges'),
      amountCents: -1,
    });
    const res = await bob.api.post('/import', original);
    expect(res.status).toBe(200);
    const copy = (await bob.api.get('/export')).body;

    expect(essence(copy)).toEqual(essence(original));
    const originalIds = new Set(original.data.transactions.map((t: any) => t.id));
    expect(copy.data.transactions.some((t: any) => originalIds.has(t.id))).toBe(false);
    // Alice unverändert
    expect(essence((await alice.api.get('/export')).body)).toEqual(essence(original));
    // Fälligkeiten gelten nach dem Import weiter als gebucht
    const plan = (await bob.api.get(`/due/${month}?today=${today}`)).body;
    expect(plan.filter((e: any) => e.booked).length).toBe(copy.data.bookedItems.length);
  });

  it('eigene Sicherung wieder einlesen stellt den Stand her', async () => {
    const { api } = await newUser();
    await fill(api);
    const backup = (await api.get('/export')).body;
    await api.post('/transactions', {
      date: today,
      name: 'Nach der Sicherung',
      categoryId: await categoryId(api, 'Sonstiges'),
      amountCents: -99,
    });
    expect((await api.post('/import', backup)).status).toBe(200);
    expect(essence((await api.get('/export')).body)).toEqual(essence(backup));
  });

  it('ungültige Sicherung wird abgelehnt und ändert nichts', async () => {
    const { api } = await newUser();
    await fill(api);
    const before = (await api.get('/export')).body;
    const broken = structuredClone(before);
    broken.data.transactions[0].categoryId = '01900000-0000-7000-8000-000000000000';
    const res = await api.post('/import', broken);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'import_invalid' } });
    expect((await api.post('/import', { format: 'etwas-anderes' })).status).toBe(400);
    const noDefault = structuredClone(before);
    noDefault.data.reservePots[0].isDefault = false;
    expect((await api.post('/import', noDefault)).body.error.code).toBe('import_invalid');
    expect(essence((await api.get('/export')).body)).toEqual(essence(before));
  });

  it('ohne Freigabe für Export: 402', async () => {
    const { api, userId } = await newUser();
    await env.DB.prepare(`update entitlements set features = '["core"]' where user_id = ?`)
      .bind(userId)
      .run();
    expect((await api.get('/export')).status).toBe(402);
    expect((await api.get('/accounts')).status).toBe(200);
  });
});
