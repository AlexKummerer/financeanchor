ALTER TABLE `booked_items` ADD `loan_saved_delta_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
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
	`saved_cents` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "loans_balance_ck" CHECK(balance_cents >= 0 and original_cents >= 0),
	CONSTRAINT "loans_rate_ck" CHECK(rate_bp between 0 and 10000),
	CONSTRAINT "loans_payment_ck" CHECK(payment_cents is null or payment_cents > 0),
	CONSTRAINT "loans_due_day_ck" CHECK(due_day between 1 and 31),
	CONSTRAINT "loans_kind_ck" CHECK(kind in ('installment', 'deadline')),
	CONSTRAINT "loans_saved_ck" CHECK(saved_cents >= 0),
	CONSTRAINT "loans_shape_ck" CHECK((kind = 'installment' and payment_cents is not null and due_date is null and payment_mode is null)
        or (kind = 'deadline' and payment_cents is null and target_month is null and due_date is not null
            and payment_mode in ('spread', 'lump')))
);
--> statement-breakpoint
INSERT INTO `__new_loans`("id", "user_id", "created_at", "updated_at", "name", "kind", "balance_cents", "original_cents", "rate_bp", "payment_cents", "due_day", "target_month", "due_date", "payment_mode") SELECT "id", "user_id", "created_at", "updated_at", "name", "kind", "balance_cents", "original_cents", "rate_bp", "payment_cents", "due_day", "target_month", "due_date", "payment_mode" FROM `loans`;--> statement-breakpoint
DROP TABLE `loans`;--> statement-breakpoint
ALTER TABLE `__new_loans` RENAME TO `loans`;--> statement-breakpoint
CREATE INDEX `loans_user_idx` ON `loans` (`user_id`);