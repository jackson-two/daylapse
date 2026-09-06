import { maxWeekdayOccurrence } from "@/lib/holiday-rules";
import type { WeekdayRule } from "@/lib/household-schema";
import { nextWeekdayHolidayDate, today } from "@/lib/item-dates";

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const occurrences = ["First", "Second", "Third", "Fourth", "Fifth"];

export function HolidayScheduleFields({ date, rule, onChange }: {
  date: string;
  rule?: WeekdayRule;
  onChange: (date: string, rule?: WeekdayRule) => void;
}) {
  const update = (patch: Partial<WeekdayRule>) => {
    if (!rule) return;
    const next = { ...rule, ...patch };
    onChange(date, { ...next, occurrence: Math.min(next.occurrence, maxWeekdayOccurrence(next)) });
  };
  return <fieldset className="holiday-schedule">
    <legend>Holiday date</legend>
    <label>Schedule<select value={rule ? "weekday" : "date"} onChange={(e) => onChange(date, e.target.value === "weekday"
      ? { month: Number(date.slice(5, 7)) || today().getMonth() + 1, weekday: 0, occurrence: 1, afterFullWeek: false, weekStartsOn: 0 }
      : undefined)}><option value="date">Month and day</option><option value="weekday">Nth weekday</option></select></label>
    {rule ? <>
      <label>Month<select value={rule.month} onChange={(e) => update({ month: Number(e.target.value) })}>{months.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>
      <div className="field-pair">
        <label>Occurrence<select value={rule.occurrence} onChange={(e) => update({ occurrence: Number(e.target.value) })}>{occurrences.slice(0, maxWeekdayOccurrence(rule)).map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>
        <label>Weekday<select value={rule.weekday} onChange={(e) => update({ weekday: Number(e.target.value) })}>{weekdays.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
      </div>
      <label className="check-label"><input type="checkbox" checked={rule.afterFullWeek} onChange={(e) => update({ afterFullWeek: e.target.checked, occurrence: e.target.checked ? Math.min(rule.occurrence, 4) : rule.occurrence })} /> After the first full week</label>
      {rule.afterFullWeek && <label>Full week<select value={rule.weekStartsOn} onChange={(e) => update({ weekStartsOn: Number(e.target.value) as 0 | 1 })}><option value={0}>Sunday–Saturday</option><option value={1}>Monday–Sunday</option></select><small>Count weekdays after the first complete week entirely within the month.</small></label>}
      <p className="holiday-preview" aria-live="polite">Next: {nextWeekdayHolidayDate(rule).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}. {rule.occurrence >= (rule.afterFullWeek ? 3 : 5) && "Years without this occurrence are skipped."}</p>
    </> : <label>Month and day <span>Year is not saved</span><input required type="date" value={date} onChange={(e) => onChange(e.target.value)} /></label>}
  </fieldset>;
}
