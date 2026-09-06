CREATE TABLE `household_state_revisions` (
	`household_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`item_count` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	PRIMARY KEY(`household_id`, `revision`),
	CONSTRAINT "household_state_revisions_data_is_array" CHECK(json_valid("household_state_revisions"."data") AND json_type("household_state_revisions"."data") = 'array'),
	CONSTRAINT "household_state_revisions_item_count_nonnegative" CHECK("household_state_revisions"."item_count" >= 0),
	CONSTRAINT "household_state_revisions_size_bytes_nonnegative" CHECK("household_state_revisions"."size_bytes" >= 0)
);
--> statement-breakpoint
INSERT INTO "household_state_revisions" (
	"household_id", "revision", "data", "created_at", "item_count", "size_bytes"
)
SELECT
	"id", "revision", "data", "updated_at", json_array_length("data"), length(CAST("data" AS BLOB))
FROM "household_state";
--> statement-breakpoint
CREATE TRIGGER "snapshot_household_state_after_insert"
AFTER INSERT ON "household_state"
BEGIN
	INSERT INTO "household_state_revisions" (
		"household_id", "revision", "data", "created_at", "item_count", "size_bytes"
	) VALUES (
		NEW."id", NEW."revision", NEW."data", NEW."updated_at",
		json_array_length(NEW."data"), length(CAST(NEW."data" AS BLOB))
	);
END;
--> statement-breakpoint
CREATE TRIGGER "snapshot_household_state_after_update"
AFTER UPDATE OF "data", "revision", "updated_at" ON "household_state"
WHEN NEW."revision" <> OLD."revision"
BEGIN
	INSERT INTO "household_state_revisions" (
		"household_id", "revision", "data", "created_at", "item_count", "size_bytes"
	) VALUES (
		NEW."id", NEW."revision", NEW."data", NEW."updated_at",
		json_array_length(NEW."data"), length(CAST(NEW."data" AS BLOB))
	);
END;
