-- D1: Fremdschlüssel erst am Ende der Migration prüfen (statt foreign_keys=OFF)
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_loans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'installment' NOT NULL,
	`balance_cents` integer NOT NULL,
	`original_cents` integer NOT NULL,
	`rate_bp` integer NOT NULL,
	`payment_cents` integer,
	`due_day` integer DEFAULT 1 NOT NULL,
	`target_month` text,
	`due_date` text,
	`payment_mode` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "loans_balance_ck" CHECK(balance_cents >= 0 and original_cents >= 0),
	CONSTRAINT "loans_rate_ck" CHECK(rate_bp between 0 and 10000),
	CONSTRAINT "loans_payment_ck" CHECK(payment_cents is null or payment_cents > 0),
	CONSTRAINT "loans_due_day_ck" CHECK(due_day between 1 and 31),
	CONSTRAINT "loans_kind_ck" CHECK(kind in ('installment', 'deadline')),
	CONSTRAINT "loans_shape_ck" CHECK((kind = 'installment' and payment_cents is not null and due_date is null and payment_mode is null)
        or (kind = 'deadline' and payment_cents is null and target_month is null and due_date is not null
            and payment_mode in ('spread', 'lump')))
);
--> statement-breakpoint
-- Bestehende Kredite sind Ratenkredite (kind hat den Standardwert 'installment').
INSERT INTO `__new_loans`("id", "user_id", "created_at", "updated_at", "name", "balance_cents", "original_cents", "rate_bp", "payment_cents", "due_day") SELECT "id", "user_id", "created_at", "updated_at", "name", "balance_cents", "original_cents", "rate_bp", "payment_cents", "due_day" FROM `loans`;--> statement-breakpoint
DROP TABLE `loans`;--> statement-breakpoint
ALTER TABLE `__new_loans` RENAME TO `loans`;--> statement-breakpoint
CREATE INDEX `loans_user_idx` ON `loans` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`extra_payment_cents` integer DEFAULT 0 NOT NULL,
	`loan_budget_cents` integer,
	`strategy` text DEFAULT 'avalanche' NOT NULL,
	`locale` text DEFAULT 'de' NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_settings_extra_ck" CHECK(extra_payment_cents >= 0),
	CONSTRAINT "user_settings_budget_ck" CHECK(loan_budget_cents is null or loan_budget_cents >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_user_settings`("id", "user_id", "created_at", "updated_at", "extra_payment_cents", "strategy", "locale", "currency") SELECT "id", "user_id", "created_at", "updated_at", "extra_payment_cents", "strategy", "locale", "currency" FROM `user_settings`;--> statement-breakpoint
DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_uq` ON `user_settings` (`user_id`);--> statement-breakpoint
-- Budget statt Extra-Tilgung: wo es eine Extra-Tilgung gab, Budget = Raten offener Kredite + Extra
UPDATE `user_settings` SET `loan_budget_cents` = `extra_payment_cents` + COALESCE((SELECT SUM(`payment_cents`) FROM `loans` WHERE `loans`.`user_id` = `user_settings`.`user_id` AND `loans`.`balance_cents` > 0), 0) WHERE `extra_payment_cents` > 0;
