import {
  importCheckSchema,
  importCommitSchema,
  transactionCreateSchema,
  transactionUpdateSchema,
  yearMonthSchema,
} from '@financeanchor/shared';
import { and, desc, eq, gte, inArray, isNull, like, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { chunkedInsert, runBatch } from '../db/client.js';
import { accounts, bookedItems, loans, transactions } from '../db/schema.js';
import { AppError } from '../errors.js';
import { strip } from '../mappers.js';
import type { AppEnv } from '../middleware/context.js';
import { assertCardAccount } from '../services/cards.js';
import { validate } from '../validation.js';
import { found, idParam, one, scopedFrom } from './util.js';

const monthQuery = z.object({ month: yearMonthSchema });

export const transactionRoutes = new Hono<AppEnv>()
  .get('/', validate('query', monthQuery), async (c) => {
    const s = scopedFrom(c);
    const rows = await s.db
      .select()
      .from(transactions)
      .where(s.own(transactions, like(transactions.date, `${c.req.valid('query').month}-%`)))
      .orderBy(desc(transactions.date), desc(transactions.createdAt));
    return c.json(rows.map(strip));
  })
  /** Monate, in denen es Buchungen gibt, absteigend. */
  .get('/months', async (c) => {
    const s = scopedFrom(c);
    const month = sql<string>`substr(${transactions.date}, 1, 7)`;
    const rows = await s.db
      .selectDistinct({ month })
      .from(transactions)
      .where(s.own(transactions))
      .orderBy(desc(month));
    return c.json(rows.map((r) => r.month));
  })
  /** Namen früherer Buchungen mit zuletzt verwendeter Kategorie (Vorschläge beim Erfassen). */
  .get('/suggestions', async (c) => {
    const s = scopedFrom(c);
    const rows = await s.db
      .select({ name: transactions.name, categoryId: transactions.categoryId })
      .from(transactions)
      .where(s.own(transactions, eq(transactions.kind, 'normal')))
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(500);
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.name)) seen.set(r.name, r.categoryId);
    return c.json([...seen].slice(0, 100).map(([name, categoryId]) => ({ name, categoryId })));
  })
  /**
   * CSV-Import, Schritt 1: welche Fingerabdrücke schon übernommen sind, und die Buchungen im
   * Zeitraum (±3 Tage), um „wahrscheinlich schon gebucht“ zu erkennen.
   */
  .post('/import/check', validate('json', importCheckSchema), async (c) => {
    const s = scopedFrom(c);
    const { keys, from, to } = c.req.valid('json');
    const known: string[] = [];
    // D1 erlaubt höchstens 100 Parameter je Abfrage
    for (let i = 0; i < keys.length; i += 90) {
      const chunk = keys.slice(i, i + 90);
      const rows = await s.db
        .select({ key: transactions.importKey })
        .from(transactions)
        .where(s.own(transactions, inArray(transactions.importKey, chunk)));
      for (const r of rows) if (r.key) known.push(r.key);
    }
    const existing = await s.db
      .select({
        id: transactions.id,
        date: transactions.date,
        amountCents: transactions.amountCents,
        name: transactions.name,
        importKey: transactions.importKey,
      })
      .from(transactions)
      .where(
        s.own(
          transactions,
          and(
            gte(transactions.date, shiftDate(from, -3)),
            lte(transactions.date, shiftDate(to, 3)),
          ),
        ),
      );
    return c.json({ known, existing });
  })
  /**
   * CSV-Import, Schritt 2: bestätigte Zeilen atomar übernehmen – neue Buchungen anlegen und bei
   * schon vorhandenen nur den Fingerabdruck merken. Doppelte Fingerabdrücke brechen alles ab (409).
   */
  .post('/import', validate('json', importCommitSchema), async (c) => {
    const s = scopedFrom(c);
    const body = c.req.valid('json');
    await assertCardAccount(s, body.accountId);
    if (body.profile) found(await s.get(accounts, body.profile.accountId), 'account');
    const now = Date.now();
    const rows = body.items.map((item) =>
      s.row(
        transactions,
        {
          ...item,
          kind: 'normal' as const,
          sourceType: null,
          sourceId: null,
          accountId: body.accountId,
        },
        now,
      ),
    );
    try {
      await runBatch(s.db, [
        ...chunkedInsert(s.db, transactions, rows),
        ...body.links.map((l) =>
          s.db
            .update(transactions)
            .set({ importKey: l.importKey, updatedAt: now })
            .where(
              s.own(
                transactions,
                and(eq(transactions.id, l.transactionId), isNull(transactions.importKey)),
              ),
            ),
        ),
        ...(body.profile
          ? [
              s.db
                .update(accounts)
                .set({ importProfile: body.profile.profile, updatedAt: now })
                .where(s.own(accounts, eq(accounts.id, body.profile.accountId))),
            ]
          : []),
      ]);
    } catch (err) {
      if (String(err).includes('UNIQUE')) {
        throw new AppError(409, 'already_imported', 'Some rows were imported already');
      }
      throw err;
    }
    return c.json({ created: rows.length, linked: body.links.length }, 201);
  })
  .post('/', validate('json', transactionCreateSchema), async (c) => {
    const s = scopedFrom(c);
    await assertCardAccount(s, c.req.valid('json').accountId);
    const row = one(
      await s.insert(transactions, {
        ...c.req.valid('json'),
        kind: 'normal',
        sourceType: null,
        sourceId: null,
      }),
      'transaction',
    );
    return c.json(strip(row), 201);
  })
  .patch(
    '/:id',
    validate('param', idParam),
    validate('json', transactionUpdateSchema),
    async (c) => {
      const s = scopedFrom(c);
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      if (patch.accountId !== undefined) {
        const current = found(await s.get(transactions, id), 'transaction');
        // „Bezahlt mit“ gibt es nur bei selbst erfassten Buchungen
        if (current.kind !== 'normal' && patch.accountId !== current.accountId) {
          throw new AppError(409, 'managed_transaction', 'Account can only be set on own entries');
        }
        await assertCardAccount(s, patch.accountId);
      }
      if (patch.amountCents !== undefined) {
        const effects = await bookingEffectsOf(s.db, s.userId, id);
        if (
          effects.some(
            (b) =>
              b.accountDeltaCents !== 0 || b.loanDeltaCents !== 0 || b.loanSavedDeltaCents !== 0,
          )
        ) {
          // Der Betrag steckt schon in einem Kontostand oder einer Restschuld.
          throw new AppError(
            409,
            'managed_transaction',
            'Delete and book again to change the amount',
          );
        }
      }
      const row = one(await s.update(transactions, id, patch), 'transaction');
      return c.json(strip(row));
    },
  )
  /** Löschen macht Änderungen an Rücklagenkonto oder Restschuld rückgängig; der Posten ist wieder offen. */
  .delete('/:id', validate('param', idParam), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    found(await s.get(transactions, id), 'transaction');
    const now = Date.now();
    const reverts = (await bookingEffectsOf(s.db, s.userId, id)).flatMap((b) => [
      ...(b.accountId && b.accountDeltaCents
        ? [
            s.db
              .update(accounts)
              .set({
                balanceCents: sql`${accounts.balanceCents} - ${b.accountDeltaCents}`,
                updatedAt: now,
              })
              .where(s.byId(accounts, b.accountId)),
          ]
        : []),
      ...(b.loanId && b.loanSavedDeltaCents
        ? [
            s.db
              .update(loans)
              .set({
                savedCents: sql`max(0, ${loans.savedCents} - ${b.loanSavedDeltaCents})`,
                updatedAt: now,
              })
              .where(s.byId(loans, b.loanId)),
          ]
        : []),
      ...(b.loanId && b.loanDeltaCents
        ? [
            s.db
              .update(loans)
              .set({
                balanceCents: sql`max(0, ${loans.balanceCents} - ${b.loanDeltaCents})`,
                updatedAt: now,
              })
              .where(s.byId(loans, b.loanId)),
          ]
        : []),
    ]);
    await runBatch(s.db, [...reverts, s.remove(transactions, id)]);
    return c.body(null, 204);
  });

function bookingEffectsOf(
  db: ReturnType<typeof scopedFrom>['db'],
  userId: string,
  transactionId: string,
) {
  return db
    .select()
    .from(bookedItems)
    .where(and(eq(bookedItems.userId, userId), eq(bookedItems.transactionId, transactionId)));
}

/** Datum um Tage verschieben (für das Suchfenster ähnlicher Buchungen). */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
