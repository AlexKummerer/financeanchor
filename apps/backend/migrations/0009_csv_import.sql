ALTER TABLE `accounts` ADD `import_profile` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `import_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_import_key_uq` ON `transactions` (`user_id`,`import_key`) WHERE import_key is not null;