import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { chunkedInsert, createDb, runBatch } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { demoRows } from '../src/services/demoData.js';
import { env, newUser } from './helpers.js';

describe('Beispieldaten', () => {
  it('passen zu den Startkategorien und ergeben sinnvolle Fälligkeiten', async () => {
    const { api, userId } = await newUser();
    const today = new Date().toISOString().slice(0, 10);
    const cats = (await api.get('/categories')).body as { id: string; name: string }[];
    const d = demoRows(userId, today, new Map(cats.map((c) => [c.name, c.id])));
    const db = createDb(env.DB);
    await runBatch(db, [
      ...chunkedInsert(db, t.accounts, d.accounts),
      ...chunkedInsert(db, t.recurringItems, d.recurringItems),
      ...chunkedInsert(db, t.loans, d.loans),
      ...chunkedInsert(db, t.transactions, d.transactions),
      ...chunkedInsert(db, t.netWorthSnapshots, d.snapshots),
      db
        .update(t.reservePots)
        .set({ accountId: d.reserveAccountId })
        .where(eq(t.reservePots.userId, userId)),
    ]);
    const plan = (await api.get(`/due/${today.slice(0, 7)}?today=${today}`)).body as any[];
    const reserve = plan.find((e) => e.type === 'reserve');
    // 36/3 + 60/12 + 150/3 + 180/12 + 250/6 = 123,67 €
    expect(reserve).toMatchObject({
      amountCents: -12367,
      name: 'Rücklage aufs Tagesgeld Rücklage',
    });
    // Autokredit, Laptop und die Teilzahlung des Privatkredits (bis Ende März)
    const loanEntries = plan.filter((e) => e.type === 'loan');
    expect(loanEntries).toHaveLength(3);
    expect(
      loanEntries.find((e) => e.name === 'Rate Privatkredit Familie')!.amountCents,
    ).toBeLessThan(0);
    expect((await api.get('/snapshots')).body).toHaveLength(11);
  });
});
