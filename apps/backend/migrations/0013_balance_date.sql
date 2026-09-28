ALTER TABLE `accounts` ADD `balance_date` text;--> statement-breakpoint
ALTER TABLE `loans` ADD `balance_date` text;--> statement-breakpoint
-- Bestehende Stände gelten ab ihrer letzten Änderung (Kreditkarten ausgenommen: deren Stand wird aus
-- den Buchungen berechnet; beim nächsten Eintragen bekommt die Karte ein Stand-Datum)
UPDATE `accounts` SET `balance_date` = date(`updated_at` / 1000, 'unixepoch') WHERE `kind` <> 'credit_card';--> statement-breakpoint
UPDATE `loans` SET `balance_date` = date(`updated_at` / 1000, 'unixepoch');
