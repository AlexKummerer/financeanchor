CREATE TABLE `import_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`import_key` text NOT NULL,
	`transaction_id` text NOT NULL,
	`import_label` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`transaction_id`) REFERENCES `transactions`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_links_key_uq` ON `import_links` (`user_id`,`import_key`);--> statement-breakpoint
CREATE INDEX `import_links_label_idx` ON `import_links` (`user_id`,`import_label`);