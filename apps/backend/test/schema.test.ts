import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const now = Date.now();

async function createUser(id: string) {
  await env.DB.prepare(
    'insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 0, ?, ?)',
  )
    .bind(id, id, `${id}@example.com`, now, now)
    .run();
}

async function createCategory(id: string, userId: string, name: string) {
  await env.DB.prepare(
    'insert into categories (id, user_id, name, name_key, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, userId, name, name.toLowerCase(), now, now)
    .run();
}

function insertTransaction(id: string, userId: string, categoryId: string, amount = -100) {
  return env.DB.prepare(
    "insert into transactions (id, user_id, date, name, category_id, amount_cents, created_at, updated_at) values (?, ?, '2026-09-01', 'Test', ?, ?, ?, ?)",
  )
    .bind(id, userId, categoryId, amount, now, now)
    .run();
}

describe('Worker', () => {
  it('antwortet auf /api/health', async () => {
    const res = await exports.default.fetch('http://localhost/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('Datenbankschema', () => {
  it('verhindert Verweise auf Kategorien eines anderen Nutzers', async () => {
    await createUser('alice');
    await createUser('bob');
    await createCategory('cat-bob', 'bob', 'Lebensmittel');
    await expect(insertTransaction('tx-1', 'alice', 'cat-bob')).rejects.toThrow(/FOREIGN KEY/);
    await createCategory('cat-alice', 'alice', 'Lebensmittel');
    await expect(insertTransaction('tx-2', 'alice', 'cat-alice')).resolves.toBeTruthy();
  });

  it('Kategorienamen sind je Nutzer eindeutig', async () => {
    await createUser('carol');
    await createCategory('c1', 'carol', 'Urlaub');
    await expect(createCategory('c2', 'carol', 'Urlaub')).rejects.toThrow(/UNIQUE/);
  });

  it('prüft Beträge und Rhythmen per CHECK', async () => {
    await createUser('dave');
    await createCategory('c-dave', 'dave', 'X');
    await expect(insertTransaction('tx-0', 'dave', 'c-dave', 0)).rejects.toThrow(/CHECK/);
    await expect(
      env.DB.prepare(
        "insert into recurring_items (id, user_id, name, amount_cents, interval_months, start_month, kind, category_id, created_at, updated_at) values ('r', 'dave', 'X', 100, 4, '2026-01', 'fixed', 'c-dave', 0, 0)",
      ).run(),
    ).rejects.toThrow(/CHECK/);
  });

  it('eine Fälligkeit je Nutzer, Schlüssel und Monat', async () => {
    await createUser('erin');
    await createCategory('c-erin', 'erin', 'X');
    await insertTransaction('tx-e1', 'erin', 'c-erin');
    await insertTransaction('tx-e2', 'erin', 'c-erin');
    const book = (id: string, tx: string) =>
      env.DB.prepare(
        "insert into booked_items (id, user_id, month, booking_key, transaction_id, created_at, updated_at) values (?, 'erin', '2026-09', 'item:x', ?, 0, 0)",
      )
        .bind(id, tx)
        .run();
    await book('b1', 'tx-e1');
    await expect(book('b2', 'tx-e2')).rejects.toThrow(/UNIQUE/);
  });

  it('Löschen einer Buchung entfernt ihre Fälligkeitsmarkierung', async () => {
    await createUser('frank');
    await createCategory('c-frank', 'frank', 'X');
    await insertTransaction('tx-f', 'frank', 'c-frank');
    await env.DB.prepare(
      "insert into booked_items (id, user_id, month, booking_key, transaction_id, created_at, updated_at) values ('bf', 'frank', '2026-09', 'item:y', 'tx-f', 0, 0)",
    ).run();
    await env.DB.prepare("delete from transactions where id = 'tx-f'").run();
    const row = await env.DB.prepare(
      "select count(*) as n from booked_items where id = 'bf'",
    ).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
