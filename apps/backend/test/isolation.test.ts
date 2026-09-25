/**
 * Mandantentrennung: Ein Nutzer darf fremde Daten weder sehen noch ändern, löschen oder
 * referenzieren. Jeder Versuch muss wie „nicht vorhanden“ aussehen.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { categoryId, newUser, type Api } from './helpers.js';

let alice: Api;
let bob: Api;
const a: Record<string, string> = {};

beforeAll(async () => {
  alice = (await newUser('alice')).api;
  bob = (await newUser('bob')).api;

  a.category = (await alice.post('/categories', { name: 'Nur Alice' })).body.id;
  a.account = (
    await alice.post('/accounts', { name: 'Alice Giro', kind: 'checking', balanceCents: 5000 })
  ).body.id;
  a.pot = (
    await alice.post('/reserve-pots', {
      name: 'Alice Topf',
      accountId: a.account,
      monthlyAmountCents: null,
    })
  ).body.id;
  a.item = (
    await alice.post('/recurring-items', {
      name: 'Alice Miete',
      amountCents: 1000,
      intervalMonths: 1,
      startMonth: '2026-01',
      kind: 'fixed',
      categoryId: a.category,
    })
  ).body.id;
  a.tx = (
    await alice.post('/transactions', {
      date: '2026-09-01',
      name: 'Alice Kauf',
      categoryId: a.category,
      amountCents: -500,
    })
  ).body.id;
  a.loan = (
    await alice.post('/loans', {
      name: 'Alice Kredit',
      balanceCents: 10000,
      rateBp: 100,
      paymentCents: 1000,
    })
  ).body.id;
  a.snapshot = (await alice.post('/snapshots', { date: '2026-09-01' })).body.id;
  for (const [k, v] of Object.entries(a)) if (!v) throw new Error(`Setup fehlgeschlagen: ${k}`);
});

const resources = [
  ['accounts', 'account', { name: 'gekapert' }],
  ['reserve-pots', 'pot', { name: 'gekapert' }],
  ['categories', 'category', { name: 'gekapert' }],
  ['recurring-items', 'item', { name: 'gekapert' }],
  ['transactions', 'tx', { name: 'gekapert' }],
  ['loans', 'loan', { name: 'gekapert' }],
] as const;

describe('Lesen', () => {
  const listPaths = [
    ...resources.map(([p]) => (p === 'transactions' ? 'transactions?month=2026-09' : p)),
    'snapshots',
  ];
  it.each(listPaths)('/%s enthält keine fremden Daten', async (path) => {
    const res = await bob.get(`/${path}`);
    expect(res.status).toBe(200);
    const foreign = new Set(Object.values(a));
    expect((res.body as { id: string }[]).some((x) => foreign.has(x.id))).toBe(false);
  });

  it('Buchungen, Monate, Vorschläge und Verwendungen bleiben getrennt', async () => {
    expect((await bob.get('/transactions?month=2026-09')).body).toEqual([]);
    expect((await bob.get('/transactions/months')).body).toEqual([]);
    expect((await bob.get('/transactions/suggestions')).body).toEqual([]);
    expect((await bob.get('/categories/usage')).body).toEqual({});
  });
});

describe('Ändern und Löschen', () => {
  it.each(resources)('PATCH /%s/:id eines fremden Eintrags → 404', async (path, key, patch) => {
    expect((await bob.patch(`/${path}/${a[key]}`, patch)).status).toBe(404);
  });

  it.each([...resources, ['snapshots', 'snapshot', {}] as const])(
    'DELETE /%s/:id eines fremden Eintrags → 404',
    async (path, key) => {
      expect((await bob.del(`/${path}/${a[key]}`)).status).toBe(404);
    },
  );

  it('Alices Daten sind danach unverändert', async () => {
    expect((await alice.get('/accounts')).body[0]).toMatchObject({
      id: a.account,
      name: 'Alice Giro',
    });
    expect(
      (await alice.get('/categories')).body.some(
        (c: any) => c.id === a.category && c.name === 'Nur Alice',
      ),
    ).toBe(true);
    expect((await alice.get('/transactions?month=2026-09')).body).toHaveLength(1);
    expect((await alice.get('/loans')).body[0].name).toBe('Alice Kredit');
    expect((await alice.get('/snapshots')).body).toHaveLength(1);
    expect((await alice.get('/reserve-pots')).body.some((p: any) => p.id === a.pot)).toBe(true);
  });
});

describe('Verweise auf fremde Daten', () => {
  it('Buchung mit fremder Kategorie → 400', async () => {
    const res = await bob.post('/transactions', {
      date: '2026-09-01',
      name: 'X',
      categoryId: a.category,
      amountCents: -1,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'invalid_reference' } });
  });

  it('eigene Buchung auf fremde Kategorie umhängen → 400', async () => {
    const own = await categoryId(bob, 'Sonstiges');
    const tx = await bob.post('/transactions', {
      date: '2026-09-01',
      name: 'X',
      categoryId: own,
      amountCents: -1,
    });
    expect(
      (await bob.patch(`/transactions/${tx.body.id}`, { categoryId: a.category })).status,
    ).toBe(400);
  });

  it('Posten mit fremder Kategorie oder fremdem Topf → 400', async () => {
    const own = await categoryId(bob, 'Sonstiges');
    const base = {
      name: 'X',
      amountCents: 100,
      intervalMonths: 3,
      startMonth: '2026-01',
      kind: 'fixed',
    };
    expect((await bob.post('/recurring-items', { ...base, categoryId: a.category })).status).toBe(
      400,
    );
    expect(
      (await bob.post('/recurring-items', { ...base, categoryId: own, reservePotId: a.pot }))
        .status,
    ).toBe(400);
  });

  it('Topf mit fremdem Konto → 400', async () => {
    expect(
      (
        await bob.post('/reserve-pots', {
          name: 'X',
          accountId: a.account,
          monthlyAmountCents: null,
        })
      ).status,
    ).toBe(400);
  });

  it('Kategorie in fremde Kategorie verschieben → 400', async () => {
    const own = await categoryId(bob, 'Geschenke');
    expect((await bob.del(`/categories/${own}?moveTo=${a.category}`)).status).toBe(400);
  });

  it('Vermögensstand zählt nur eigene Konten und Kredite', async () => {
    const res = await bob.post('/snapshots', { date: '2026-09-02' });
    expect(res.body).toMatchObject({ assetsCents: 0, debtCents: 0, netCents: 0 });
  });

  it('Einstellungen ändern betrifft nur den eigenen Account', async () => {
    await bob.patch('/settings', { strategy: 'snowball' });
    expect((await alice.get('/me')).body.settings.strategy).toBe('avalanche');
  });
});
