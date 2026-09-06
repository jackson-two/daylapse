import { z } from "zod";
import { maxWeekdayOccurrence } from "./holiday-rules";
import { trackedItemSchema } from "./household-schema";

export const rowId = z.string().min(1).max(128).refine((s) => s === s.trim(), "Invalid identifier");
export const calendarDate = trackedItemSchema.shape.createdAt;
const nullableDate = calendarDate.nullable().default(null);
const timestamp = z.iso.datetime();
const nullableText = (length: number) => z.string().max(length).nullable().default(null);
export const eventFieldsSchema = z.strictObject({
  title: z.string().max(200).refine((s) => !!s.trim(), "Title is required"),
  verb: nullableText(80), category: nullableText(80), notes: nullableText(10_000),
  kind: z.enum(["task", "event", "birthday", "anniversary", "holiday"]),
  scheduleType: z.enum(["interval", "fixed_date", "annual_date", "holiday_rule", "weekday_rule"]),
  intervalValue: z.number().int().min(1).max(10_000).nullable().default(null),
  intervalUnit: z.enum(["days", "weeks", "months", "years"]).nullable().default(null),
  anchorDate: nullableDate, targetDate: nullableDate,
  month: z.number().int().min(1).max(12).nullable().default(null),
  day: z.number().int().min(1).max(31).nullable().default(null),
  // Preserve the old ordinary-event annual rollover, including its start year.
  annualAnchorDate: nullableDate,
  holidayKey: trackedItemSchema.shape.holidayKey.unwrap().nullable().default(null),
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  occurrence: z.number().int().min(1).max(5).nullable().default(null),
  afterFullWeek: z.boolean().default(false),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(0),
  snoozedUntil: nullableDate,
  highlightWithinDays: z.number().int().min(0).max(3650).default(7),
  showOnDashboard: z.boolean().default(true), showOnDisplay: z.boolean().default(true),
  notifyDueToday: z.boolean().default(true),
  dashboardWindowDays: z.number().int().min(0).max(3650).nullable().default(null),
  archivedAt: timestamp.nullable().default(null),
});
export const validSchedule = (e: z.output<typeof eventFieldsSchema>) => {
  if (e.scheduleType === "weekday_rule") return e.kind === "holiday" && e.month !== null && e.weekday !== null && e.occurrence !== null
    && (e.occurrence <= maxWeekdayOccurrence({ ...e, month: e.month, weekday: e.weekday })) && e.day === null && e.holidayKey === null && e.annualAnchorDate === null
    && e.intervalValue === null && e.intervalUnit === null && e.anchorDate === null && e.targetDate === null && e.snoozedUntil === null;
  if (e.weekday !== null || e.occurrence !== null || e.afterFullWeek || e.weekStartsOn !== 0) return false;
  const interval = e.intervalValue !== null && e.intervalUnit !== null && e.anchorDate !== null;
  const noInterval = e.intervalValue === null && e.intervalUnit === null && e.anchorDate === null;
  const noAnnual = e.month === null && e.day === null && e.annualAnchorDate === null;
  if (e.scheduleType === "interval") return e.kind === "task" && interval && e.targetDate === null && noAnnual && e.holidayKey === null;
  if (!noInterval || e.kind === "task" || e.snoozedUntil !== null) return false;
  if (e.scheduleType === "fixed_date") return e.kind === "event" && e.targetDate !== null && noAnnual && e.holidayKey === null;
  if (e.scheduleType === "holiday_rule") return e.kind === "holiday" && e.holidayKey !== null && e.targetDate === null && noAnnual;
  return e.targetDate === null && e.holidayKey === null && e.month !== null && e.day !== null
    && e.day <= new Date(Date.UTC(2000, e.month, 0)).getUTCDate()
    && (e.annualAnchorDate === null || (e.kind === "event" && Number(e.annualAnchorDate.slice(5, 7)) === e.month && Number(e.annualAnchorDate.slice(8)) === e.day));
};
export const eventRecordSchema = eventFieldsSchema.extend({
  id: rowId, createdOn: calendarDate, createdAt: timestamp.nullable(), updatedAt: timestamp,
  importPosition: z.number().int().nonnegative().nullable().default(null),
  deletedAt: timestamp.nullable(), version: z.number().int().positive(),
}).refine(validSchedule, "Schedule fields do not match the event kind and schedule type");
export type EventRecord = z.output<typeof eventRecordSchema>;
export const completionSchema = z.strictObject({
  eventId: rowId, id: rowId, completedOn: calendarDate,
  recordedAt: timestamp.nullable(), updatedAt: timestamp.nullable(),
  source: z.enum(["recorded", "legacy_last_completed"]), voidedAt: timestamp.nullable(),
});
export type CompletionRecord = z.output<typeof completionSchema>;
const envelope = { mutationId: rowId, expectedVersion: z.number().int().positive() };
// Zod defaults inside optional fields would reset omitted PATCH values.
export const eventPatchSchema = z.strictObject(Object.fromEntries(Object.entries(eventFieldsSchema.shape).map(([key, field]) =>
  [key, (field instanceof z.ZodDefault ? field.removeDefault() : field).optional()]))).refine((p) => Object.keys(p).length > 0, "Supply at least one field");
