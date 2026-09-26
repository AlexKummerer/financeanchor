import {
  accountCreateSchema,
  accountShapeIssues,
  accountUpdateSchema,
  addMonths,
  cardBalance,
  cardStatementDatePutSchema,
  idSchema,
  yearMonthSchema,
  inStatement,
  isoDateSchema,
  monthOfDate,
  statementClosingIn,
  statementFor,
  statementTotal,
  type Statement,
} from '@financeanchor/shared';
import { and, asc, eq, gte, isNotNull, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { runBatch } from '../db/client.js';
import {
  accounts,
  bookedItems,
  cardStatementDates,
  recurringItems,
  reservePots,
  transactions,
} from '../db/schema.js';
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

const statementsQuery = z.object({ today: isoDateSchema });
const statementParam = z.object({ id: idSchema, closeMonth: yearMonthSchema });

export const accountRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    return c.json((await accountsWithBalances(scopedFrom(c))).map(strip));
  })
  /**
   * Je Kreditkarte die laufende und die letzte Abrechnung mit Summe und Buchungen – zum Abgleich
   * mit der Abrechnung der Bank. `paid`: Abbuchung schon gebucht.
   */
  .get('/card-statements', validate('query', statementsQuery), async (c) => {
    const s = scopedFrom(c);
    const { today } = c.req.valid('query');
    const cards = (await s.db.select().from(accounts).where(s.own(accounts))).filter(
      (a) => a.kind === 'credit_card' && a.statementDay && a.debitDay,
    );
    if (!cards.length) return c.json([]);
    // Laufende und letzte Abrechnung liegen immer innerhalb der letzten drei Monate
    const earliest = `${addMonths(monthOfDate(today), -3)}-01`;
    const [txs, booked, allDates] = await s.db.batch([
      s.db
        .select({
          id: transactions.id,
          date: transactions.date,
          name: transactions.name,
          amountCents: transactions.amountCents,
          kind: transactions.kind,
          accountId: transactions.accountId,
          sourceType: transactions.sourceType,
          sourceId: transactions.sourceId,
          statementMonth: transactions.statementMonth,
        })
        .from(transactions)
        .where(
          s.own(
            transactions,
            and(isNotNull(transactions.accountId), gte(transactions.date, earliest)),
          ),
        )
        .orderBy(asc(transactions.date)),
      s.db
        .select({ key: bookedItems.bookingKey, month: bookedItems.month })
        .from(bookedItems)
        .where(s.own(bookedItems, like(bookedItems.bookingKey, 'card:%'))),
      s.db.select().from(cardStatementDates).where(s.own(cardStatementDates)),
    ]);
    const datesOf = (cardId: string) => allDates.filter((d) => d.accountId === cardId);
    const paid = new Set(booked.map((b) => `${b.key}|${b.month}`));
    const describe = (card: (typeof cards)[number], st: Statement) => ({
      ...st,
      // Stichtag/Abbuchung laut Bank eingetragen
      custom: datesOf(card.id).some((d) => d.closeMonth === st.closeMonth),
      ...statementTotal(txs, card.id, st),
      paid: paid.has(`card:${card.id}|${monthOfDate(st.debitDate)}`),
      transactions: txs
        .filter((t) => t.accountId === card.id && t.kind !== 'card_payment' && inStatement(t, st))
        .map(({ id, date, name, amountCents, statementMonth }) => ({
          id,
          date,
          name,
          amountCents,
          // Am Stichtag kann die Bank schon die nächste Abrechnung nehmen
          movable: !statementMonth && date === st.to,
          moved: !!statementMonth,
        })),
    });
    return c.json(
      cards.map((card) => {
        const dates = datesOf(card.id);
        const st = statementFor(card, today, dates);
        return {
          cardId: card.id,
          current: describe(card, st),
          previous: describe(card, statementClosingIn(card, addMonths(st.closeMonth, -1), dates)),
          // Nur interessant, wenn schon Käufe vom Stichtag dorthin verschoben wurden
          next: describe(card, statementClosingIn(card, addMonths(st.closeMonth, 1), dates)),
        };
      }),
    );
  })
  /** Stichtag und Abbuchung einer Abrechnung laut Bank setzen (Stichtag muss im Monat liegen). */
  .put(
    '/:id/statements/:closeMonth',
    validate('param', statementParam),
    validate('json', cardStatementDatePutSchema),
    async (c) => {
      const s = scopedFrom(c);
      const { id, closeMonth } = c.req.valid('param');
      const card = found(await s.get(accounts, id), 'account');
      if (card.kind !== 'credit_card') {
        throw new AppError(400, 'not_a_card', 'Only credit cards have statements');
      }
      const body = c.req.valid('json');
      if (monthOfDate(body.closingDate) !== closeMonth) {
        throw new AppError(400, 'validation_failed', 'Closing date must be in the month', [
          { path: 'closingDate', message: 'Stichtag außerhalb des Monats' },
        ]);
      }
      const now = Date.now();
      await s.db
        .insert(cardStatementDates)
        .values(s.row(cardStatementDates, { accountId: id, closeMonth, ...body }, now))
        .onConflictDoUpdate({
          target: [
            cardStatementDates.userId,
            cardStatementDates.accountId,
            cardStatementDates.closeMonth,
          ],
          set: { ...body, updatedAt: now },
        });
      return c.body(null, 204);
    },
  )
  .delete('/:id/statements/:closeMonth', validate('param', statementParam), async (c) => {
    const s = scopedFrom(c);
    const { id, closeMonth } = c.req.valid('param');
    await s.db
      .delete(cardStatementDates)
      .where(
        s.own(
          cardStatementDates,
          and(eq(cardStatementDates.accountId, id), eq(cardStatementDates.closeMonth, closeMonth)),
        ),
      );
    return c.body(null, 204);
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
        .update(recurringItems)
        .set({ accountId: null, updatedAt: now })
        .where(s.own(recurringItems, eq(recurringItems.accountId, id))),
      s.db
        .update(accounts)
        .set({ debitAccountId: null, updatedAt: now })
        .where(and(s.own(accounts), eq(accounts.debitAccountId, id))),
      s.remove(accounts, id),
    ]);
    return c.body(null, 204);
  });
