/**
 * Fachliche Tabellen. Jede hat `id`, `user_id`, `created_at`, `updated_at` (Unix-ms).
 *
 * Verweise zwischen fachlichen Tabellen laufen über zusammengesetzte Fremdschlüssel
 * `(user_id, <ref>_id) → (user_id, id)`. Damit kann die Datenbank keinen Verweis auf Daten eines
 * anderen Nutzers speichern, selbst wenn die Anwendung einen Fehler macht.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import {
  type IntervalMonths,
  accountKinds,
  entitlementSources,
  entitlementStatuses,
  locales,
  plans,
  recurringKinds,
  sourceTypes,
  strategies,
  systemCategoryKeys,
  transactionKinds,
} from '@financeanchor/shared';
import { user } from './auth-schema.js';

export * from './auth-schema.js';

const base = {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
};

const inList = (column: string, values: readonly (string | number)[]) =>
  sql.raw(`${column} in (${values.map((v) => (typeof v === 'number' ? v : `'${v}'`)).join(', ')})`);

export const accounts = sqliteTable(
  'accounts',
  {
    ...base,
    name: text('name').notNull(),
    kind: text('kind', { enum: accountKinds }).notNull(),
    balanceCents: integer('balance_cents').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('accounts_user_id_id_uq').on(t.userId, t.id),
    check('accounts_kind_ck', inList('kind', accountKinds)),
  ],
);

export const reservePots = sqliteTable(
  'reserve_pots',
  {
    ...base,
    name: text('name').notNull(),
    accountId: text('account_id'),
    monthlyAmountCents: integer('monthly_amount_cents'),
    dueDay: integer('due_day').notNull().default(1),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    uniqueIndex('reserve_pots_user_id_id_uq').on(t.userId, t.id),
    uniqueIndex('reserve_pots_default_uq')
      .on(t.userId)
      .where(sql`is_default = 1`),
    foreignKey({
      name: 'reserve_pots_account_fk',
      columns: [t.userId, t.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    check('reserve_pots_due_day_ck', sql`due_day between 1 and 31`),
    check('reserve_pots_amount_ck', sql`monthly_amount_cents is null or monthly_amount_cents >= 0`),
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    ...base,
    name: text('name').notNull(),
    /** Normalisierter Name (klein, getrimmt) für die Eindeutigkeit; SQLite-`lower()` kennt keine Umlaute */
    nameKey: text('name_key').notNull(),
    systemKey: text('system_key', { enum: systemCategoryKeys }),
  },
  (t) => [
    uniqueIndex('categories_user_id_id_uq').on(t.userId, t.id),
    uniqueIndex('categories_name_uq').on(t.userId, t.nameKey),
    uniqueIndex('categories_system_uq')
      .on(t.userId, t.systemKey)
      .where(sql`system_key is not null`),
  ],
);