export const createEventRequest = z.strictObject({ mutationId: rowId, event: eventFieldsSchema.extend({ id: rowId, createdOn: calendarDate }).refine(validSchedule, "Invalid schedule") });
export const patchEventRequest = z.strictObject({ ...envelope, patch: eventPatchSchema });
export const versionRequest = z.strictObject(envelope);
export const createCompletionRequest = z.strictObject({ ...envelope, completion: z.strictObject({ id: rowId, completedOn: calendarDate }) });
export const patchCompletionRequest = z.strictObject({ ...envelope, completedOn: calendarDate });
export const restoreEventRequest = z.strictObject({ ...envelope, sequence: z.number().int().positive().optional() });

export const eventColumns = {
  id: "id", title: "title", verb: "verb", category: "category", notes: "notes", kind: "kind",
  scheduleType: "schedule_type", intervalValue: "interval_value", intervalUnit: "interval_unit", anchorDate: "anchor_date",
  targetDate: "target_date", month: "month", day: "day", annualAnchorDate: "annual_anchor_date", holidayKey: "holiday_key",
  weekday: "weekday", occurrence: "occurrence", afterFullWeek: "after_full_week", weekStartsOn: "week_starts_on",
  snoozedUntil: "snoozed_until", highlightWithinDays: "highlight_within_days", showOnDashboard: "show_on_dashboard",
  showOnDisplay: "show_on_display", notifyDueToday: "notify_due_today", dashboardWindowDays: "dashboard_window_days",
  archivedAt: "archived_at", deletedAt: "deleted_at", createdOn: "created_on", createdAt: "created_at", updatedAt: "updated_at", version: "version", importPosition: "import_position",
} as const;
export const completionColumns = { eventId: "event_id", id: "id", completedOn: "completed_on", recordedAt: "recorded_at", updatedAt: "updated_at", source: "source", voidedAt: "voided_at" } as const;
export function selectColumns(columns: Record<string, string>, alias = "") {
  return Object.entries(columns).map(([key, column]) => `${alias}${column} AS "${key}"`).join(", ");
}
export function parseEventRow(row: Record<string, unknown>): EventRecord {
  return eventRecordSchema.parse({ ...row, afterFullWeek: !!row.afterFullWeek, showOnDashboard: !!row.showOnDashboard, showOnDisplay: !!row.showOnDisplay, notifyDueToday: !!row.notifyDueToday });
}

export const editEventRequest = z.strictObject({
  mutationId: rowId, expectedVersion: z.number().int().nonnegative(),
  event: createEventRequest.shape.event.optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
  edits: z.array(z.strictObject({ id: rowId, completedOn: calendarDate.nullable() })).max(100).default([]),
}).refine((v) => new Set(v.edits.map((e) => e.id)).size === v.edits.length, "Duplicate completion IDs");
