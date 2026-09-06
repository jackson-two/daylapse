import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const householdState = sqliteTable("household_state", {
  id: integer("id").primaryKey(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

export const householdStateRevisions = sqliteTable("household_state_revisions", {
  householdId: integer("household_id").notNull(),
  revision: integer("revision").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
  itemCount: integer("item_count").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
}, (table) => [
  primaryKey({ columns: [table.householdId, table.revision] }),
  check("household_state_revisions_data_is_array", sql`json_valid(${table.data}) AND json_type(${table.data}) = 'array'`),
  check("household_state_revisions_item_count_nonnegative", sql`${table.itemCount} >= 0`),
  check("household_state_revisions_size_bytes_nonnegative", sql`${table.sizeBytes} >= 0`),
]);

export const displayAccessKeys = sqliteTable("display_access_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
}, (table) => [
  uniqueIndex("display_access_keys_token_hash_unique").on(table.tokenHash),
]);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  vapidPublicKey: text("vapid_public_key").notNull(),
  dueToday: integer("due_today").notNull().default(1),
  deliveryTime: text("delivery_time").notNull().default("08:00"),
  timeZone: text("time_zone").notNull(),
  lastSentDate: text("last_sent_date"),
  leaseUntil: integer("lease_until").notNull().default(0),
  leaseToken: text("lease_token"),
  lastTestAt: integer("last_test_at").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [check("push_subscriptions_due_today_boolean", sql`${table.dueToday} IN (0, 1)`)]);

const validDateSql = (name: string) => sql.raw(`(${name} IS NULL OR (length(${name}) = 10 AND ${name} GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND ${name} BETWEEN '1900-01-01' AND '2200-12-31' AND date(${name}, '+0 days') IS NOT NULL AND date(${name}, '+0 days') = ${name}))`);
export const events = sqliteTable("events", {
  id: text("id").primaryKey(), title: text("title").notNull(), verb: text("verb"), category: text("category"), notes: text("notes"),
  kind: text("kind").notNull(), scheduleType: text("schedule_type").notNull(),
  intervalValue: integer("interval_value"), intervalUnit: text("interval_unit"), anchorDate: text("anchor_date"),
  targetDate: text("target_date"), month: integer("month"), day: integer("day"), annualAnchorDate: text("annual_anchor_date"), holidayKey: text("holiday_key"),
  weekday: integer("weekday"), occurrence: integer("occurrence"),
  afterFullWeek: integer("after_full_week", { mode: "boolean" }).notNull().default(false),
  weekStartsOn: integer("week_starts_on").notNull().default(0),
  snoozedUntil: text("snoozed_until"), highlightWithinDays: integer("highlight_within_days").notNull().default(7),
  showOnDashboard: integer("show_on_dashboard", { mode: "boolean" }).notNull().default(true),
  showOnDisplay: integer("show_on_display", { mode: "boolean" }).notNull().default(true),
  notifyDueToday: integer("notify_due_today", { mode: "boolean" }).notNull().default(true),
  dashboardWindowDays: integer("dashboard_window_days"), archivedAt: text("archived_at"), deletedAt: text("deleted_at"),
  createdOn: text("created_on").notNull(), createdAt: text("created_at"), updatedAt: text("updated_at").notNull(), version: integer("version").notNull().default(1),
  importPosition: integer("import_position"),
}, (t) => [
  check("events_text_bounds", sql`length(trim(${t.id})) BETWEEN 1 AND 128 AND ${t.id} = trim(${t.id}) AND length(trim(${t.title})) > 0 AND length(${t.title}) <= 200 AND (${t.verb} IS NULL OR length(${t.verb}) <= 80) AND (${t.category} IS NULL OR length(${t.category}) <= 80) AND (${t.notes} IS NULL OR length(${t.notes}) <= 10000)`),
  check("events_flags", sql`${t.showOnDashboard} IN (0,1) AND ${t.showOnDisplay} IN (0,1) AND ${t.notifyDueToday} IN (0,1)`),
  check("events_numbers", sql`${t.version} > 0 AND ${t.highlightWithinDays} BETWEEN 0 AND 3650 AND (${t.dashboardWindowDays} IS NULL OR ${t.dashboardWindowDays} BETWEEN 0 AND 3650)`),
  check("events_integer_fields", sql.raw("typeof(version) = 'integer' AND typeof(highlight_within_days) = 'integer' AND (interval_value IS NULL OR typeof(interval_value) = 'integer') AND (month IS NULL OR typeof(month) = 'integer') AND (day IS NULL OR typeof(day) = 'integer') AND (dashboard_window_days IS NULL OR typeof(dashboard_window_days) = 'integer') AND (import_position IS NULL OR (typeof(import_position) = 'integer' AND import_position >= 0))")),
  ...["anchor_date", "target_date", "annual_anchor_date", "snoozed_until", "created_on"].map((name) => check(`events_${name}_valid`, validDateSql(name))),
  check("events_schedule", sql.raw(`COALESCE(
    (schedule_type = 'weekday_rule' AND kind = 'holiday' AND month BETWEEN 1 AND 12 AND typeof(weekday) = 'integer' AND weekday BETWEEN 0 AND 6 AND typeof(occurrence) = 'integer' AND occurrence BETWEEN 1 AND 5 AND after_full_week IN (0,1) AND week_starts_on IN (0,1) AND (after_full_week = 0 OR 8 + ((weekday - week_starts_on + 7) % 7) + (occurrence - 1) * 7 <= CAST(strftime('%d', date(printf('2000-%02d-01', month), '+1 month', '-1 day')) AS INTEGER)) AND day IS NULL AND holiday_key IS NULL AND annual_anchor_date IS NULL AND interval_value IS NULL AND interval_unit IS NULL AND anchor_date IS NULL AND target_date IS NULL AND snoozed_until IS NULL)
    OR (weekday IS NULL AND occurrence IS NULL AND after_full_week = 0 AND week_starts_on = 0 AND (
    (schedule_type = 'interval' AND kind = 'task' AND interval_value BETWEEN 1 AND 10000 AND interval_unit IN ('days','weeks','months','years') AND anchor_date IS NOT NULL AND target_date IS NULL AND month IS NULL AND day IS NULL AND holiday_key IS NULL AND annual_anchor_date IS NULL)
    OR (interval_value IS NULL AND interval_unit IS NULL AND anchor_date IS NULL AND snoozed_until IS NULL AND (
      (schedule_type = 'fixed_date' AND kind = 'event' AND target_date IS NOT NULL AND month IS NULL AND day IS NULL AND holiday_key IS NULL AND annual_anchor_date IS NULL)
      OR (schedule_type = 'annual_date' AND kind IN ('event','birthday','anniversary','holiday') AND target_date IS NULL AND holiday_key IS NULL AND month BETWEEN 1 AND 12 AND day BETWEEN 1 AND CAST(strftime('%d', date(printf('2000-%02d-01', month), '+1 month', '-1 day')) AS INTEGER) AND (annual_anchor_date IS NULL OR (kind = 'event' AND CAST(substr(annual_anchor_date,6,2) AS INTEGER) = month AND CAST(substr(annual_anchor_date,9,2) AS INTEGER) = day)))
      OR (schedule_type = 'holiday_rule' AND kind = 'holiday' AND target_date IS NULL AND month IS NULL AND day IS NULL AND annual_anchor_date IS NULL AND holiday_key IN ('new-year','mlk-day','valentines','presidents-day','memorial-day','independence-day','labor-day','halloween','thanksgiving','christmas'))
    )))), 0)`)),
  index("events_active_dashboard").on(t.showOnDashboard, t.id).where(sql`${t.archivedAt} IS NULL AND ${t.deletedAt} IS NULL`),
  index("events_active_display").on(t.showOnDisplay, t.scheduleType, t.id).where(sql`${t.archivedAt} IS NULL AND ${t.deletedAt} IS NULL`),
  index("events_active_notifications").on(t.notifyDueToday, t.id).where(sql`${t.archivedAt} IS NULL AND ${t.deletedAt} IS NULL`),
]);
export const completions = sqliteTable("completions", {
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "restrict" }), id: text("id").notNull(),
  completedOn: text("completed_on").notNull(), recordedAt: text("recorded_at"), updatedAt: text("updated_at"),
  source: text("source").notNull(), voidedAt: text("voided_at"),
}, (t) => [primaryKey({ columns: [t.eventId, t.id] }), check("completions_date", validDateSql("completed_on")),
  check("completions_id", sql`length(trim(${t.id})) BETWEEN 1 AND 128 AND ${t.id} = trim(${t.id})`),
  check("completions_source", sql`${t.source} IN ('recorded','legacy_last_completed')`),
  index("completions_active_dates").on(t.eventId, t.completedOn, t.id).where(sql`${t.voidedAt} IS NULL`),
]);
export const installationSettings = sqliteTable("installation_settings", {
  id: integer("id").primaryKey(), schemaVersion: integer("schema_version").notNull().default(2), defaultTimeZone: text("default_time_zone").notNull().default("UTC"),
  storageMode: text("storage_mode").notNull().default("legacy"), importState: text("import_state").notNull().default("empty"), activeRunId: text("active_run_id"),
}, (t) => [check("installation_singleton", sql`${t.id} = 1`), check("installation_modes", sql`${t.storageMode} IN ('legacy','rows') AND ${t.importState} IN ('empty','importing','ready')`)]);
export const migrationRuns = sqliteTable("migration_runs", {
  id: text("id").primaryKey(), sourceRevision: integer("source_revision").notNull(), sourceHash: text("source_hash").notNull(), converterVersion: integer("converter_version").notNull(),
  expectedEvents: integer("expected_events").notNull(), expectedCompletions: integer("expected_completions").notNull(), expectedChunks: integer("expected_chunks").notNull(),
  importedAt: text("imported_at").notNull(), completedAt: text("completed_at"), endSequence: integer("end_sequence"), reportJson: text("report_json").notNull(),
});
export const migrationChunks = sqliteTable("migration_chunks", {
  runId: text("run_id").notNull().references(() => migrationRuns.id), chunkNumber: integer("chunk_number").notNull(), checksum: text("checksum").notNull(),
}, (t) => [primaryKey({ columns: [t.runId, t.chunkNumber] })]);
export const mutations = sqliteTable("mutations", {
  id: text("id").primaryKey(), eventId: text("event_id").notNull(), expectedVersion: integer("expected_version").notNull(), operation: text("operation").notNull(),
  requestHash: text("request_hash").notNull(), createdAt: text("created_at").notNull(), responseJson: text("response_json"), sequence: integer("sequence"),
}, (t) => [index("mutations_event_sequence").on(t.eventId, t.sequence)]);
export const changes = sqliteTable("changes", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }), mutationId: text("mutation_id").references(() => mutations.id), importRunId: text("import_run_id").references(() => migrationRuns.id),
  eventId: text("event_id").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
  beforeJson: text("before_json"), afterJson: text("after_json").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [check("changes_origin", sql`(${t.mutationId} IS NULL) <> (${t.importRunId} IS NULL)`),
  check("changes_json", sql`json_valid(${t.afterJson}) AND (${t.beforeJson} IS NULL OR json_valid(${t.beforeJson}))`),
  check("changes_entity", sql`${t.entityType} IN ('event','completion')`),
  index("changes_event_sequence").on(t.eventId, t.sequence), index("changes_mutation").on(t.mutationId, t.sequence),
]);