export const recurringItems = sqliteTable(
  'recurring_items',
  {
    ...base,
    name: text('name').notNull(),
    amountCents: integer('amount_cents').notNull(),
    intervalMonths: integer('interval_months').$type<IntervalMonths>().notNull(),
    startMonth: text('start_month').notNull(),
    dueDay: integer('due_day').notNull().default(1),
    kind: text('kind', { enum: recurringKinds }).notNull(),
    categoryId: text('category_id').notNull(),
    reservePotId: text('reserve_pot_id'),
  },
  (t) => [
    index('recurring_items_user_idx').on(t.userId),
    foreignKey({
      name: 'recurring_items_category_fk',
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    foreignKey({
      name: 'recurring_items_pot_fk',
      columns: [t.userId, t.reservePotId],
      foreignColumns: [reservePots.userId, reservePots.id],
    }),
    check('recurring_items_amount_ck', sql`amount_cents > 0`),
    check('recurring_items_interval_ck', inList('interval_months', [1, 2, 3, 6, 12])),
    check('recurring_items_due_day_ck', sql`due_day between 1 and 31`),
    check('recurring_items_kind_ck', inList('kind', recurringKinds)),
  ],
);

export const transactions = sqliteTable(
  'transactions',
  {
    ...base,
    date: text('date').notNull(),
    name: text('name').notNull(),
    categoryId: text('category_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    kind: text('kind', { enum: transactionKinds }).notNull().default('normal'),
    sourceType: text('source_type', { enum: sourceTypes }),
    sourceId: text('source_id'),
  },
  (t) => [
    uniqueIndex('transactions_user_id_id_uq').on(t.userId, t.id),
    index('transactions_user_date_idx').on(t.userId, t.date),
    foreignKey({
      name: 'transactions_category_fk',
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    check('transactions_amount_ck', sql`amount_cents <> 0`),
    check('transactions_kind_ck', inList('kind', transactionKinds)),
  ],
);

/**
 * Welche Fälligkeit in welchem Monat schon gebucht wurde. Der Unique-Index macht „Fällige
 * übernehmen“ idempotent. Die gespeicherten Änderungen an Konto und Kredit erlauben es, sie beim
 * Löschen der Buchung rückgängig zu machen.
 */
export const bookedItems = sqliteTable(
  'booked_items',
  {
    ...base,
    month: text('month').notNull(),
    bookingKey: text('booking_key').notNull(),
    transactionId: text('transaction_id').notNull(),
    accountId: text('account_id'),
    accountDeltaCents: integer('account_delta_cents').notNull().default(0),
    loanId: text('loan_id'),
    loanDeltaCents: integer('loan_delta_cents').notNull().default(0),
  },
  (t) => [
    uniqueIndex('booked_items_key_uq').on(t.userId, t.bookingKey, t.month),
    index('booked_items_transaction_idx').on(t.userId, t.transactionId),
    foreignKey({
      name: 'booked_items_transaction_fk',
      columns: [t.userId, t.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
  ],
);

export const loans = sqliteTable(
  'loans',
  {
    ...base,
    name: text('name').notNull(),
    balanceCents: integer('balance_cents').notNull(),
    originalCents: integer('original_cents').notNull(),
    rateBp: integer('rate_bp').notNull(),
    paymentCents: integer('payment_cents').notNull(),
    dueDay: integer('due_day').notNull().default(1),
  },
  (t) => [
    index('loans_user_idx').on(t.userId),
    check('loans_balance_ck', sql`balance_cents >= 0 and original_cents >= 0`),
    check('loans_rate_ck', sql`rate_bp between 0 and 10000`),
    check('loans_payment_ck', sql`payment_cents > 0`),
    check('loans_due_day_ck', sql`due_day between 1 and 31`),
  ],
);

export const netWorthSnapshots = sqliteTable(
  'net_worth_snapshots',
  {
    ...base,
    date: text('date').notNull(),
    assetsCents: integer('assets_cents').notNull(),
    debtCents: integer('debt_cents').notNull(),
    netCents: integer('net_cents').notNull(),
  },
  (t) => [uniqueIndex('net_worth_snapshots_date_uq').on(t.userId, t.date)],
);

export const userSettings = sqliteTable(
  'user_settings',
  {
    ...base,
    extraPaymentCents: integer('extra_payment_cents').notNull().default(0),
    strategy: text('strategy', { enum: strategies }).notNull().default('avalanche'),
    locale: text('locale', { enum: locales }).notNull().default('de'),
    currency: text('currency').notNull().default('EUR'),
  },
  (t) => [
    uniqueIndex('user_settings_user_uq').on(t.userId),
    check('user_settings_extra_ck', sql`extra_payment_cents >= 0`),
  ],
);

export const entitlements = sqliteTable(
  'entitlements',
  {
    ...base,
    plan: text('plan', { enum: plans }).notNull(),
    status: text('status', { enum: entitlementStatuses }).notNull(),
    trialEndsAt: integer('trial_ends_at'),
    currentPeriodEnd: integer('current_period_end'),
    /** JSON-Array freigeschalteter Funktionen, `["*"]` = alle */
    features: text('features', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    source: text('source', { enum: entitlementSources }).notNull().default('manual'),
    externalRef: text('external_ref'),
  },
  (t) => [uniqueIndex('entitlements_user_uq').on(t.userId)],
);
