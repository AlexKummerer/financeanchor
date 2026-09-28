CREATE UNIQUE INDEX `booked_items_user_id_id_uq` ON `booked_items` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `booked_item_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`booked_item_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`booked_item_id`) REFERENCES `booked_items`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`transaction_id`) REFERENCES `transactions`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booked_item_parts_transaction_uq` ON `booked_item_parts` (`user_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `booked_item_parts_item_idx` ON `booked_item_parts` (`user_id`,`booked_item_id`);
