import {
  loanCreateSchema,
  loanShapeIssues,
  loanUpdateSchema,
  type LoanCreate,
} from '@financeanchor/shared';
import { asc } from 'drizzle-orm';
import { Hono } from 'hono';
import { loans } from '../db/schema.js';
import { AppError } from '../errors.js';
import { strip } from '../mappers.js';
import type { AppEnv } from '../middleware/context.js';
import { validate } from '../validation.js';
import { found, idParam, one, scopedFrom } from './util.js';

export const loanRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const s = scopedFrom(c);
    const rows = await s.db.select().from(loans).where(s.own(loans)).orderBy(asc(loans.createdAt));
    return c.json(rows.map(strip));
  })
  .post('/', validate('json', loanCreateSchema), async (c) => {
    const row = one(await scopedFrom(c).insert(loans, toRow(c.req.valid('json'))), 'loan');
    return c.json(strip(row), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', loanUpdateSchema), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    const current = found(await s.get(loans, id), 'loan');
    const next = { ...current, ...(definedOnly(c.req.valid('json')) as Partial<typeof current>) };
    // Beim Wechsel der Art gehören die Felder der anderen Art nicht mehr dazu.
    if (next.kind === 'deadline') {
      next.paymentCents = null;
      next.targetMonth = null;
      if (next.dueDate) next.dueDay = Number(next.dueDate.slice(8, 10));
    } else {
      next.dueDate = null;
      next.paymentMode = null;
    }
    // Zurückgelegtes gibt es nur bei Einmalzahlungen, Extra-Tilgung nur ohne Einmalzahlung
    if (next.paymentMode !== 'lump') next.savedCents = 0;
    else {
      next.extraMonthlyCents = 0;
      next.extraFromMonth = null;
    }
    const issues = loanShapeIssues(next);
    if (issues.length) throw new AppError(400, 'validation_failed', 'Invalid loan', issues);
    const { id: _id, userId: _u, createdAt: _c, updatedAt: _up, ...values } = next;
    const row = one(await s.update(loans, id, values), 'loan');
    return c.json(strip(row));
  })
  .delete('/:id', validate('param', idParam), async (c) => {
    const s = scopedFrom(c);
    const { id } = c.req.valid('param');
    found(await s.get(loans, id), 'loan');
    await s.remove(loans, id);
    return c.body(null, 204);
  });

/** Neuer Kredit → Zeile; bei Fristen ist der Buchungstag der Tag der Frist. */
function toRow(body: LoanCreate) {
  const common = {
    id: body.id,
    name: body.name,
    kind: body.kind,
    balanceCents: body.balanceCents,
    originalCents: body.originalCents ?? body.balanceCents,
    rateBp: body.rateBp,
  };
  if (body.kind === 'installment') {
    return {
      ...common,
      paymentCents: body.paymentCents,
      dueDay: body.dueDay,
      targetMonth: body.targetMonth,
      dueDate: null,
      paymentMode: null,
      extraMonthlyCents: body.extraMonthlyCents,
      extraFromMonth: body.extraFromMonth,
    };
  }
  return {
    ...common,
    paymentCents: null,
    dueDay: Number(body.dueDate.slice(8, 10)),
    targetMonth: null,
    dueDate: body.dueDate,
    paymentMode: body.paymentMode,
    savedCents: body.paymentMode === 'lump' ? body.savedCents : 0,
    extraMonthlyCents: body.paymentMode === 'lump' ? 0 : body.extraMonthlyCents,
    extraFromMonth: body.paymentMode === 'lump' ? null : body.extraFromMonth,
  };
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
