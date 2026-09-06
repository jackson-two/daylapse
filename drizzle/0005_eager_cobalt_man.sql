-- Additive foundation only: importing and row APIs are disabled by default.
CREATE TABLE `changes` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mutation_id` text,
	`import_run_id` text,
	`event_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`mutation_id`) REFERENCES `mutations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_run_id`) REFERENCES `migration_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "changes_origin" CHECK(("changes"."mutation_id" IS NULL) <> ("changes"."import_run_id" IS NULL)),
	CONSTRAINT "changes_json" CHECK(json_valid("changes"."after_json") AND ("changes"."before_json" IS NULL OR json_valid("changes"."before_json"))),
	CONSTRAINT "changes_entity" CHECK("changes"."entity_type" IN ('event','completion'))
);
--> statement-breakpoint
CREATE INDEX `changes_event_sequence` ON `changes` (`event_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `changes_mutation` ON `changes` (`mutation_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `completions` (
	`event_id` text NOT NULL,
	`id` text NOT NULL,
	`completed_on` text NOT NULL,
	`recorded_at` text,
	`updated_at` text,
	`source` text NOT NULL,
	`voided_at` text,
	PRIMARY KEY(`event_id`, `id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "completions_date" CHECK((completed_on IS NULL OR (length(completed_on) = 10 AND completed_on GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND completed_on BETWEEN '1900-01-01' AND '2200-12-31' AND date(completed_on, '+0 days') IS NOT NULL AND date(completed_on, '+0 days') = completed_on))),
	CONSTRAINT "completions_id" CHECK(length(trim("completions"."id")) BETWEEN 1 AND 128 AND "completions"."id" = trim("completions"."id")),
	CONSTRAINT "completions_source" CHECK("completions"."source" IN ('recorded','legacy_last_completed'))
);
--> statement-breakpoint
CREATE INDEX `completions_active_dates` ON `completions` (`event_id`,`completed_on`,`id`) WHERE "completions"."voided_at" IS NULL;--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`verb` text,
	`category` text,
	`notes` text,
	`kind` text NOT NULL,
	`schedule_type` text NOT NULL,
	`interval_value` integer,
	`interval_unit` text,
	`anchor_date` text,
	`target_date` text,
	`month` integer,
	`day` integer,
	`annual_anchor_date` text,
	`holiday_key` text,
	`snoozed_until` text,
	`highlight_within_days` integer DEFAULT 7 NOT NULL,
	`show_on_dashboard` integer DEFAULT true NOT NULL,
	`show_on_display` integer DEFAULT true NOT NULL,
	`notify_due_today` integer DEFAULT true NOT NULL,
	`dashboard_window_days` integer,
	`archived_at` text,
	`deleted_at` text,
	`created_on` text NOT NULL,
	`created_at` text,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`import_position` integer,
	CONSTRAINT "events_text_bounds" CHECK(length(trim("events"."id")) BETWEEN 1 AND 128 AND "events"."id" = trim("events"."id") AND length(trim("events"."title")) > 0 AND length("events"."title") <= 200 AND ("events"."verb" IS NULL OR length("events"."verb") <= 80) AND ("events"."category" IS NULL OR length("events"."category") <= 80) AND ("events"."notes" IS NULL OR length("events"."notes") <= 10000)),
	CONSTRAINT "events_flags" CHECK("events"."show_on_dashboard" IN (0,1) AND "events"."show_on_display" IN (0,1) AND "events"."notify_due_today" IN (0,1)),
	CONSTRAINT "events_numbers" CHECK("events"."version" > 0 AND "events"."highlight_within_days" BETWEEN 0 AND 3650 AND ("events"."dashboard_window_days" IS NULL OR "events"."dashboard_window_days" BETWEEN 0 AND 3650)),
	CONSTRAINT "events_integer_fields" CHECK(typeof(version) = 'integer' AND typeof(highlight_within_days) = 'integer' AND (interval_value IS NULL OR typeof(interval_value) = 'integer') AND (month IS NULL OR typeof(month) = 'integer') AND (day IS NULL OR typeof(day) = 'integer') AND (dashboard_window_days IS NULL OR typeof(dashboard_window_days) = 'integer') AND (import_position IS NULL OR (typeof(import_position) = 'integer' AND import_position >= 0))),
	CONSTRAINT "events_anchor_date_valid" CHECK((anchor_date IS NULL OR (length(anchor_date) = 10 AND anchor_date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND anchor_date BETWEEN '1900-01-01' AND '2200-12-31' AND date(anchor_date, '+0 days') IS NOT NULL AND date(anchor_date, '+0 days') = anchor_date))),
	CONSTRAINT "events_target_date_valid" CHECK((target_date IS NULL OR (length(target_date) = 10 AND target_date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND target_date BETWEEN '1900-01-01' AND '2200-12-31' AND date(target_date, '+0 days') IS NOT NULL AND date(target_date, '+0 days') = target_date))),
	CONSTRAINT "events_annual_anchor_date_valid" CHECK((annual_anchor_date IS NULL OR (length(annual_anchor_date) = 10 AND annual_anchor_date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND annual_anchor_date BETWEEN '1900-01-01' AND '2200-12-31' AND date(annual_anchor_date, '+0 days') IS NOT NULL AND date(annual_anchor_date, '+0 days') = annual_anchor_date))),
	CONSTRAINT "events_snoozed_until_valid" CHECK((snoozed_until IS NULL OR (length(snoozed_until) = 10 AND snoozed_until GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND snoozed_until BETWEEN '1900-01-01' AND '2200-12-31' AND date(snoozed_until, '+0 days') IS NOT NULL AND date(snoozed_until, '+0 days') = snoozed_until))),
	CONSTRAINT "events_created_on_valid" CHECK((created_on IS NULL OR (length(created_on) = 10 AND created_on GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND created_on BETWEEN '1900-01-01' AND '2200-12-31' AND date(created_on, '+0 days') IS NOT NULL AND date(created_on, '+0 days') = created_on))),
	CONSTRAINT "events_schedule" CHECK(COALESCE(
    (schedule_type = 'interval' AND kind = 'task' AND interval_value BETWEEN 1 AND 10000 AND interval_unit IN ('days','weeks','months','years') AND anchor_date IS NOT NULL AND target_date IS NULL AND month IS NULL AND day IS NULL AND holiday_key IS NULL AND annual_anchor_date IS NULL)
    OR (interval_value IS NULL AND interval_unit IS NULL AND anchor_date IS NULL AND snoozed_until IS NULL AND (
      (schedule_type = 'fixed_date' AND kind = 'event' AND target_date IS NOT NULL AND month IS NULL AND day IS NULL AND holiday_key IS NULL AND annual_anchor_date IS NULL)
      OR (schedule_type = 'annual_date' AND kind IN ('event','birthday','anniversary','holiday') AND target_date IS NULL AND holiday_key IS NULL AND month BETWEEN 1 AND 12 AND day BETWEEN 1 AND CAST(strftime('%d', date(printf('2000-%02d-01', month), '+1 month', '-1 day')) AS INTEGER) AND (annual_anchor_date IS NULL OR (kind = 'event' AND CAST(substr(annual_anchor_date,6,2) AS INTEGER) = month AND CAST(substr(annual_anchor_date,9,2) AS INTEGER) = day)))
      OR (schedule_type = 'holiday_rule' AND kind = 'holiday' AND target_date IS NULL AND month IS NULL AND day IS NULL AND annual_anchor_date IS NULL AND holiday_key IN ('new-year','mlk-day','valentines','presidents-day','memorial-day','independence-day','labor-day','halloween','thanksgiving','christmas'))
    )), 0))
);
--> statement-breakpoint
CREATE INDEX `events_active_dashboard` ON `events` (`show_on_dashboard`,`id`) WHERE "events"."archived_at" IS NULL AND "events"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `events_active_display` ON `events` (`show_on_display`,`schedule_type`,`id`) WHERE "events"."archived_at" IS NULL AND "events"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `events_active_notifications` ON `events` (`notify_due_today`,`id`) WHERE "events"."archived_at" IS NULL AND "events"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `installation_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`schema_version` integer DEFAULT 2 NOT NULL,
	`default_time_zone` text DEFAULT 'UTC' NOT NULL,
	`storage_mode` text DEFAULT 'legacy' NOT NULL,
	`import_state` text DEFAULT 'empty' NOT NULL,
	`active_run_id` text,
	CONSTRAINT "installation_singleton" CHECK("installation_settings"."id" = 1),
	CONSTRAINT "installation_modes" CHECK("installation_settings"."storage_mode" IN ('legacy','rows') AND "installation_settings"."import_state" IN ('empty','importing','ready'))
);
--> statement-breakpoint
CREATE TABLE `migration_chunks` (
	`run_id` text NOT NULL,
	`chunk_number` integer NOT NULL,
	`checksum` text NOT NULL,
	PRIMARY KEY(`run_id`, `chunk_number`),
	FOREIGN KEY (`run_id`) REFERENCES `migration_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `migration_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_revision` integer NOT NULL,
	`source_hash` text NOT NULL,
	`converter_version` integer NOT NULL,
	`expected_events` integer NOT NULL,
	`expected_completions` integer NOT NULL,
	`expected_chunks` integer NOT NULL,
	`imported_at` text NOT NULL,
	`completed_at` text,
	`end_sequence` integer,
	`report_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`expected_version` integer NOT NULL,
	`operation` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`response_json` text,
	`sequence` integer
);
--> statement-breakpoint
CREATE INDEX `mutations_event_sequence` ON `mutations` (`event_id`,`sequence`);
--> statement-breakpoint
INSERT INTO installation_settings (id) VALUES (1);
--> statement-breakpoint
CREATE TRIGGER row_mutation_precondition BEFORE INSERT ON mutations
WHEN NOT EXISTS (SELECT 1 FROM mutations WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'row_storage_disabled') WHERE NOT EXISTS (SELECT 1 FROM installation_settings WHERE id = 1 AND storage_mode = 'rows' AND import_state = 'ready');
  SELECT RAISE(ABORT, 'event_version_conflict') WHERE NEW.expected_version = 0 AND EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id);
  SELECT RAISE(ABORT, 'event_version_conflict') WHERE NEW.expected_version > 0 AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND version = NEW.expected_version);
  SELECT RAISE(ABORT, 'event_version_conflict') WHERE NEW.expected_version < 0;
END;
--> statement-breakpoint
CREATE TRIGGER row_receipt_immutable BEFORE UPDATE ON mutations WHEN OLD.response_json IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'mutation_receipt_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER row_receipt_no_delete BEFORE DELETE ON mutations
BEGIN SELECT RAISE(ABORT, 'mutation_receipt_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER row_changes_no_update BEFORE UPDATE ON changes
BEGIN SELECT RAISE(ABORT, 'change_history_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER row_changes_no_delete BEFORE DELETE ON changes
BEGIN SELECT RAISE(ABORT, 'change_history_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER row_import_empty BEFORE INSERT ON migration_runs
BEGIN
  SELECT RAISE(ABORT, 'row_import_not_empty') WHERE EXISTS (SELECT 1 FROM events) OR EXISTS (SELECT 1 FROM completions)
    OR NOT EXISTS (SELECT 1 FROM installation_settings WHERE id = 1 AND storage_mode = 'legacy' AND import_state = 'empty')
   ;
END;
--> statement-breakpoint
CREATE TRIGGER row_import_chunk_guard BEFORE INSERT ON migration_chunks
BEGIN
  SELECT RAISE(ABORT, 'row_import_not_active') WHERE NOT EXISTS (SELECT 1 FROM installation_settings WHERE id = 1 AND storage_mode = 'legacy' AND import_state = 'importing' AND active_run_id = NEW.run_id)
   ;
END;
--> statement-breakpoint
CREATE TRIGGER row_activation_guard BEFORE UPDATE OF storage_mode ON installation_settings WHEN NEW.storage_mode = 'rows'
BEGIN SELECT RAISE(ABORT, 'row_import_incomplete') WHERE NEW.import_state <> 'ready'; END;
