PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_recurring_items` (
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
	CONSTRAINT "recurring_items_interval_ck" CHECK(interval_months in (1, 2, 3, 4, 6, 12)),
	CONSTRAINT "recurring_items_due_day_ck" CHECK(due_day between 1 and 31),
	CONSTRAINT "recurring_items_kind_ck" CHECK(kind in ('fixed', 'saving', 'income'))
);
--> statement-breakpoint
INSERT INTO `__new_recurring_items`("id", "user_id", "created_at", "updated_at", "name", "amount_cents", "interval_months", "start_month", "due_day", "kind", "category_id", "reserve_pot_id") SELECT "id", "user_id", "created_at", "updated_at", "name", "amount_cents", "interval_months", "start_month", "due_day", "kind", "category_id", "reserve_pot_id" FROM `recurring_items`;--> statement-breakpoint
DROP TABLE `recurring_items`;--> statement-breakpoint
ALTER TABLE `__new_recurring_items` RENAME TO `recurring_items`;--> statement-breakpoint
CREATE INDEX `recurring_items_user_idx` ON `recurring_items` (`user_id`);