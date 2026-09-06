import { householdItemsSchema, type TrackedItem } from "./household-schema";
import { dueDate, fromISO, toISO, daysBetween } from "./item-dates";
import { latestCompletion } from "./item-mutations";
import { completionSchema, eventRecordSchema, type CompletionRecord, type EventRecord } from "./row-schema";

export const CONVERTER_VERSION = 2;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function digest(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)))), (b) => b.toString(16).padStart(2, "0")).join("");
}
export type Conversion = Awaited<ReturnType<typeof convertSnapshot>>;

/** Shared date/UI adapter. Current persistence always uses relational records. */
export function eventAsLegacy(event: EventRecord, completions: CompletionRecord[]): TrackedItem {
  const history = completions.filter((c) => c.eventId === event.id && !c.voidedAt).map((c) => ({ id: c.id, date: c.completedOn }));
  const source = event.kind === "birthday" || event.kind === "anniversary" || event.kind === "holiday" ? event.kind : undefined;
  // Ordinary new annual events use the same date policy as annual celebrations.
  const annualSource = event.scheduleType === "annual_date" && !event.annualAnchorDate ? source ?? "anniversary" : source;
  return {
    showOnDashboard: event.showOnDashboard, showOnDisplay: event.showOnDisplay, notifyDueToday: event.notifyDueToday, deletedAt: event.deletedAt,
    id: event.id, title: event.title, verb: event.verb ?? undefined, category: event.category ?? undefined, notes: event.notes ?? undefined,
    type: event.scheduleType === "interval" ? "recurring" : "fixed", source: annualSource,
    intervalValue: event.intervalValue ?? 1, intervalUnit: event.intervalUnit ?? "days",
    lastCompleted: latestCompletion({ history }), history,
    targetDate: event.targetDate ?? event.annualAnchorDate ?? undefined, annual: event.annualAnchorDate ? true : undefined,
    monthDay: event.month && event.day ? `${String(event.month).padStart(2, "0")}-${String(event.day).padStart(2, "0")}` : undefined,
    weekdayRule: event.scheduleType === "weekday_rule" ? { month: event.month!, weekday: event.weekday!, occurrence: event.occurrence!, afterFullWeek: event.afterFullWeek, weekStartsOn: event.weekStartsOn } : undefined,
    holidayKey: event.holidayKey ?? undefined, snoozedUntil: event.snoozedUntil ?? undefined,
    reminderDays: event.highlightWithinDays, archived: !!(event.archivedAt || event.deletedAt),
    showOnMainWithinDays: event.dashboardWindowDays, createdAt: event.anchorDate ?? event.createdOn,
  };
}

export function behaviorSnapshot(items: TrackedItem[], asOf: string) {
  const date = fromISO(asOf);
  const sorted = (list: TrackedItem[]) => [...list].sort((a, b) => dueDate(a, date).getTime() - dueDate(b, date).getTime()).map((i) => i.id);
  return {
    dates: items.map((item) => ({ id: item.id, due: toISO(dueDate(item, date)), lastCompleted: latestCompletion(item) ?? null, snooze: item.type === "recurring" ? item.snoozedUntil ?? null : null, archived: !!item.archived })),
    dashboard: sorted(items.filter((i) => !i.archived && (!i.source || i.showOnMainWithinDays === null || daysBetween(date, dueDate(i, date)) <= (i.showOnMainWithinDays ?? 60)))),
    displayHousehold: sorted(items.filter((i) => !i.archived && i.type === "recurring")).slice(0, 10),
    displayEvents: sorted(items.filter((i) => !i.archived && i.type === "fixed")).slice(0, 10),
    dueToday: items.filter((i) => !i.archived && toISO(dueDate(i, date)) === asOf).map((i) => i.id),
  };
}

