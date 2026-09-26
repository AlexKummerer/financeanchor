CREATE TABLE `card_statement_dates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`account_id` text NOT NULL,
	`close_month` text NOT NULL,
	`closing_date` text NOT NULL,
	`debit_date` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_statement_dates_uq` ON `card_statement_dates` (`user_id`,`account_id`,`close_month`);