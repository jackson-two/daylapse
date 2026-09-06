-- Rebuild schedules atomically, preserving completion rows and all history.
CREATE TABLE `__new_events` (
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
	`weekday` integer,
	`occurrence` integer,
	`after_full_week` integer DEFAULT false NOT NULL,
	`week_starts_on` integer DEFAULT 0 NOT NULL,
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
	CONSTRAINT "events_text_bounds" CHECK(length(trim("__new_events"."id")) BETWEEN 1 AND 128 AND "__new_events"."id" = trim("__new_events"."id") AND length(trim("__new_events"."title")) > 0 AND length("__new_events"."title") <= 200 AND ("__new_events"."verb" IS NULL OR length("__new_events"."verb") <= 80) AND ("__new_events"."category" IS NULL OR length("__new_events"."category") <= 80) AND ("__new_events"."notes" IS NULL OR length("__new_events"."notes") <= 10000)),
	CONSTRAINT "events_flags" CHECK("__new_events"."show_on_dashboard" IN (0,1) AND "__new_events"."show_on_display" IN (0,1) AND "__new_events"."notify_due_today" IN (0,1)),
	CONSTRAINT "events_numbers" CHECK("__new_events"."version" > 0 AND "__new_events"."highlight_within_days" BETWEEN 0 AND 3650 AND ("__new_events"."dashboard_window_days" IS NULL OR "__new_events"."dashboard_window_days" BETWEEN 0 AND 3650)),
	CONSTRAINT "events_integer_fields" CHECK(typeof(version) = 'integer' AND typeof(highlight_within_days) = 'integer' AND (interval_value IS NULL OR typeof(interval_value) = 'integer') AND (month IS NULL OR typeof(month) = 'integer') AND (day IS NULL OR typeof(day) = 'integer') AND (dashboard_window_days IS NULL OR typeof(dashboard_window_days) = 'integer') AND (import_position IS NULL OR (typeof(import_position) = 'integer' AND import_position >= 0))),
	CONSTRAINT "events_anchor_date_valid" CHECK((anchor_date IS NULL OR (length(anchor_date) = 10 AND anchor_date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND anchor_date BETWEEN '1900-01-01' AND '2200-12-31' AND date(anchor_date, '+0 days') IS NOT NULL AND date(anchor_date, '+0 days') = anchor_date))),
	CONSTRAINT "events_target_date_valid" CHECK((target_date IS NULL OR (length(target_date) = 10 AND target_date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND target_date BETWEEN '1900-01-01' AND '2200-12-31' AND date(target_date, '+0 days') IS NOT NULL AND date(target_date, '+0 days') = target_date))),
	CONSTRAINT "events_annual_anchor_date_valid" CHECK((annual_anchor_date IS NULL OR (length(annual_anchor_date) = 10 AND annual_anchor_date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND annual_anchor_date BETWEEN '1900-01-01' AND '2200-12-31' AND date(annual_anchor_date, '+0 days') IS NOT NULL AND date(annual_anchor_date, '+0 days') = annual_anchor_date))),
	CONSTRAINT "events_snoozed_until_valid" CHECK((snoozed_until IS NULL OR (length(snoozed_until) = 10 AND snoozed_until GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND snoozed_until BETWEEN '1900-01-01' AND '2200-12-31' AND date(snoozed_until, '+0 days') IS NOT NULL AND date(snoozed_until, '+0 days') = snoozed_until))),
	CONSTRAINT "events_created_on_valid" CHECK((created_on IS NULL OR (length(created_on) = 10 AND created_on GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND created_on BETWEEN '1900-01-01' AND '2200-12-31' AND date(created_on, '+0 days') IS NOT NULL AND date(created_on, '+0 days') = created_on))),
	CONSTRAINT "events_schedule" CHECK(COALESCE(
    (schedule_type = 'weekday_rule' AND kind = 'holiday' AND month BETWEEN 1 AND 12 AND typeof(weekday) = 'integer' AND weekday BETWEEN 0 AND 6 AND typeof(occurrence) = 'integer' AND occurrence BETWEEN 1 AND 5 AND after_full_week IN (0,1) AND week_starts_on IN (0,1) AND (after_full_week = 0 OR 8 + ((weekday - week_starts_on + 7) % 7) + (occurrence - 1) * 7 <= CAST(strftime('%d', date(printf('2000-%02d-01', month), '+1 month', '-1 day')) AS INTEGER)) AND day IS NULL AND holiday_key IS NULL AND annual_anchor_date IS NULL AND interval_value IS NULL AND interval_unit IS NULL AND anchor_date IS NULL AND target_date IS NULL AND snoozed_until IS NULL)
    OR (weekday IS NULL AND occurrence IS NULL AND after_full_week = 0 AND week_starts_on = 0 AND (
    (schedule_type = 'interval' AND kind = 'task' AND interval_value BETWEEN 1 AND 10000 AND interval_unit IN ('days','weeks','months','years') AND anchor_date IS NOT NULL AND target_date IS NULL AND month IS NULL AND day IS NULL AND holiday_key IS NULL AND annual_anchor_date IS NULL)
    OR (interval_value IS NULL AND interval_unit IS NULL AND anchor_date IS NULL AND snoozed_until IS NULL AND (
      (schedule_type = 'fixed_date' AND kind = 'event' AND target_date IS NOT NULL AND month IS NULL AND day IS NULL AND holiday_key IS NULL AND annual_anchor_date IS NULL)
      OR (schedule_type = 'annual_date' AND kind IN ('event','birthday','anniversary','holiday') AND target_date IS NULL AND holiday_key IS NULL AND month BETWEEN 1 AND 12 AND day BETWEEN 1 AND CAST(strftime('%d', date(printf('2000-%02d-01', month), '+1 month', '-1 day')) AS INTEGER) AND (annual_anchor_date IS NULL OR (kind = 'event' AND CAST(substr(annual_anchor_date,6,2) AS INTEGER) = month AND CAST(substr(annual_anchor_date,9,2) AS INTEGER) = day)))
      OR (schedule_type = 'holiday_rule' AND kind = 'holiday' AND target_date IS NULL AND month IS NULL AND day IS NULL AND annual_anchor_date IS NULL AND holiday_key IN ('new-year','mlk-day','valentines','presidents-day','memorial-day','independence-day','labor-day','halloween','thanksgiving','christmas'))
    )))), 0))
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "title", "verb", "category", "notes", "kind", "schedule_type", "interval_value", "interval_unit", "anchor_date", "target_date", "month", "day", "annual_anchor_date", "holiday_key", "weekday", "occurrence", "after_full_week", "week_starts_on", "snoozed_until", "highlight_within_days", "show_on_dashboard", "show_on_display", "notify_due_today", "dashboard_window_days", "archived_at", "deleted_at", "created_on", "created_at", "updated_at", "version", "import_position") SELECT "id", "title", "verb", "category", "notes", "kind", "schedule_type", "interval_value", "interval_unit", "anchor_date", "target_date", "month", "day", "annual_anchor_date", "holiday_key", NULL, NULL, 0, 0, "snoozed_until", "highlight_within_days", "show_on_dashboard", "show_on_display", "notify_due_today", "dashboard_window_days", "archived_at", "deleted_at", "created_on", "created_at", "updated_at", "version", "import_position" FROM `events`;--> statement-breakpoint
CREATE TABLE __holiday_completions AS SELECT * FROM completions;
--> statement-breakpoint
DROP TABLE completions;
--> statement-breakpoint
DROP TRIGGER row_mutation_precondition;
--> statement-breakpoint
DROP TRIGGER row_import_empty;
--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
CREATE INDEX `events_active_dashboard` ON `events` (`show_on_dashboard`,`id`) WHERE "events"."archived_at" IS NULL AND "events"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `events_active_display` ON `events` (`show_on_display`,`schedule_type`,`id`) WHERE "events"."archived_at" IS NULL AND "events"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `events_active_notifications` ON `events` (`notify_due_today`,`id`) WHERE "events"."archived_at" IS NULL AND "events"."deleted_at" IS NULL;
--> statement-breakpoint

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
INSERT INTO completions SELECT * FROM __holiday_completions;
--> statement-breakpoint
DROP TABLE __holiday_completions;
--> statement-breakpoint

