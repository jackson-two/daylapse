import type { TrackedItem, Unit, WeekdayRule } from "./household-schema";
import { latestCompletion } from "./item-mutations";

const DAY = 86_400_000;

const pad = (value: number) => String(value).padStart(2, "0");
export const toISO = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const fromISO = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
};
export const today = () => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
};
export const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12);
export const daysBetween = (start: Date, end: Date) => Math.round((end.getTime() - start.getTime()) / DAY);

function nthWeekday(year: number, month: number, weekday: number, occurrence: number) {
  const first = new Date(year, month, 1, 12);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (occurrence - 1) * 7, 12);
}

function lastWeekday(year: number, month: number, weekday: number) {
  const last = new Date(year, month + 1, 0, 12);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset, 12);
}

/** Null means this occurrence does not exist in the selected month that year. */
export function weekdayHolidayDate(rule: WeekdayRule, year: number): Date | null {
  const first = new Date(year, rule.month - 1, 1, 12);
  const start = rule.afterFullWeek
    ? addDays(first, (rule.weekStartsOn - first.getDay() + 7) % 7 + 7)
    : first;
  const date = addDays(start, (rule.weekday - start.getDay() + 7) % 7 + (rule.occurrence - 1) * 7);
  return date.getMonth() === rule.month - 1 ? date : null;
}

export function nextWeekdayHolidayDate(rule: WeekdayRule, now = today(), previous = false): Date {
  // Gregorian calendars repeat every 400 years. Missing occurrences skip the year.
  for (let offset = 0; offset < 400; offset++) {
    const date = weekdayHolidayDate(rule, now.getFullYear() + (previous ? -offset : offset));
    if (date && (previous ? date <= now : date >= now)) return date;
  }
  throw new Error("This weekday rule has no occurrence.");
}

export function holidayDate(key: string, year: number) {
  switch (key) {
    case "new-year": return new Date(year, 0, 1, 12);
    case "mlk-day": return nthWeekday(year, 0, 1, 3);
    case "valentines": return new Date(year, 1, 14, 12);
    case "presidents-day": return nthWeekday(year, 1, 1, 3);
    case "memorial-day": return lastWeekday(year, 4, 1);
    case "independence-day": return new Date(year, 6, 4, 12);
    case "labor-day": return nthWeekday(year, 8, 1, 1);
    case "halloween": return new Date(year, 9, 31, 12);
    case "thanksgiving": return nthWeekday(year, 10, 4, 4);
    case "christmas": return new Date(year, 11, 25, 12);
    default: return new Date(year, 0, 1, 12);
  }
}

export function nextHolidayDate(key: string, now = today()) {
  let date = holidayDate(key, now.getFullYear());
  if (date < now) date = holidayDate(key, now.getFullYear() + 1);
  return date;
}

function dateFromMonthDay(monthDay: string, year: number) {
  const [month, day] = monthDay.split("-").map(Number);
  const lastDay = new Date(year, month, 0, 12).getDate();
  return new Date(year, month - 1, Math.min(day, lastDay), 12);
}

function itemMonthDay(item: TrackedItem) {
  return item.monthDay || item.targetDate?.slice(5) || item.createdAt.slice(5);
}

function nextAnnualDate(item: TrackedItem, now: Date) {
  if (item.weekdayRule) return nextWeekdayHolidayDate(item.weekdayRule, now);
  if (item.holidayKey) return nextHolidayDate(item.holidayKey, now);
  let date = dateFromMonthDay(itemMonthDay(item), now.getFullYear());
  if (date < now) date = dateFromMonthDay(itemMonthDay(item), now.getFullYear() + 1);
  return date;
}

export function previousAnnualDate(item: TrackedItem, now = today()) {
  if (item.weekdayRule) return nextWeekdayHolidayDate(item.weekdayRule, now, true);
  if (item.holidayKey) {
    let date = holidayDate(item.holidayKey, now.getFullYear());
    if (date > now) date = holidayDate(item.holidayKey, now.getFullYear() - 1);
    return date;
  }
  let date = dateFromMonthDay(itemMonthDay(item), now.getFullYear());
  if (date > now) date = dateFromMonthDay(itemMonthDay(item), now.getFullYear() - 1);
  return date;
}

export function addInterval(date: Date, value: number, unit: Unit) {
  if (unit === "days") return addDays(date, value);
  if (unit === "weeks") return addDays(date, value * 7);
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  if (unit === "months") result.setMonth(result.getMonth() + value);
  else result.setFullYear(result.getFullYear() + value);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  result.setHours(12, 0, 0, 0);
  return result;
}

export function intervalDays(item: TrackedItem, from?: Date) {
  const start = from ?? fromISO(latestCompletion(item) || item.createdAt);
  return Math.max(1, daysBetween(start, addInterval(start, item.intervalValue, item.intervalUnit)));
}

export function dueDate(item: TrackedItem, now = today()) {
  if (item.type === "fixed") {
    if (item.source) return nextAnnualDate(item, now);
    const target = fromISO(item.targetDate || item.createdAt);
    if (item.annual) {
      while (target < now) target.setFullYear(target.getFullYear() + 1);
    }
    return target;
  }
  if (item.snoozedUntil) return fromISO(item.snoozedUntil);
  return addInterval(fromISO(latestCompletion(item) || item.createdAt), item.intervalValue, item.intervalUnit);
}