export async function convertSnapshot(input: { items: unknown; revision: number }, importedAt: string, dates: string[]) {
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || !dates.length) throw new Error("A source revision and comparison dates are required");
  const items = householdItemsSchema.parse(input.items);
  const events: EventRecord[] = [], completions: CompletionRecord[] = [];
  const warnings: { eventId: string; code: string }[] = [];
  for (const item of items) {
    const source = item.source;
    const scheduleType = item.type === "recurring" ? "interval" : item.weekdayRule ? "weekday_rule" : item.holidayKey ? "holiday_rule" : source || item.annual ? "annual_date" : "fixed_date";
    const monthDay = item.monthDay ?? item.targetDate?.slice(5);
    const annualAnchorDate = !source && item.annual ? item.targetDate : null;
    if (source && item.annual) warnings.push({ eventId: item.id, code: "ignored_legacy_annual_flag_on_celebration" });
    if (item.type === "fixed") warnings.push({ eventId: item.id, code: "irrelevant_fixed_interval_fields_omitted" });
    if (item.type === "fixed" && item.snoozedUntil) warnings.push({ eventId: item.id, code: "ignored_fixed_snooze_omitted" });
    if (item.type === "recurring" && (item.annual || item.targetDate || item.monthDay)) warnings.push({ eventId: item.id, code: "ignored_recurring_date_fields_omitted" });
    if (annualAnchorDate) warnings.push({ eventId: item.id, code: "legacy_annual_rollover_preserved" });
    events.push(eventRecordSchema.parse({
      id: item.id, title: item.title, verb: item.verb ?? null, category: item.category ?? null, notes: item.notes ?? null,
      kind: source ?? (item.type === "recurring" ? "task" : "event"), scheduleType,
      intervalValue: item.type === "recurring" ? item.intervalValue : null, intervalUnit: item.type === "recurring" ? item.intervalUnit : null,
      anchorDate: item.type === "recurring" ? item.createdAt : null, targetDate: scheduleType === "fixed_date" ? item.targetDate : null,
      month: item.weekdayRule?.month ?? (scheduleType === "annual_date" ? Number((annualAnchorDate?.slice(5) ?? monthDay)?.slice(0, 2)) : null),
      day: scheduleType === "annual_date" ? Number((annualAnchorDate?.slice(5) ?? monthDay)?.slice(3)) : null,
      annualAnchorDate: annualAnchorDate ?? null, holidayKey: item.holidayKey ?? null,
      weekday: item.weekdayRule?.weekday ?? null, occurrence: item.weekdayRule?.occurrence ?? null,
      afterFullWeek: item.weekdayRule?.afterFullWeek ?? false, weekStartsOn: item.weekdayRule?.weekStartsOn ?? 0,
      snoozedUntil: item.type === "recurring" ? item.snoozedUntil ?? null : null,
      highlightWithinDays: item.reminderDays, dashboardWindowDays: source ? item.showOnMainWithinDays === undefined ? 60 : item.showOnMainWithinDays : null,
      archivedAt: item.archived ? importedAt : null, deletedAt: null,
      createdOn: item.createdAt, createdAt: null, updatedAt: importedAt, version: 1,
      importPosition: events.length,
    }));
    for (const entry of item.history) completions.push(completionSchema.parse({ eventId: item.id, id: entry.id, completedOn: entry.date, recordedAt: null, updatedAt: null, source: "recorded", voidedAt: null }));
    if (item.lastCompleted && !item.history.some((entry) => entry.date === item.lastCompleted)) {
      let id = `legacy-${item.lastCompleted}`, suffix = 0;
      while (item.history.some((entry) => entry.id === id)) id = `legacy-${item.lastCompleted}-${++suffix}`;
      completions.push(completionSchema.parse({ eventId: item.id, id, completedOn: item.lastCompleted, recordedAt: null, updatedAt: null, source: "legacy_last_completed", voidedAt: null }));
      warnings.push({ eventId: item.id, code: "synthetic_legacy_completion" });
    }
  }
  const reconstructed = events.map((event) => eventAsLegacy(event, completions));
  const comparisons = dates.map((date) => {
    // Validate comparison dates through the same strict date validator.
    eventRecordSchema.shape.createdOn.parse(date);
    return { date, equal: canonical(behaviorSnapshot(items, date)) === canonical(behaviorSnapshot(reconstructed, date)) };
  });
  if (comparisons.some((c) => !c.equal)) throw new Error(`Migration behavior differs on ${comparisons.filter((c) => !c.equal).map((c) => c.date).join(", ")}; import blocked`);
  const sourceHash = await digest({ items, revision: input.revision, converter: CONVERTER_VERSION });
  const report = {
    sourceRevision: input.revision, sourceHash, converterVersion: CONVERTER_VERSION,
    eventCount: events.length, originalCompletionCount: items.reduce((n, i) => n + i.history.length, 0),
    completionCount: completions.length, syntheticCompletions: completions.filter((c) => c.source === "legacy_last_completed").length,
    archivedCount: items.filter((i) => i.archived).length, warnings, comparisons,
    // A CSV history export gains only the explicitly marked synthetic records.
    preservedHistory: items.every((i) => i.history.every((h) => completions.some((c) => c.eventId === i.id && c.id === h.id && c.completedOn === h.date))),
    preservedText: items.every((i, index) => events[index].title === i.title && events[index].notes === (i.notes ?? null) && events[index].verb === (i.verb ?? null) && events[index].category === (i.category ?? null)),
  };
  return { events, completions, importedAt, report, runId: `v${CONVERTER_VERSION}-${sourceHash}` };
}
