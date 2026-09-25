CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "accounts_kind_ck" CHECK(kind in ('checking', 'savings', 'depot', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_id_id_uq` ON `accounts` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `booked_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`month` text NOT NULL,
	`booking_key` text NOT NULL,
	`transaction_id` text NOT NULL,
	`account_id` text,
	`account_delta_cents` integer DEFAULT 0 NOT NULL,
	`loan_id` text,
	`loan_delta_cents` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`transaction_id`) REFERENCES `transactions`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booked_items_key_uq` ON `booked_items` (`user_id`,`booking_key`,`month`);--> statement-breakpoint
CREATE INDEX `booked_items_transaction_idx` ON `booked_items` (`user_id`,`transaction_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`system_key` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_id_id_uq` ON `categories` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_uq` ON `categories` (`user_id`,`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_system_uq` ON `categories` (`user_id`,`system_key`) WHERE system_key is not null;--> statement-breakpoint
CREATE TABLE `entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`plan` text NOT NULL,
	`status` text NOT NULL,
	`trial_ends_at` integer,
	`current_period_end` integer,
	`features` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`external_ref` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entitlements_user_uq` ON `entitlements` (`user_id`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`original_cents` integer NOT NULL,
	`rate_bp` integer NOT NULL,
	`payment_cents` integer NOT NULL,
	`due_day` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "loans_balance_ck" CHECK(balance_cents >= 0 and original_cents >= 0),
	CONSTRAINT "loans_rate_ck" CHECK(rate_bp between 0 and 10000),
	CONSTRAINT "loans_payment_ck" CHECK(payment_cents > 0),
	CONSTRAINT "loans_due_day_ck" CHECK(due_day between 1 and 31)
);
--> statement-breakpoint
CREATE INDEX `loans_user_idx` ON `loans` (`user_id`);--> statement-breakpoint
CREATE TABLE `net_worth_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`date` text NOT NULL,
	`assets_cents` integer NOT NULL,
	`debt_cents` integer NOT NULL,
	`net_cents` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `net_worth_snapshots_date_uq` ON `net_worth_snapshots` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `recurring_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`interval_months` integer NOT NULL,
	`start_month` text NOT NULL,
	`due_day` integer DEFAULT 1 NOT NULL,
	`kind` text NOT NULL,
	`category_id` text NOT NULL,
	`reserve_pot_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`category_id`) REFERENCES `categories`(`user_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`,`reserve_pot_id`) REFERENCES `reserve_pots`(`user_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurring_items_amount_ck" CHECK(amount_cents > 0),
	CONSTRAINT "recurring_items_interval_ck" CHECK(interval_months in (1, 2, 3, 6, 12)),
	CONSTRAINT "recurring_items_due_day_ck" CHECK(due_day between 1 and 31),
	CONSTRAINT "recurring_items_kind_ck" CHECK(kind in ('fixed', 'saving', 'income'))
);
--> statement-breakpoint
CREATE INDEX `recurring_items_user_idx` ON `recurring_items` (`user_id`);--> statement-breakpoint
CREATE TABLE `reserve_pots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`account_id` text,
	`monthly_amount_cents` integer,
	`due_day` integer DEFAULT 1 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reserve_pots_due_day_ck" CHECK(due_day between 1 and 31),
	CONSTRAINT "reserve_pots_amount_ck" CHECK(monthly_amount_cents is null or monthly_amount_cents >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reserve_pots_user_id_id_uq` ON `reserve_pots` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reserve_pots_default_uq` ON `reserve_pots` (`user_id`) WHERE is_default = 1;--> statement-breakpoint
CREATE TABLE `transactions` (
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`category_id`) REFERENCES `categories`(`user_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_amount_ck" CHECK(amount_cents <> 0),
	CONSTRAINT "transactions_kind_ck" CHECK(kind in ('normal', 'reserve', 'transfer', 'loan_payment'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_user_id_id_uq` ON `transactions` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `transactions_user_date_idx` ON `transactions` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`extra_payment_cents` integer DEFAULT 0 NOT NULL,
	`strategy` text DEFAULT 'avalanche' NOT NULL,
	`locale` text DEFAULT 'de' NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_settings_extra_ck" CHECK(extra_payment_cents >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_uq` ON `user_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);