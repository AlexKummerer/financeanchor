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
