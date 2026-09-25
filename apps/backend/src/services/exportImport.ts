import {
  categoryNameKey,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  newId,
  systemCategoryKeys,
  type ExportFile,
} from '@financeanchor/shared';
import { eq } from 'drizzle-orm';
import { chunkedInsert, runBatch } from '../db/client.js';
import {
  accounts,
  bookedItems,
  categories,
  loans,
  netWorthSnapshots,
  recurringItems,
  reservePots,
  transactions,
  userSettings,
} from '../db/schema.js';
import type { Scoped } from '../db/scoped.js';
import { AppError } from '../errors.js';
import { categoryToApi, strip } from '../mappers.js';

export async function exportUserData(s: Scoped, now = new Date()): Promise<ExportFile> {
  const { db } = s;
  const [settings, accs, pots, cats, items, txs, booked, ls, snaps] = await db.batch([
    db.select().from(userSettings).where(eq(userSettings.userId, s.userId)),
    db.select().from(accounts).where(s.own(accounts)),
    db.select().from(reservePots).where(s.own(reservePots)),
    db.select().from(categories).where(s.own(categories)),
    db.select().from(recurringItems).where(s.own(recurringItems)),
    db.select().from(transactions).where(s.own(transactions)),
    db.select().from(bookedItems).where(s.own(bookedItems)),
    db.select().from(loans).where(s.own(loans)),
    db.select().from(netWorthSnapshots).where(s.own(netWorthSnapshots)),
  ]);
  const st = settings[0];
  if (!st) throw new AppError(500, 'user_not_initialized', 'User data is incomplete');
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    data: {
      settings: {
        loanBudgetCents: st.loanBudgetCents,
        strategy: st.strategy,
        locale: st.locale,
        currency: st.currency as 'EUR',
      },
      accounts: accs.map(strip),
      reservePots: pots.map(strip),
      categories: cats.map(categoryToApi),
      recurringItems: items.map(strip),
      transactions: txs.map(strip),
      bookedItems: booked.map(strip),
      loans: ls.map(strip),
      snapshots: snaps.map(strip),
    },
  };
}

class ImportProblems {
  readonly list: string[] = [];
  add(msg: string) {
    if (this.list.length < 50) this.list.push(msg);
  }
}

