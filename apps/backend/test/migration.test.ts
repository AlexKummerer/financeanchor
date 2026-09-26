import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

/**
 * Prüft die Datenumrechnung der Migration 0001 an einer eigenen D1 im Stand von 0000:
 * bestehende Kredite werden Ratenkredite, die Extra-Tilgung wird zum Budget.
 */
describe('Migration Kreditarten und Budget', () => {
  it('rechnet bestehende Daten um', async () => {
    const [init, ...rest] = env.TEST_MIGRATIONS;
    const db = env.DB_MIGRATION;
    await applyD1Migrations(db, [init!], 'm_test');
    const now = 0;
    await db.batch([
      db.prepare(
        "insert into user (id, name, email, email_verified, created_at, updated_at) values ('u1', 'U', 'u1@x.de', 0, 0, 0)",
      ),
      db.prepare(
        "insert into user (id, name, email, email_verified, created_at, updated_at) values ('u2', 'U', 'u2@x.de', 0, 0, 0)",
      ),
      db.prepare(
        `insert into user_settings (id, user_id, created_at, updated_at, extra_payment_cents) values ('s1', 'u1', ${now}, ${now}, 10000)`,
      ),
      db.prepare(
        `insert into user_settings (id, user_id, created_at, updated_at, extra_payment_cents) values ('s2', 'u2', ${now}, ${now}, 0)`,
      ),
      db.prepare(
        `insert into loans (id, user_id, created_at, updated_at, name, balance_cents, original_cents, rate_bp, payment_cents, due_day) values ('l1', 'u1', 0, 0, 'Auto', 840000, 1400000, 590, 26000, 15)`,
      ),
      db.prepare(
        `insert into loans (id, user_id, created_at, updated_at, name, balance_cents, original_cents, rate_bp, payment_cents, due_day) values ('l2', 'u1', 0, 0, 'Alt', 0, 50000, 0, 5000, 1)`,
      ),
    ]);
    await applyD1Migrations(db, rest, 'm_test');

    const loan = await db
      .prepare("select kind, payment_cents, due_date from loans where id = 'l1'")
      .first();
    expect(loan).toEqual({ kind: 'installment', payment_cents: 26000, due_date: null });
    const budgets = await db
      .prepare('select user_id, loan_budget_cents from user_settings order by user_id')
      .all();
    // u1: 260 € Rate des offenen Kredits + 100 € Extra; u2 ohne Extra: kein Budget
    expect(budgets.results).toEqual([
      { user_id: 'u1', loan_budget_cents: 36000 },
      { user_id: 'u2', loan_budget_cents: null },
    ]);
    const cols = await db
      .prepare("select name from pragma_table_info('user_settings')")
      .all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).not.toContain('extra_payment_cents');
  });
});

/**
 * Migration 0008 baut `accounts` und `transactions` neu auf. Gebuchte Fälligkeiten hängen mit
 * ON DELETE CASCADE an den Buchungen und dürfen dabei nicht verloren gehen.
 */
describe('Migration Kreditkarten', () => {
  it('behält Konten, Buchungen, Rücklagentöpfe und gebuchte Fälligkeiten', async () => {
    const idx = env.TEST_MIGRATIONS.findIndex((m) => m.name.startsWith('0008'));
    const before = env.TEST_MIGRATIONS.slice(0, idx);
    const db = env.DB_MIGRATION_CARDS;
    await applyD1Migrations(db, before, 'm_cards');
    await db.batch([
      db.prepare(
        "insert into user (id, name, email, email_verified, created_at, updated_at) values ('u1', 'U', 'u1@x.de', 0, 0, 0)",
      ),
      db.prepare(
        "insert into categories (id, user_id, created_at, updated_at, name, name_key) values ('c1', 'u1', 0, 0, 'Wohnen', 'wohnen')",
      ),
      db.prepare(
        "insert into accounts (id, user_id, created_at, updated_at, name, kind, balance_cents) values ('a1', 'u1', 0, 0, 'Giro', 'checking', 123400)",
      ),
      db.prepare(
        "insert into reserve_pots (id, user_id, created_at, updated_at, name, account_id, is_default) values ('p1', 'u1', 0, 0, 'Rücklage', 'a1', 1)",
      ),
      db.prepare(
        "insert into transactions (id, user_id, created_at, updated_at, date, name, category_id, amount_cents, kind, source_type, source_id) values ('t1', 'u1', 0, 0, '2026-09-01', 'Miete', 'c1', -85000, 'normal', 'recurring_item', 'r1')",
      ),
      db.prepare(
        "insert into booked_items (id, user_id, created_at, updated_at, month, booking_key, transaction_id, account_id, account_delta_cents) values ('b1', 'u1', 0, 0, '2026-09', 'item:r1', 't1', 'a1', 0)",
      ),
      db.prepare(
        "insert into recurring_items (id, user_id, created_at, updated_at, name, amount_cents, interval_months, start_month, kind, category_id) values ('r1', 'u1', 0, 0, 'Disney+', 899, 1, '2026-01', 'fixed', 'c1')",
      ),
    ]);
    await applyD1Migrations(db, env.TEST_MIGRATIONS.slice(idx), 'm_cards');

    expect(
      await db.prepare('select id, kind, balance_cents, statement_day from accounts').all(),
    ).toMatchObject({
      results: [{ id: 'a1', kind: 'checking', balance_cents: 123400, statement_day: null }],
    });
    expect(await db.prepare('select id, account_id from transactions').all()).toMatchObject({
      results: [{ id: 't1', account_id: null }],
    });
    expect(
      await db.prepare('select id, booking_key, transaction_id from booked_items').all(),
    ).toMatchObject({
      results: [{ id: 'b1', booking_key: 'item:r1', transaction_id: 't1' }],
    });
    // Migration 0010 baut recurring_items neu auf: Posten bleibt, „Bezahlt mit“ ist leer
    expect(await db.prepare('select id, name, account_id from recurring_items').first()).toEqual({
      id: 'r1',
      name: 'Disney+',
      account_id: null,
    });
    expect(await db.prepare('select account_id from reserve_pots').first()).toEqual({
      account_id: 'a1',
    });
    expect(
      await db
        .prepare("select count(*) as n from sqlite_master where name = '__booked_items_backup'")
        .first(),
    ).toEqual({ n: 0 });
    // Neue Art ist erlaubt, Buchung mit Kreditkarte ebenfalls
    await db.batch([
      db.prepare(
        "insert into accounts (id, user_id, created_at, updated_at, name, kind, balance_cents, statement_day, debit_day, debit_account_id) values ('k1', 'u1', 0, 0, 'Amex', 'credit_card', 0, 31, 4, 'a1')",
      ),
      db.prepare(
        "insert into transactions (id, user_id, created_at, updated_at, date, name, category_id, amount_cents, account_id) values ('t2', 'u1', 0, 0, '2026-09-02', 'Essen', 'c1', -4550, 'k1')",
      ),
    ]);
  });
});
