import { describe, expect, it } from 'vitest';
import { categoryId, newUser } from './helpers.js';

describe('Konten', () => {
  it('anlegen, ändern, auflisten, löschen', async () => {
    const { api } = await newUser();
    const created = await api.post('/accounts', {
      name: 'Girokonto',
      kind: 'checking',
      balanceCents: 185000,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Girokonto', balanceCents: 185000, sortOrder: 0 });
    expect(created.body).not.toHaveProperty('userId');

    const updated = await api.patch(`/accounts/${created.body.id}`, { balanceCents: 190000 });
    expect(updated.body.balanceCents).toBe(190000);
    expect(updated.body.name).toBe('Girokonto');

    expect((await api.get('/accounts')).body).toHaveLength(1);
    expect((await api.del(`/accounts/${created.body.id}`)).status).toBe(204);
    expect((await api.get('/accounts')).body).toHaveLength(0);
  });

  it('Löschen eines verknüpften Kontos löst die Verknüpfung am Rücklagentopf', async () => {
    const { api } = await newUser();
    const acc = await api.post('/accounts', {
      name: 'Tagesgeld',
      kind: 'savings',
      balanceCents: 62000,
    });
    const [pot] = (await api.get('/reserve-pots')).body;
    await api.patch(`/reserve-pots/${pot.id}`, { accountId: acc.body.id });
    expect((await api.del(`/accounts/${acc.body.id}`)).status).toBe(204);
    expect((await api.get('/reserve-pots')).body[0].accountId).toBeNull();
  });

  it('lehnt ungültige Eingaben mit einheitlichem Fehlerformat ab', async () => {
    const { api } = await newUser();
    const res = await api.post('/accounts', { name: '', kind: 'bank', balanceCents: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Rücklagentöpfe', () => {
  it('Standardtopf existiert und lässt sich nicht löschen', async () => {
    const { api } = await newUser();
    const pots = (await api.get('/reserve-pots')).body;
    expect(pots).toHaveLength(1);
    expect(pots[0]).toMatchObject({
      name: 'Rücklage',
      isDefault: true,
      dueDay: 1,
      monthlyAmountCents: null,
    });
    expect((await api.del(`/reserve-pots/${pots[0].id}`)).body).toMatchObject({
      error: { code: 'default_pot' },
    });
  });

  it('weitere Töpfe; beim Löschen fallen deren Posten auf den Standardtopf zurück', async () => {
    const { api } = await newUser();
    const pot = await api.post('/reserve-pots', {
      name: 'Urlaub',
      accountId: null,
      monthlyAmountCents: 10000,
    });
    expect(pot.body).toMatchObject({ isDefault: false, dueDay: 1 });
    const item = await api.post('/recurring-items', {
      name: 'Sommerurlaub',
      amountCents: 120000,
      intervalMonths: 12,
      startMonth: '2027-06',
      kind: 'saving',
      categoryId: await categoryId(api, 'Sparen'),
      reservePotId: pot.body.id,
    });
    expect(item.status).toBe(201);
    expect((await api.del(`/reserve-pots/${pot.body.id}`)).status).toBe(204);
    expect((await api.get('/recurring-items')).body[0].reservePotId).toBeNull();
  });
});

describe('Kategorien', () => {
  it('Namen sind eindeutig, auch bei Umlauten und Groß-/Kleinschreibung', async () => {
    const { api } = await newUser();
    expect((await api.post('/categories', { name: 'Ärzte' })).status).toBe(201);
    expect((await api.post('/categories', { name: ' ärzte ' })).body).toMatchObject({
      error: { code: 'name_taken' },
    });
    expect((await api.post('/categories', { name: 'rücklage' })).body).toMatchObject({
      error: { code: 'name_taken' },
    });
  });

  it('Umbenennen wirkt überall, weil per ID verwiesen wird', async () => {
    const { api } = await newUser();
    const id = await categoryId(api, 'Sparen');
    await api.post('/transactions', {
      date: '2026-09-02',
      name: 'Sparschwein',
      categoryId: id,
      amountCents: -1000,
    });
    const res = await api.patch(`/categories/${id}`, { name: 'Urlaub' });
    expect(res.body).toMatchObject({ id, name: 'Urlaub' });
    const [tx] = (await api.get('/transactions?month=2026-09')).body;
    expect(tx.categoryId).toBe(id);
  });

  it('Systemkategorien sind fest', async () => {
    const { api } = await newUser();
    const id = await categoryId(api, 'Rücklage');
    expect((await api.patch(`/categories/${id}`, { name: 'X' })).status).toBe(403);
    expect((await api.del(`/categories/${id}`)).status).toBe(403);
  });

  it('verwendete Kategorie: Löschen nur mit Zielkategorie, dann wird alles verschoben', async () => {
    const { api } = await newUser();
    const from = await categoryId(api, 'Kleidung');
    const to = await categoryId(api, 'Sonstiges');
    await api.post('/transactions', {
      date: '2026-09-02',
      name: 'Schuhe',
      categoryId: from,
      amountCents: -8000,
    });
    await api.post('/recurring-items', {
      name: 'Kleiderabo',
      amountCents: 2000,
      intervalMonths: 1,
      startMonth: '2026-01',
      kind: 'fixed',
      categoryId: from,
    });
    expect((await api.get('/categories/usage')).body[from]).toBe(2);

    const blocked = await api.del(`/categories/${from}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: { code: 'category_in_use' } });

    expect(
      (await api.del(`/categories/${from}?moveTo=${await categoryId(api, 'Kredite')}`)).status,
    ).toBe(400);
    expect((await api.del(`/categories/${from}?moveTo=${to}`)).status).toBe(204);
    expect((await api.get('/transactions?month=2026-09')).body[0].categoryId).toBe(to);
    expect((await api.get('/recurring-items')).body[0].categoryId).toBe(to);
    expect((await api.get('/categories/usage')).body[to]).toBe(2);
  });

  it('unbenutzte Kategorie lässt sich direkt löschen', async () => {
    const { api } = await newUser();
    expect((await api.del(`/categories/${await categoryId(api, 'Geschenke')}`)).status).toBe(204);
  });
});

describe('Wiederkehrende Posten', () => {
  it('Standardwerte und Prüfung des Rhythmus', async () => {
    const { api } = await newUser();
    const categoryIdWohnen = await categoryId(api, 'Wohnen');
    const base = {
      name: 'Miete',
      amountCents: 85000,
      intervalMonths: 1,
      startMonth: '2026-01',
      kind: 'fixed',
      categoryId: categoryIdWohnen,
    };
    const res = await api.post('/recurring-items', base);
    expect(res.body).toMatchObject({ dueDay: 1, reservePotId: null });
    expect((await api.post('/recurring-items', { ...base, intervalMonths: 5 })).status).toBe(400);
    const every4 = await api.post('/recurring-items', {
      ...base,
      name: 'Wasser',
      intervalMonths: 4,
    });
    expect(every4.body).toMatchObject({ intervalMonths: 4 });
    const upd = await api.patch(`/recurring-items/${res.body.id}`, {
      dueDay: 3,
      amountCents: 87000,
    });
    expect(upd.body).toMatchObject({ dueDay: 3, amountCents: 87000, name: 'Miete' });
    expect((await api.del(`/recurring-items/${res.body.id}`)).status).toBe(204);
  });
});

describe('Buchungen', () => {
  it('nach Monat, Monatsliste und Vorschläge', async () => {
    const { api } = await newUser();
    const food = await categoryId(api, 'Lebensmittel');
    await api.post('/transactions', {
      date: '2026-09-03',
      name: 'Edeka',
      categoryId: food,
      amountCents: -6430,
    });
    await api.post('/transactions', {
      date: '2026-09-12',
      name: 'Lidl',
      categoryId: food,
      amountCents: -4120,
    });
    await api.post('/transactions', {
      date: '2026-08-30',
      name: 'Edeka',
      categoryId: food,
      amountCents: -1000,
    });

    const sept = (await api.get('/transactions?month=2026-09')).body;
    expect(sept.map((t: any) => t.name)).toEqual(['Lidl', 'Edeka']);
    expect(sept[0]).toMatchObject({ kind: 'normal', sourceType: null });
    expect((await api.get('/transactions/months')).body).toEqual(['2026-09', '2026-08']);
    expect((await api.get('/transactions/suggestions')).body).toEqual([
      { name: 'Lidl', categoryId: food },
      { name: 'Edeka', categoryId: food },
    ]);
    expect((await api.get('/transactions')).status).toBe(400);
  });

  it('ändern und löschen; Betrag 0 ist ungültig', async () => {
    const { api } = await newUser();
    const cat = await categoryId(api, 'Freizeit');
    const tx = await api.post('/transactions', {
      date: '2026-09-08',
      name: 'Kino',
      categoryId: cat,
      amountCents: -2400,
    });
    expect(
      (
        await api.post('/transactions', {
          date: '2026-09-08',
          name: 'X',
          categoryId: cat,
          amountCents: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (await api.patch(`/transactions/${tx.body.id}`, { amountCents: -2600 })).body.amountCents,
    ).toBe(-2600);
    expect((await api.del(`/transactions/${tx.body.id}`)).status).toBe(204);
    expect((await api.del(`/transactions/${tx.body.id}`)).status).toBe(404);
  });
});

describe('Kredite', () => {
  it('Ursprungsbetrag fällt auf die Restschuld zurück', async () => {
    const { api } = await newUser();
    const res = await api.post('/loans', {
      kind: 'installment',
      name: 'Laptop',
      balanceCents: 90000,
      rateBp: 0,
      paymentCents: 7500,
    });
    expect(res.body).toMatchObject({ originalCents: 90000, dueDay: 1 });
    expect(
      (await api.patch(`/loans/${res.body.id}`, { balanceCents: 82500 })).body.balanceCents,
    ).toBe(82500);
    expect(
      (
        await api.post('/loans', {
          kind: 'installment',
          name: 'X',
          balanceCents: 1,
          rateBp: 20000,
          paymentCents: 1,
        })
      ).status,
    ).toBe(400);
  });
});

describe('Einstellungen', () => {
  it('Kreditbudget und Strategie', async () => {
    const { api } = await newUser();
    const res = await api.patch('/settings', { loanBudgetCents: 50000, strategy: 'snowball' });
    expect(res.body).toEqual({
      loanBudgetCents: 50000,
      strategy: 'snowball',
      locale: 'de',
      currency: 'EUR',
    });
    expect((await api.get('/me')).body.settings.strategy).toBe('snowball');
  });
});

describe('Vermögensstände', () => {
  it('berechnet den Stand serverseitig, höchstens einer pro Tag', async () => {
    const { api } = await newUser();
    const acc = await api.post('/accounts', {
      name: 'Giro',
      kind: 'checking',
      balanceCents: 100000,
    });
    await api.post('/loans', {
      kind: 'installment',
      name: 'Auto',
      balanceCents: 40000,
      rateBp: 590,
      paymentCents: 26000,
    });
    const first = await api.post('/snapshots', { date: '2026-09-25' });
    expect(first.body).toMatchObject({ assetsCents: 100000, debtCents: 40000, netCents: 60000 });

    await api.patch(`/accounts/${acc.body.id}`, { balanceCents: 120000 });
    await api.post('/snapshots', { date: '2026-09-25' });
    const list = (await api.get('/snapshots')).body;
    expect(list).toHaveLength(1);
    expect(list[0].netCents).toBe(80000);

    await api.post('/snapshots', { date: '2026-10-09' });
    expect((await api.get('/snapshots')).body.map((s: any) => s.date)).toEqual([
      '2026-09-25',
      '2026-10-09',
    ]);
  });
});

describe('Kredite „Tilgen bis Datum“', () => {
  it('anlegen: keine Rate, Buchungstag aus der Frist, Ursprungsbetrag = Restschuld', async () => {
    const { api } = await newUser();
    const res = await api.post('/loans', {
      kind: 'deadline',
      name: 'Privatkredit',
      balanceCents: 150000,
      dueDate: '2027-03-31',
      paymentMode: 'spread',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'deadline',
      paymentCents: null,
      dueDay: 31,
      rateBp: 0,
      originalCents: 150000,
      targetMonth: null,
      paymentMode: 'spread',
    });
  });

  it('ändern: Frist verschieben passt den Buchungstag an; Art wechseln räumt fremde Felder auf', async () => {
    const { api } = await newUser();
    const created = (
      await api.post('/loans', {
        kind: 'deadline',
        name: 'Klarna',
        balanceCents: 30000,
        dueDate: '2026-11-20',
        paymentMode: 'lump',
      })
    ).body;
    const moved = await api.patch(`/loans/${created.id}`, { dueDate: '2026-12-05' });
    expect(moved.body).toMatchObject({ dueDate: '2026-12-05', dueDay: 5 });

    const switched = await api.patch(`/loans/${created.id}`, {
      kind: 'installment',
      paymentCents: 10000,
    });
    expect(switched.body).toMatchObject({
      kind: 'installment',
      paymentCents: 10000,
      dueDate: null,
      paymentMode: null,
    });

    const missing = await api.patch(`/loans/${created.id}`, { kind: 'deadline' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.map((i: any) => i.path)).toEqual(['dueDate', 'paymentMode']);
  });

  it('Ratenkredit mit Zieldatum; ohne Rate abgelehnt', async () => {
    const { api } = await newUser();
    const ok = await api.post('/loans', {
      kind: 'installment',
      name: 'Auto',
      balanceCents: 500000,
      rateBp: 590,
      paymentCents: 20000,
      targetMonth: '2027-12',
    });
    expect(ok.body).toMatchObject({ targetMonth: '2027-12' });
    expect(
      (await api.post('/loans', { kind: 'installment', name: 'X', balanceCents: 100 })).status,
    ).toBe(400);
  });
});

describe('Eigene Extra-Tilgung', () => {
  it('lässt sich anlegen und ändern; bei Einmalzahlungen gibt es keine', async () => {
    const { api } = await newUser();
    const pb = await api.post('/loans', {
      kind: 'installment',
      name: 'Postbank',
      balanceCents: 2342023,
      rateBp: 1110,
      paymentCents: 36499,
      targetMonth: '2031-12',
      extraMonthlyCents: 12154,
    });
    expect(pb.body).toMatchObject({ extraMonthlyCents: 12154 });
    expect(
      (await api.patch(`/loans/${pb.body.id}`, { extraMonthlyCents: 0 })).body.extraMonthlyCents,
    ).toBe(0);
    expect((await api.patch(`/loans/${pb.body.id}`, { extraMonthlyCents: -1 })).status).toBe(400);
    const from = await api.patch(`/loans/${pb.body.id}`, {
      extraMonthlyCents: 5000,
      extraFromMonth: '2026-10',
    });
    expect(from.body).toMatchObject({ extraMonthlyCents: 5000, extraFromMonth: '2026-10' });
    expect((await api.patch(`/loans/${pb.body.id}`, { extraFromMonth: '2026-13' })).status).toBe(
      400,
    );

    const klarna = await api.post('/loans', {
      kind: 'deadline',
      name: 'Klarna',
      balanceCents: 30000,
      dueDate: '2026-12-01',
      paymentMode: 'lump',
      extraMonthlyCents: 5000,
    });
    expect(klarna.body.extraMonthlyCents).toBe(0);
    expect(klarna.body.extraFromMonth).toBeNull();
    expect(klarna.body.saveUp).toBe(true);
    const off = await api.patch(`/loans/${klarna.body.id}`, { saveUp: false });
    expect(off.body.saveUp).toBe(false);
    // Wechsel auf Teilzahlungen: Ansparen gibt es dort nicht
    const spread = await api.patch(`/loans/${klarna.body.id}`, { paymentMode: 'spread' });
    expect(spread.body.saveUp).toBe(true);
  });
});
