import { addMonths, monthOfDate } from '@financeanchor/shared';
import { describe, expect, it } from 'vitest';
import { categoryId, newUser } from './helpers.js';

const today = new Date().toISOString().slice(0, 10);
const thisMonth = monthOfDate(today);
const lastMonth = addMonths(thisMonth, -1);
const twoAgo = addMonths(thisMonth, -2);

describe('Hinweise zu Fixkosten', () => {
  it('Vorlage anpassen und mögliche Abos', async () => {
    const { api } = await newUser();
    const cat = await categoryId(api, 'Wohnen');
    const strom = (
      await api.post('/recurring-items', {
        name: 'Strom',
        amountCents: 9000,
        intervalMonths: 1,
        kind: 'fixed',
        dueDay: 1,
        startMonth: twoAgo,
        categoryId: cat,
      })
    ).body;
    const key = `item:${strom.id}`;
    for (const month of [twoAgo, lastMonth]) {
      const res = await api.post(`/due/${month}/book`, {
        today,
        keys: [key],
        overrides: [{ key, amountCents: 9480 }],
      });
      expect(res.status).toBe(200);
    }
    for (const date of [`${lastMonth}-15`, `${thisMonth}-01`]) {
      await api.post('/transactions', {
        date,
        name: 'Netflix',
        categoryId: cat,
        amountCents: -1399,
      });
    }

    const res = await api.get(`/recurring-items/insights?today=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.templates).toEqual([{ itemId: strom.id, amountCents: 9480 }]);
    expect(res.body.subscriptions).toEqual([
      expect.objectContaining({ name: 'Netflix', amountCents: 1399, months: 2 }),
    ]);

    // Fremde sehen nichts
    const bob = await newUser('bob');
    expect((await bob.api.get(`/recurring-items/insights?today=${today}`)).body).toEqual({
      templates: [],
      subscriptions: [],
    });
  });
});
