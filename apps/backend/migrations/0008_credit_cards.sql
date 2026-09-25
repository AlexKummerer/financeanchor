PRAGMA defer_foreign_keys = on;--> statement-breakpoint
-- booked_items hängt mit ON DELETE CASCADE an transactions: vor dem Neuaufbau sichern
CREATE TABLE `__booked_items_backup` AS SELECT * FROM `booked_items`;--> statement-breakpoint
-- Verweise der Rücklagentöpfe auf Konten kurz lösen, sonst zählt SQLite sie beim Löschen der
-- alten Tabelle als Verstoß (das Umbenennen danach behebt ihn nicht mehr)
CREATE TABLE `__pot_accounts_backup` AS SELECT `id`, `account_id` FROM `reserve_pots` WHERE `account_id` IS NOT NULL;--> statement-breakpoint
UPDATE `reserve_pots` SET `account_id` = NULL WHERE `account_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`statement_day` integer,
	`debit_day` integer,
	`debit_account_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`debit_account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_kind_ck" CHECK(kind in ('checking', 'savings', 'depot', 'other', 'credit_card')),
	CONSTRAINT "accounts_card_days_ck" CHECK((statement_day is null or statement_day between 1 and 31) and (debit_day is null or debit_day between 1 and 31))
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("id", "user_id", "created_at", "updated_at", "name", "kind", "balance_cents", "sort_order", "statement_day", "debit_day", "debit_account_id") SELECT "id", "user_id", "created_at", "updated_at", "name", "kind", "balance_cents", "sort_order", NULL, NULL, NULL FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_id_id_uq` ON `accounts` (`user_id`,`id`);--> statement-breakpoint
UPDATE `reserve_pots` SET `account_id` = (SELECT b.`account_id` FROM `__pot_accounts_backup` b WHERE b.`id` = `reserve_pots`.`id`) WHERE `id` IN (SELECT `id` FROM `__pot_accounts_backup`);--> statement-breakpoint
DROP TABLE `__pot_accounts_backup`;--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`category_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`kind` text DEFAULT 'normal' NOT NULL,
	`source_type` text,
	`source_id` text,
	`account_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`,`category_id`) REFERENCES `categories`(`user_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_amount_ck" CHECK(amount_cents <> 0),
	CONSTRAINT "transactions_kind_ck" CHECK(kind in ('normal', 'reserve', 'transfer', 'loan_payment', 'card_payment'))
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("id", "user_id", "created_at", "updated_at", "date", "name", "category_id", "amount_cents", "kind", "source_type", "source_id", "account_id") SELECT "id", "user_id", "created_at", "updated_at", "date", "name", "category_id", "amount_cents", "kind", "source_type", "source_id", NULL FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_user_id_id_uq` ON `transactions` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `transactions_user_account_idx` ON `transactions` (`user_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `transactions_user_date_idx` ON `transactions` (`user_id`,`date`);--> statement-breakpoint
DELETE FROM `booked_items`;--> statement-breakpoint
INSERT INTO `booked_items` SELECT * FROM `__booked_items_backup`;--> statement-breakpoint
DROP TABLE `__booked_items_backup`;
