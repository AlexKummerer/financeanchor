import {
  accountCreateSchema,
  accountShapeIssues,
  accountUpdateSchema,
  cardBalance,
} from '@financeanchor/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { runBatch } from '../db/client.js';
import { accounts, reservePots, transactions } from '../db/schema.js';
import { AppError } from '../errors.js';
import { strip } from '../mappers.js';
import type { AppEnv } from '../middleware/context.js';
import {
  accountsWithBalances,
  assertDebitAccount,
  cardMovements,
  withCardBalances,
} from '../services/cards.js';
import { validate } from '../validation.js';
import { found, idParam, one, scopedFrom } from './util.js';

/** Kartenfelder gehören nur zu Kreditkarten. */
function cardFields<
  T extends {
    kind: string;
    statementDay: number | null;
    debitDay: number | null;
    debitAccountId: string | null;
  },
>(a: T): T {
  return a.kind === 'credit_card'
    ? a
    : { ...a, statementDay: null, debitDay: null, debitAccountId: null };
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const accountRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    return c.json((await accountsWithBalances(scopedFrom(c))).map(strip));
  })
  .post('/', validate('json', accountCreateSchema), async (c) => {
    const s = scopedFrom(c);
    const body = cardFields(c.req.valid('json'));
    await assertDebitAccount(s, body.debitAccountId);
    // Bei einer neuen Karte ist der eingegebene Stand der Startstand (noch keine Buchungen).
    const row = one(await s.insert(accounts, body), 'account');
    return c.json(strip(row), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', accountUpdateSchema), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    const current = found(await s.get(accounts, id), 'account');
    const patch = c.req.valid('json');
    const next = cardFields({ ...current, ...(definedOnly(patch) as Partial<typeof current>) });
    const issues = accountShapeIssues(next);
    if (issues.length) throw new AppError(400, 'validation_failed', 'Invalid account', issues);
    await assertDebitAccount(s, next.debitAccountId, id);
    const movements = await cardMovements(s);
    if (next.kind === 'credit_card' && patch.balanceCents !== undefined) {
      // Eingegeben wird der aktuelle Stand; gespeichert wird der Startstand ohne die Buchungen.
      next.balanceCents = patch.balanceCents - cardBalance(0, movements, id);
    }
    const { id: _id, userId: _u, createdAt: _c, updatedAt: _up, ...values } = next;
    const row = one(await s.update(accounts, id, values), 'account');
    const [shown = row] = withCardBalances([row], movements);
    return c.json(strip(shown));
  })
  .delete('/:id', validate('param', idParam), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    found(await s.get(accounts, id), 'account');
    const now = Date.now();
    // Verknüpfungen lösen, statt die Löschung zu blockieren: Rücklagentöpfe verlieren ihr Konto,
    // Käufe mit der Karte bleiben als Ausgaben, Karten verlieren ihr Abbuchungskonto.
    await runBatch(s.db, [
      s.db
        .update(reservePots)
        .set({ accountId: null, updatedAt: now })
        .where(s.own(reservePots, eq(reservePots.accountId, id))),
      s.db
        .update(transactions)
        .set({ accountId: null, updatedAt: now })
        .where(s.own(transactions, eq(transactions.accountId, id))),
      s.db
        .update(accounts)
        .set({ debitAccountId: null, updatedAt: now })
        .where(and(s.own(accounts), eq(accounts.debitAccountId, id))),
      s.remove(accounts, id),
    ]);
    return c.body(null, 204);
  });