CREATE INDEX `completions_active_dates` ON `completions` (`event_id`,`completed_on`,`id`) WHERE "completions"."voided_at" IS NULL;
--> statement-breakpoint

CREATE TRIGGER row_import_empty BEFORE INSERT ON migration_runs
BEGIN
  SELECT RAISE(ABORT, 'row_import_not_empty') WHERE EXISTS (SELECT 1 FROM events) OR EXISTS (SELECT 1 FROM completions)
    OR NOT EXISTS (SELECT 1 FROM installation_settings WHERE id = 1 AND storage_mode = 'legacy' AND import_state = 'empty')
   ;
END;

--> statement-breakpoint

CREATE TRIGGER row_mutation_precondition BEFORE INSERT ON mutations
WHEN NOT EXISTS (SELECT 1 FROM mutations WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'row_storage_disabled') WHERE NOT EXISTS (SELECT 1 FROM installation_settings WHERE id = 1 AND storage_mode = 'rows' AND import_state = 'ready');
  SELECT RAISE(ABORT, 'household_sequence_conflict') WHERE NEW.operation = 'household.restore' AND NEW.expected_version <> (SELECT COALESCE(MAX(sequence),0) FROM changes);
  SELECT RAISE(ABORT, 'event_version_conflict') WHERE NEW.operation <> 'household.restore' AND NEW.expected_version = 0 AND EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id);
  SELECT RAISE(ABORT, 'event_version_conflict') WHERE NEW.operation <> 'household.restore' AND NEW.expected_version > 0 AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND version = NEW.expected_version);
  SELECT RAISE(ABORT, 'event_version_conflict') WHERE NEW.expected_version < 0;
END;