/** Prüft die Verweise innerhalb der Datei und vergibt alle IDs neu. */
export function remapImport(file: ExportFile, userId: string, now = Date.now()) {
  const d = file.data;
  const problems = new ImportProblems();
  const maps = {
    account: new Map(d.accounts.map((x) => [x.id, newId(now)])),
    pot: new Map(d.reservePots.map((x) => [x.id, newId(now)])),
    category: new Map(d.categories.map((x) => [x.id, newId(now)])),
    item: new Map(d.recurringItems.map((x) => [x.id, newId(now)])),
    transaction: new Map(d.transactions.map((x) => [x.id, newId(now)])),
    loan: new Map(d.loans.map((x) => [x.id, newId(now)])),
  };
  const ref = (map: Map<string, string>, id: string, what: string) => {
    const v = map.get(id);
    if (!v) problems.add(`${what}: unbekannter Verweis ${id}`);
    return v ?? id;
  };
  const optRef = (map: Map<string, string>, id: string | null, what: string) =>
    id === null ? null : ref(map, id, what);
  const meta = { userId, createdAt: now, updatedAt: now };

  const defaults = d.reservePots.filter((p) => p.isDefault).length;
  if (defaults !== 1)
    problems.add(`Genau ein Standard-Rücklagentopf erwartet, gefunden: ${defaults}`);
  for (const key of systemCategoryKeys) {
    const n = d.categories.filter((c) => c.systemKey === key).length;
    if (n !== 1) problems.add(`Systemkategorie ${key}: ${n}× vorhanden`);
  }
  const names = new Set<string>();
  for (const c of d.categories) {
    const k = categoryNameKey(c.name);
    if (names.has(k)) problems.add(`Kategorie doppelt: ${c.name}`);
    names.add(k);
  }
  for (const [label, rows] of Object.entries({
    accounts: d.accounts,
    reservePots: d.reservePots,
    categories: d.categories,
    recurringItems: d.recurringItems,
    transactions: d.transactions,
    loans: d.loans,
  })) {
    if (new Set(rows.map((r) => r.id)).size !== rows.length) problems.add(`${label}: doppelte IDs`);
  }

  const sourceMap = { recurring_item: maps.item, loan: maps.loan, reserve_pot: maps.pot } as const;
  const keyMap: Record<string, Map<string, string>> = {
    reserve: maps.pot,
    item: maps.item,
    transfer: maps.item,
    loan: maps.loan,
    extra: maps.loan,
    save: maps.loan,
  };

  const rows = {
    accounts: d.accounts.map((a) => ({ ...a, ...meta, id: ref(maps.account, a.id, 'Konto') })),
    reservePots: d.reservePots.map((p) => ({
      ...p,
      ...meta,
      id: ref(maps.pot, p.id, 'Topf'),
      accountId: optRef(maps.account, p.accountId, 'Topf → Konto'),
    })),
    categories: d.categories.map((c) => ({
      ...c,
      ...meta,
      id: ref(maps.category, c.id, 'Kategorie'),
      nameKey: categoryNameKey(c.name),
    })),
    recurringItems: d.recurringItems.map((i) => ({
      ...i,
      ...meta,
      id: ref(maps.item, i.id, 'Posten'),
      categoryId: ref(maps.category, i.categoryId, 'Posten → Kategorie'),
      reservePotId: optRef(maps.pot, i.reservePotId, 'Posten → Topf'),
    })),
    transactions: d.transactions.map((t) => ({
      ...t,
      ...meta,
      id: ref(maps.transaction, t.id, 'Buchung'),
      categoryId: ref(maps.category, t.categoryId, 'Buchung → Kategorie'),
      // Herkunft darf gelöscht sein; dann bleibt der Verweis leer.
      sourceId:
        t.sourceType && t.sourceId ? (sourceMap[t.sourceType].get(t.sourceId) ?? null) : null,
    })),
    bookedItems: d.bookedItems.flatMap((b) => {
      const [prefix, oldId] = b.bookingKey.split(':') as [string, string | undefined];
      const mapped = oldId ? keyMap[prefix]?.get(oldId) : undefined;
      const transactionId = maps.transaction.get(b.transactionId);
      if (!mapped || !transactionId) return []; // Herkunft oder Buchung fehlt: Markierung entfällt
      return [
        {
          ...b,
          ...meta,
          id: newId(now),
          bookingKey: `${prefix}:${mapped}`,
          transactionId,
          accountId: b.accountId ? (maps.account.get(b.accountId) ?? null) : null,
          loanId: b.loanId ? (maps.loan.get(b.loanId) ?? null) : null,
        },
      ];
    }),
    loans: d.loans.map((l) => ({ ...l, ...meta, id: ref(maps.loan, l.id, 'Kredit') })),
    snapshots: d.snapshots.map((x) => ({ ...x, ...meta, id: newId(now) })),
  };
  if (new Set(d.snapshots.map((x) => x.date)).size !== d.snapshots.length) {
    problems.add('Vermögensstände: mehrere am selben Tag');
  }
  return { rows, problems: problems.list };
}

/** Ersetzt alle Daten des Nutzers atomar durch die Sicherung. Freigaben bleiben unverändert. */
export async function importUserData(s: Scoped, file: ExportFile) {
  const { rows, problems } = remapImport(file, s.userId);
  if (problems.length) {
    throw new AppError(400, 'import_invalid', 'Backup is inconsistent', problems);
  }
  const { db } = s;
  const now = Date.now();
  await runBatch(db, [
    db.delete(bookedItems).where(s.own(bookedItems)),
    db.delete(transactions).where(s.own(transactions)),
    db.delete(recurringItems).where(s.own(recurringItems)),
    db.delete(reservePots).where(s.own(reservePots)),
    db.delete(categories).where(s.own(categories)),
    db.delete(accounts).where(s.own(accounts)),
    db.delete(loans).where(s.own(loans)),
    db.delete(netWorthSnapshots).where(s.own(netWorthSnapshots)),
    db
      .update(userSettings)
      .set({ ...file.data.settings, updatedAt: now })
      .where(eq(userSettings.userId, s.userId)),
    ...chunkedInsert(db, accounts, rows.accounts),
    ...chunkedInsert(db, reservePots, rows.reservePots),
    ...chunkedInsert(db, categories, rows.categories),
    ...chunkedInsert(db, recurringItems, rows.recurringItems),
    ...chunkedInsert(db, transactions, rows.transactions),
    ...chunkedInsert(db, bookedItems, rows.bookedItems),
    ...chunkedInsert(db, loans, rows.loans),
    ...chunkedInsert(db, netWorthSnapshots, rows.snapshots),
  ]);
  return {
    accounts: rows.accounts.length,
    categories: rows.categories.length,
    recurringItems: rows.recurringItems.length,
    transactions: rows.transactions.length,
    loans: rows.loans.length,
    snapshots: rows.snapshots.length,
  };
}
