/** Maximum occurrence that can fit in this month in at least one calendar year. */
export function maxWeekdayOccurrence(rule: { month: number; weekday: number; afterFullWeek: boolean; weekStartsOn: number }) {
  if (!rule.afterFullWeek) return 5;
  const longestMonth = new Date(Date.UTC(2000, rule.month, 0)).getUTCDate();
  const earliest = 8 + (rule.weekday - rule.weekStartsOn + 7) % 7;
  return Math.floor((longestMonth - earliest) / 7) + 1;
}
