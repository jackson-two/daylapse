import { type TrackedItem } from "./household-schema";
import { dueDate, fromISO, toISO } from "./item-dates";

export type CsvExportKind = "items" | "history";
type CsvCell = string | number | boolean | undefined;
// Quote every cell, preserve multiline notes, and keep user text from becoming
// a spreadsheet formula (including formulas hidden behind whitespace).
function csvCell(value: CsvCell) {
  let text = value === undefined ? "" : String(value);
  if (typeof value === "string" && (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text))) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows: CsvCell[][]) {
  // The BOM lets spreadsheet apps recognize UTF-8 names and notes.
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function createCsvExport(items: TrackedItem[], kind: CsvExportKind, exportedAt = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const asOf = toISO(exportedAt);
  const reportDate = fromISO(asOf);
  if (kind === "history") {
    return csv([
      ["item_id", "item_title", "completion_id", "completion_date"],
      ...items.flatMap((item) => item.history.map((entry) => [item.id, item.title, entry.id, entry.date])),
    ]);
  }
  return csv([
    [
      "id", "title", "verb", "category", "type", "next_due_date", "interval_value", "interval_unit",
      "last_completed", "target_date", "month_day", "annual", "reminder_days", "snoozed_until",
      "archived", "source", "holiday_key", "show_on_main_within_days", "created_at", "notes",
      "completion_count", "as_of_date", "time_zone", "show_on_dashboard", "show_on_display", "notify_due_today", "deleted_at",
      "holiday_month", "holiday_weekday", "holiday_occurrence", "after_first_full_week", "week_starts_on",
    ],
    ...items.map((item) => [
      item.id, item.title, item.verb, item.category, item.type, toISO(dueDate(item, reportDate)),
      item.intervalValue, item.intervalUnit, item.lastCompleted, item.targetDate, item.monthDay,
      item.annual, item.reminderDays, item.snoozedUntil, item.archived ?? false, item.source,
      item.holidayKey, item.showOnMainWithinDays ?? undefined, item.createdAt, item.notes, item.completionCount ?? item.history.length,
      asOf, timeZone, item.showOnDashboard ?? true, item.showOnDisplay ?? true, item.notifyDueToday ?? true, item.deletedAt ?? "",
      item.weekdayRule?.month, item.weekdayRule?.weekday, item.weekdayRule?.occurrence, item.weekdayRule?.afterFullWeek, item.weekdayRule?.weekStartsOn,
    ]),
  ]);
}

export async function fetchCsvExport(kind: CsvExportKind) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const response = await fetch(`/api/events/export?kind=${kind}&timeZone=${encodeURIComponent(timeZone)}`, { cache: "no-store" });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/csv")) throw new Error("Could not load saved data. Please try the download again.");
  return { content: await response.text(), filename: response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `daylapse-${kind}.csv` };
}
