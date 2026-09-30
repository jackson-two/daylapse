import type { TrackedItem } from "./household-schema";
import { daysBetween, dueDate } from "./item-dates";

export function dashboardWindowDays(item: TrackedItem): number | null {
  // Missing legacy celebration settings retain their 60-day default. Explicit
  // null means the owner cleared the limit; it must survive persistence.
  return item.showOnMainWithinDays === undefined
    ? item.source ? 60 : null
    : item.showOnMainWithinDays;
}

export function isDashboardVisible(item: TrackedItem, day: Date): boolean {
  if (item.archived || item.deletedAt || item.showOnDashboard === false) return false;
  // Annual occasions stay discoverable year-round. The explicit destination
  // switch above still controls whether the household wants to see them.
  if (item.source) return true;
  const window = dashboardWindowDays(item);
  return window === null || daysBetween(day, dueDate(item, day)) <= window;
}
