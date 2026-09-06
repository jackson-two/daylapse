import type { TrackedItem } from "./household-schema";
import { eventAsLegacy } from "./row-converter";
import { completionColumns, completionSchema, eventColumns, parseEventRow, selectColumns } from "./row-schema";
import { RowError, RowRepository } from "./row-repository";
import { dueDate, fromISO } from "./item-dates";
import { localNotificationClock } from "./due-notifications";

/** One atomic read batch pins rows, recent history, and sequence to the same revision. */
export async function readRowSnapshot(db: D1Database, destination: "app" | "display" | "notifications" | "export" = "app", timeZone?: string) {
  await new RowRepository(db).requireEnabled();
  const filter = destination === "display" ? "WHERE e.deleted_at IS NULL AND e.archived_at IS NULL AND e.show_on_display = 1" : destination === "notifications" ? "WHERE e.deleted_at IS NULL AND e.archived_at IS NULL AND e.notify_due_today = 1" : "";
  const result = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT ${selectColumns(eventColumns, "e.")}, (SELECT MAX(completed_on) FROM completions WHERE event_id=e.id AND voided_at IS NULL) AS lastCompleted, (SELECT COUNT(*) FROM completions WHERE event_id=e.id AND voided_at IS NULL) AS completionCount FROM events e ${filter} ORDER BY COALESCE(import_position, 2147483647), created_at, id LIMIT 501`),
    db.prepare(destination === "export"
      ? `SELECT ${selectColumns(completionColumns)} FROM completions WHERE voided_at IS NULL ORDER BY event_id, completed_on DESC, id DESC LIMIT 20001`
      : destination === "app" ? `SELECT ${selectColumns(completionColumns, "c.")} FROM completions c WHERE c.voided_at IS NULL AND c.id IN (SELECT id FROM completions WHERE event_id=c.event_id AND voided_at IS NULL ORDER BY completed_on DESC, id DESC LIMIT 6)` : `SELECT ${selectColumns(completionColumns)} FROM completions WHERE 0`),
    db.prepare("SELECT COALESCE(MAX(sequence),0) AS revision FROM changes"),
    db.prepare("SELECT default_time_zone AS timeZone FROM installation_settings WHERE id=1"),
  ]);
  if (result[0].results.length > 500 || result[1].results.length > 20000) throw new RowError(413, "snapshot_too_large", "Use the paginated event/history APIs for this dataset.");
  const completions = result[1].results.map((c) => completionSchema.parse(c));
  const records = result[0].results.map(({ lastCompleted, completionCount, ...row }) => ({ event: parseEventRow(row), lastCompleted: lastCompleted as string | null, completionCount: Number(completionCount) }));
  let items: TrackedItem[] = records.map(({event, lastCompleted, completionCount}) => ({ ...eventAsLegacy(event, completions), lastCompleted: lastCompleted ?? undefined, completionCount }));
  if (destination === "display") {
    const date = fromISO(localNotificationClock(new Date(), timeZone ?? String(result[3].results[0].timeZone)).date);
    items.sort((a,b) => dueDate(a,date).getTime()-dueDate(b,date).getTime());
    items = ["recurring", "fixed"].flatMap((type) => items.filter((i) => i.type === type).slice(0,10));
    // Explicit allowlist: do not leak notes, history, audit metadata, or hidden rows.
    items = items.map((i) => ({ id:i.id,title:i.title,verb:i.verb,category:i.category,type:i.type,intervalValue:i.intervalValue,intervalUnit:i.intervalUnit,lastCompleted:i.lastCompleted,targetDate:i.targetDate,monthDay:i.monthDay,annual:i.annual,source:i.source,holidayKey:i.holidayKey,weekdayRule:i.weekdayRule,snoozedUntil:i.snoozedUntil,reminderDays:i.reminderDays,createdAt:i.createdAt,history:[],completionCount:0 }));
  }
  return { items, revision: Number(result[2].results[0].revision), ...(destination === "app" ? { versions: Object.fromEntries(records.map(({event}) => [event.id,event.version])) } : {}) };
}
