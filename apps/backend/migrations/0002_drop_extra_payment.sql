PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`loan_budget_cents` integer,
	`strategy` text DEFAULT 'avalanche' NOT NULL,
	`locale` text DEFAULT 'de' NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_settings_budget_ck" CHECK(loan_budget_cents is null or loan_budget_cents >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_user_settings`("id", "user_id", "created_at", "updated_at", "loan_budget_cents", "strategy", "locale", "currency") SELECT "id", "user_id", "created_at", "updated_at", "loan_budget_cents", "strategy", "locale", "currency" FROM `user_settings`;--> statement-breakpoint
DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_uq` ON `user_settings` (`user_id`);