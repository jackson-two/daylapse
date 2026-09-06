import { dueDate, fromISO, toISO } from "./item-dates";
import type { TrackedItem } from "./household-schema";

export function localNotificationClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (key: string) => parts.find((p) => p.type === key)!.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

export function dueTodayItems(items: TrackedItem[], date: string) {
  const today = fromISO(date);
  return items.filter((item) => !item.archived && !item.deletedAt && item.notifyDueToday !== false && toISO(dueDate(item, today)) === date);
}

export function dueTodayMessage(items: TrackedItem[], date: string) {
  return {
    title: items.length === 1 ? "1 item is due today" : `${items.length} items are due today`,
    body: items.slice(0, 3).map((item) => item.title.slice(0, 80)).join(" · ") + (items.length > 3 ? ` · and ${items.length - 3} more` : ""),
    tag: `daylapse-due-${date}`,
    data: { url: "/", dueDate: date },
  };
}
