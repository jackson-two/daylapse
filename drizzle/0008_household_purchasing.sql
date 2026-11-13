CREATE TABLE `shopping_audit` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mutation_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`mutation_id`) REFERENCES `shopping_receipts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shopping_audit_entity` ON `shopping_audit` (`entity`,`entity_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `shopping_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`item_id` text NOT NULL,
	`list_id` text NOT NULL,
	`status` text NOT NULL,
	`notes` text NOT NULL,
	`priority` integer NOT NULL,
	`sort_position` integer NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `shopping_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shopping_entries_version" CHECK("shopping_entries"."version" >= 1),
	CONSTRAINT "shopping_entries_valid_0" CHECK(status IN ('active','completed','removed'))
);
--> statement-breakpoint
CREATE INDEX `shopping_entries_item_id` ON `shopping_entries` (`item_id`);--> statement-breakpoint
CREATE INDEX `shopping_entries_status` ON `shopping_entries` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_entries_active` ON `shopping_entries` (`list_id`,`item_id`) WHERE "shopping_entries"."status" = 'active';--> statement-breakpoint
CREATE TABLE `shopping_items` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`notes` text NOT NULL,
	`image_url` text NOT NULL,
	`default_unit` text NOT NULL,
	`merged_into_id` text,
	FOREIGN KEY (`merged_into_id`) REFERENCES `shopping_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shopping_items_version" CHECK("shopping_items"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE `shopping_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`city` text NOT NULL,
	`region` text NOT NULL,
	`postal_code` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`store_identifier` text NOT NULL,
	`preferred` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `shopping_stores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shopping_locations_version" CHECK("shopping_locations"."version" >= 1),
	CONSTRAINT "shopping_locations_valid_0" CHECK(preferred IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `shopping_locations_store_id` ON `shopping_locations` (`store_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_locations_preferred` ON `shopping_locations` (`store_id`) WHERE "shopping_locations"."preferred" = 1 AND "shopping_locations"."archived_at" IS NULL;--> statement-breakpoint
CREATE TABLE `shopping_offerings` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`product_id` text NOT NULL,
	`store_id` text NOT NULL,
	`location_id` text,
	`preference` integer NOT NULL,
	`url` text NOT NULL,
	`notes` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `shopping_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `shopping_stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `shopping_locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shopping_offerings_version" CHECK("shopping_offerings"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `shopping_offerings_product_id` ON `shopping_offerings` (`product_id`);--> statement-breakpoint
CREATE INDEX `shopping_offerings_store_id` ON `shopping_offerings` (`store_id`);--> statement-breakpoint
CREATE INDEX `shopping_offerings_location_id` ON `shopping_offerings` (`location_id`);--> statement-breakpoint
CREATE TABLE `shopping_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`entry_id` text NOT NULL,
	`item_id` text NOT NULL,
	`product_id` text NOT NULL,
	`store_id` text NOT NULL,
	`location_id` text,
	`offering_id` text NOT NULL,
	`kind` text NOT NULL,
	`quantity` integer NOT NULL,
	`package_price` integer,
	`total_price` integer,
	`currency` text NOT NULL,
	`occurred_at` text NOT NULL,
	`notes` text NOT NULL,
	`trip_id` text,
	`keep_on_list` integer NOT NULL,
	`source` text NOT NULL,
	`actor` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`reversed_at` text,
	`correction_of_id` text,
	`correction_reason` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `shopping_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `shopping_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `shopping_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `shopping_stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `shopping_locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offering_id`) REFERENCES `shopping_offerings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`correction_of_id`) REFERENCES `shopping_outcomes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shopping_outcomes_version" CHECK("shopping_outcomes"."version" >= 1),
	CONSTRAINT "shopping_outcomes_valid_0" CHECK(kind IN ('purchased','out_of_stock','skipped')),
	CONSTRAINT "shopping_outcomes_valid_1" CHECK(quantity >= 0),
	CONSTRAINT "shopping_outcomes_valid_2" CHECK(package_price IS NULL OR package_price >= 0),
	CONSTRAINT "shopping_outcomes_valid_3" CHECK(total_price IS NULL OR total_price >= 0),
	CONSTRAINT "shopping_outcomes_valid_4" CHECK(json_valid(snapshot_json))
);
--> statement-breakpoint
CREATE INDEX `shopping_outcomes_item_id` ON `shopping_outcomes` (`item_id`);--> statement-breakpoint
CREATE INDEX `shopping_outcomes_product_id` ON `shopping_outcomes` (`product_id`);--> statement-breakpoint
CREATE INDEX `shopping_outcomes_store_id` ON `shopping_outcomes` (`store_id`);--> statement-breakpoint
CREATE INDEX `shopping_outcomes_location_id` ON `shopping_outcomes` (`location_id`);--> statement-breakpoint
CREATE INDEX `shopping_outcomes_occurred_at` ON `shopping_outcomes` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `shopping_outcomes_trip_id` ON `shopping_outcomes` (`trip_id`);--> statement-breakpoint
CREATE TABLE `shopping_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`entry_id` text NOT NULL,
	`offering_id` text NOT NULL,
	`quantity` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `shopping_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offering_id`) REFERENCES `shopping_offerings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shopping_plans_version" CHECK("shopping_plans"."version" >= 1),
	CONSTRAINT "shopping_plans_valid_0" CHECK(quantity >= 0),
	CONSTRAINT "shopping_plans_valid_1" CHECK(quantity <= 10000)
);
--> statement-breakpoint
CREATE INDEX `shopping_plans_entry_id` ON `shopping_plans` (`entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_plans_pair` ON `shopping_plans` (`entry_id`,`offering_id`);--> statement-breakpoint
CREATE TABLE `shopping_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`offering_id` text NOT NULL,
	`location_id` text,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`observed_at` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text NOT NULL,
	`reference` text NOT NULL,
	`verified` integer NOT NULL,
	`conditions` text NOT NULL,
	`expires_at` text,
	`notes` text NOT NULL,
	`actor` text NOT NULL,
	`package_quantity` real NOT NULL,
	`package_unit` text NOT NULL,
	`snapshot_json` text NOT NULL,
	FOREIGN KEY (`offering_id`) REFERENCES `shopping_offerings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `shopping_locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shopping_prices_version" CHECK("shopping_prices"."version" >= 1),
	CONSTRAINT "shopping_prices_valid_0" CHECK(amount >= 0),
	CONSTRAINT "shopping_prices_valid_1" CHECK(verified IN (0,1)),
	CONSTRAINT "shopping_prices_valid_2" CHECK(json_valid(snapshot_json))
);
--> statement-breakpoint
CREATE INDEX `shopping_prices_offering_id` ON `shopping_prices` (`offering_id`);--> statement-breakpoint
CREATE INDEX `shopping_prices_observed_at` ON `shopping_prices` (`observed_at`);--> statement-breakpoint
CREATE TABLE `shopping_products` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`brand` text NOT NULL,
	`package_quantity` real NOT NULL,
	`package_unit` text NOT NULL,
	`upc` text NOT NULL,
	`sku` text NOT NULL,
	`image_url` text NOT NULL,
	`preference` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shopping_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shopping_products_version" CHECK("shopping_products"."version" >= 1),
	CONSTRAINT "shopping_products_valid_0" CHECK(package_quantity > 0),
	CONSTRAINT "shopping_products_valid_1" CHECK(preference >= 0)
);
--> statement-breakpoint
CREATE INDEX `shopping_products_item_id` ON `shopping_products` (`item_id`);--> statement-breakpoint
CREATE TABLE `shopping_rate_limits` (
	`actor` text PRIMARY KEY NOT NULL,
	`bucket` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shopping_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`request_hash` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`response_json` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "shopping_receipt_json" CHECK(json_valid("shopping_receipts"."response_json"))
);
--> statement-breakpoint
CREATE TABLE `shopping_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "shopping_state_singleton" CHECK("shopping_state"."id"=1)
);
--> statement-breakpoint
CREATE TABLE `shopping_stores` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`logo_url` text NOT NULL,
	`website` text NOT NULL,
	`notes` text NOT NULL,
	CONSTRAINT "shopping_stores_version" CHECK("shopping_stores"."version" >= 1)
);

--> statement-breakpoint
INSERT INTO shopping_state (id,revision) VALUES (1,0);
--> statement-breakpoint
CREATE TRIGGER shopping_revision_guard BEFORE INSERT ON shopping_receipts BEGIN
 SELECT CASE WHEN NEW.expected_revision != (SELECT revision FROM shopping_state WHERE id=1) THEN RAISE(ABORT,'shopping_revision_conflict') END;
 UPDATE shopping_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER shopping_prices_update_blocked BEFORE UPDATE ON shopping_prices BEGIN SELECT RAISE(ABORT,'immutable_shopping_history'); END;
--> statement-breakpoint
CREATE TRIGGER shopping_prices_delete_blocked BEFORE DELETE ON shopping_prices BEGIN SELECT RAISE(ABORT,'immutable_shopping_history'); END;
--> statement-breakpoint
CREATE TRIGGER shopping_audit_update_blocked BEFORE UPDATE ON shopping_audit BEGIN SELECT RAISE(ABORT,'immutable_shopping_history'); END;
--> statement-breakpoint
CREATE TRIGGER shopping_audit_delete_blocked BEFORE DELETE ON shopping_audit BEGIN SELECT RAISE(ABORT,'immutable_shopping_history'); END;
--> statement-breakpoint
CREATE TRIGGER shopping_receipts_update_blocked BEFORE UPDATE ON shopping_receipts BEGIN SELECT RAISE(ABORT,'immutable_shopping_history'); END;
--> statement-breakpoint
CREATE TRIGGER shopping_receipts_delete_blocked BEFORE DELETE ON shopping_receipts BEGIN SELECT RAISE(ABORT,'immutable_shopping_history'); END;
--> statement-breakpoint
CREATE TRIGGER shopping_outcomes_preserve BEFORE UPDATE ON shopping_outcomes WHEN
 NEW.snapshot_json != OLD.snapshot_json OR NEW.kind != OLD.kind OR NEW.quantity != OLD.quantity OR NEW.package_price IS NOT OLD.package_price OR NEW.total_price IS NOT OLD.total_price OR NEW.offering_id != OLD.offering_id OR NEW.occurred_at != OLD.occurred_at OR NEW.notes != OLD.notes OR NEW.currency != OLD.currency
 BEGIN SELECT RAISE(ABORT,'immutable_shopping_outcome'); END;
--> statement-breakpoint
CREATE TRIGGER shopping_outcomes_delete_blocked BEFORE DELETE ON shopping_outcomes BEGIN SELECT RAISE(ABORT,'immutable_shopping_history'); END;
