import {
  importCheckSchema,
  importCommitSchema,
  transactionDeleteManySchema,
  transactionCreateSchema,
  transactionUpdateSchema,
  yearMonthSchema,
} from '@financeanchor/shared';
import { and, desc, eq, gte, inArray, like, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { chunkedInsert, runBatch } from '../db/client.js';
import { accounts, importLinks, transactions } from '../db/schema.js';
import type { Scoped } from '../db/scoped.js';
import { AppError } from '../errors.js';
import { strip } from '../mappers.js';
import type { AppEnv } from '../middleware/context.js';
import { bookingEffectsOf, releaseBookings } from '../services/booking.js';
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
   * CSV-Import, Schritt 1: welche Fingerabdrücke schon übernommen sind, die Buchungen im Zeitraum
   * (±15 Tage, für Fälligkeiten, Gruppen und Gegenprobe) und was zu den Bank-Texten gelernt wurde.
   */
  .post('/import/check', validate('json', importCheckSchema), async (c) => {
    const s = scopedFrom(c);
    const { keys, labels, from, to } = c.req.valid('json');
    const known = await knownImportKeys(s, keys);
    const [txs, links] = await s.db.batch([
      s.db
        .select({
          id: transactions.id,
          date: transactions.date,
          amountCents: transactions.amountCents,
          name: transactions.name,
          kind: transactions.kind,
          accountId: transactions.accountId,
          sourceType: transactions.sourceType,
          sourceId: transactions.sourceId,
          importKey: transactions.importKey,
        })
        .from(transactions)
        .where(
          s.own(
            transactions,
            and(
              gte(transactions.date, shiftDate(from, -15)),
              lte(transactions.date, shiftDate(to, 15)),
            ),
          ),
        ),
      s.db
        .select({ transactionId: importLinks.transactionId })
        .from(importLinks)
        .innerJoin(transactions, eq(transactions.id, importLinks.transactionId))
        .where(
          s.own(
            importLinks,
            and(
              gte(transactions.date, shiftDate(from, -15)),
              lte(transactions.date, shiftDate(to, 15)),
            ),
          ),
        ),
    ]);
    const linkedIds = new Set(links.map((l) => l.transactionId));
    const existing = txs.map(({ importKey, ...t }) => ({
      ...t,
      importKey,
      linked: importKey !== null || linkedIds.has(t.id),
    }));
    return c.json({ known, existing, learned: await learnedLabels(s, labels) });
  })
  /**
   * CSV-Import, Schritt 2: bestätigte Zeilen atomar übernehmen – neue Buchungen anlegen, Zeilen mit
   * vorhandenen Buchungen verknüpfen (auch mehrere mit einer) und auf Wunsch deren Betrag an den
   * der Bank angleichen. Schon übernommene Fingerabdrücke brechen alles ab (409).
   */
  .post('/import', validate('json', importCommitSchema), async (c) => {
    const s = scopedFrom(c);
    const body = c.req.valid('json');
    await assertCardAccount(s, body.accountId);
    if (body.profile) found(await s.get(accounts, body.profile.accountId), 'account');
    const allKeys = [...body.items.map((i) => i.importKey), ...body.links.map((l) => l.importKey)];
    if (new Set(allKeys).size !== allKeys.length || (await knownImportKeys(s, allKeys)).length) {
      throw new AppError(409, 'already_imported', 'Some rows were imported already');
    }
    // Verknüpft wird nur mit eigenen Buchungen
    const targetIds = [...new Set([...body.links, ...body.adjust].map((l) => l.transactionId))];
    const own = new Set<string>();
    for (let i = 0; i < targetIds.length; i += 90) {
      const rows = await s.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(s.own(transactions, inArray(transactions.id, targetIds.slice(i, i + 90))));
      for (const r of rows) own.add(r.id);
    }
    if (own.size !== targetIds.length) {
      throw new AppError(400, 'invalid_link', 'Unknown transaction');
    }
    // Betrag nur angleichen, wo er nicht schon in Kontostand oder Restschuld steckt
    const adjust: { transactionId: string; amountCents: number }[] = [];
    for (const a of body.adjust) {
      const effects = await bookingEffectsOf(s, a.transactionId);
      const managed = effects.some(
        (b) => b.accountDeltaCents !== 0 || b.loanDeltaCents !== 0 || b.loanSavedDeltaCents !== 0,
      );
      if (!managed) adjust.push(a);
    }

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
    const linkRows = body.links.map((l) =>
      s.row(
        importLinks,
        { importKey: l.importKey, transactionId: l.transactionId, importLabel: l.importLabel },
        now,
      ),
    );
    try {
      await runBatch(s.db, [
        ...chunkedInsert(s.db, transactions, rows),
        ...chunkedInsert(s.db, importLinks, linkRows),
        // Beim Karten-Import: verknüpfte eigene Buchungen ohne Karte der Karte zuordnen
        ...(body.accountId
          ? [...new Set(body.links.map((l) => l.transactionId))].map((id) =>
              s.db
                .update(transactions)
                .set({
                  accountId: sql`case when ${transactions.kind} = 'normal' then coalesce(${transactions.accountId}, ${body.accountId}) else ${transactions.accountId} end`,
                  updatedAt: now,
                })
                .where(s.byId(transactions, id)),
            )
          : []),
        ...adjust.map((a) =>
          s.db
            .update(transactions)
            .set({ amountCents: a.amountCents, updatedAt: now })
            .where(s.byId(transactions, a.transactionId)),
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
    return c.json(
      { created: rows.length, linked: body.links.length, adjusted: adjust.length },
      201,
    );
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
      if (patch.statementMonth !== undefined) {
        const current = found(await s.get(transactions, id), 'transaction');
        // Nur Käufe mit Karte gehören zu einer Abrechnung
        if (current.kind !== 'normal' || !(patch.accountId ?? current.accountId)) {
          throw new AppError(400, 'not_a_card_purchase', 'Only card purchases have a statement');
        }
      }
      if (patch.accountId !== undefined) {
        const current = found(await s.get(transactions, id), 'transaction');
        // „Bezahlt mit“ gibt es nur bei selbst erfassten Buchungen
        if (current.kind !== 'normal' && patch.accountId !== current.accountId) {
          throw new AppError(409, 'managed_transaction', 'Account can only be set on own entries');
        }
        await assertCardAccount(s, patch.accountId);
      }
      if (patch.amountCents !== undefined) {
        const effects = await bookingEffectsOf(s, id);
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
  /** Mehrere Buchungen auf einmal löschen (atomar), sonst wie einzeln. */
  .post('/delete', validate('json', transactionDeleteManySchema), async (c) => {
    const s = scopedFrom(c);
    const { ids } = c.req.valid('json');
    const own = await s.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(s.own(transactions, inArray(transactions.id, ids)));
    if (own.length !== new Set(ids).size)
      throw new AppError(404, 'not_found', 'Unknown transaction');
    const effects = new Map<string, Awaited<ReturnType<typeof bookingEffectsOf>>[number]>();
    for (const id of ids) for (const b of await bookingEffectsOf(s, id)) effects.set(b.id, b);
    const release = await releaseBookings(s, [...effects.values()], ids);
    await runBatch(s.db, [...release, ...ids.map((id) => s.remove(transactions, id))]);
    return c.json({ deleted: own.length });
  })
  /**
   * Löschen macht Änderungen an Rücklagenkonto oder Restschuld rückgängig; der Posten ist wieder
   * offen. War die Fälligkeit in mehreren Buchungen erfasst, werden die übrigen wieder eigene
   * Buchungen (ohne Verknüpfung).
   */
  .delete('/:id', validate('param', idParam), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    found(await s.get(transactions, id), 'transaction');
    const release = await releaseBookings(s, await bookingEffectsOf(s, id), [id]);
    await runBatch(s.db, [...release, s.remove(transactions, id)]);
    return c.body(null, 204);
  });

/** Datum um Tage verschieben (für das Suchfenster ähnlicher Buchungen). */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Schon übernommene Fingerabdrücke (neu angelegt oder verknüpft). */
async function knownImportKeys(s: Scoped, keys: readonly string[]): Promise<string[]> {
  const known: string[] = [];
  // D1 erlaubt höchstens 100 Parameter je Abfrage
  for (let i = 0; i < keys.length; i += 90) {
    const chunk = keys.slice(i, i + 90);
    const [created, linked] = await s.db.batch([
      s.db
        .select({ key: transactions.importKey })
        .from(transactions)
        .where(s.own(transactions, inArray(transactions.importKey, chunk))),
      s.db
        .select({ key: importLinks.importKey })
        .from(importLinks)
        .where(s.own(importLinks, inArray(importLinks.importKey, chunk))),
    ]);
    for (const r of [...created, ...linked]) if (r.key) known.push(r.key);
  }
  return known;
}

/**
 * Gelernt: zu jedem Bank-Text Name, Kategorie und Herkunft der jüngsten Buchung, die damit angelegt
 * oder verknüpft wurde (z. B. „oldenburgische landesbank“ → „Rate OLB“, Kredit OLB).
 */
async function learnedLabels(s: Scoped, labels: readonly string[]) {
  const wanted = [...new Set(labels)];
  const found = new Map<
    string,
    {
      label: string;
      date: string;
      name: string;
      categoryId: string;
      sourceType: string | null;
      sourceId: string | null;
    }
  >();
  const columns = {
    date: transactions.date,
    name: transactions.name,
    categoryId: transactions.categoryId,
    sourceType: transactions.sourceType,
    sourceId: transactions.sourceId,
  };
  for (let i = 0; i < wanted.length; i += 90) {
    const chunk = wanted.slice(i, i + 90);
    const [created, linked] = await s.db.batch([
      s.db
        .select({ label: transactions.importLabel, ...columns })
        .from(transactions)
        .where(s.own(transactions, inArray(transactions.importLabel, chunk))),
      s.db
        .select({ label: importLinks.importLabel, ...columns })
        .from(importLinks)
        .innerJoin(transactions, eq(transactions.id, importLinks.transactionId))
        .where(s.own(importLinks, inArray(importLinks.importLabel, chunk))),
    ]);
    for (const r of [...created, ...linked]) {
      if (!r.label) continue;
      const prev = found.get(r.label);
      if (!prev || r.date > prev.date) found.set(r.label, { ...r, label: r.label });
    }
  }
  return [...found.values()].map(({ date: _date, ...rest }) => rest);
}
