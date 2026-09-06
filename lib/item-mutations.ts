import type { HistoryEntry, TrackedItem } from "./household-schema";

export function latestCompletion(item: Pick<TrackedItem, "lastCompleted" | "history">) {
  return item.history.reduce<string | undefined>((latest, entry) =>
    !latest || entry.date > latest ? entry.date : latest, item.lastCompleted);
}

export function recordCompletion(item: TrackedItem, entry: HistoryEntry): TrackedItem {
  const lastCompleted = latestCompletion({ ...item, history: [...item.history, entry] });
  return {
    ...item,
    lastCompleted,
    // Backfilling old history must not cancel an existing snooze.
    snoozedUntil: entry.date >= (latestCompletion(item) ?? "") ? undefined : item.snoozedUntil,
    history: [...item.history, entry].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function removeLatestCompletion(item: TrackedItem): TrackedItem {
  const latest = latestCompletion(item);
  const target = item.history.find((entry) => entry.date === latest);
  const history = target ? item.history.filter((entry) => entry.id !== target.id) : item.history;
  return { ...item, history, lastCompleted: latestCompletion({ history }), snoozedUntil: undefined };
}

export function normalizeStoredItem(item: TrackedItem): TrackedItem {
  if (!item.source) return item.type === "recurring" ? { ...item, lastCompleted: latestCompletion(item) } : item;
  const normalized = { ...item, monthDay: (item.holidayKey || item.weekdayRule) ? undefined : item.monthDay || item.targetDate?.slice(5) };
  delete normalized.verb;
  delete normalized.annual;
  delete normalized.targetDate;
  return normalized;
}

// A leap-year date is only an input representation; recurring month/day stays
// independent of the next occurrence (which can be clamped in non-leap years).
export function annualEditDate(item: TrackedItem) {
  const monthDay = item.monthDay || item.targetDate?.slice(5);
  return monthDay ? `2000-${monthDay}` : undefined;
}

export function applyItemEdit(original: TrackedItem, draft: TrackedItem): TrackedItem {
  if (draft.source) {
    return normalizeStoredItem({ ...draft, monthDay: draft.targetDate?.slice(5) || draft.monthDay });
  }
  if (draft.type !== "recurring") return draft;
  if (draft.lastCompleted === original.lastCompleted) return normalizeStoredItem(draft);
  // Editing "last completed" corrects the latest record, rather than leaving a
  // contradictory date in history. Older entries remain intact.
  const latest = latestCompletion(original);
  const target = original.history.find((entry) => entry.date === latest);
  const history = draft.history.filter((entry) => entry.id !== target?.id);
  if (draft.lastCompleted) history.push({ id: target?.id ?? crypto.randomUUID(), date: draft.lastCompleted });
  return normalizeStoredItem({ ...draft, history, lastCompleted: undefined, snoozedUntil: undefined });
}
