import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { trackedItemSchema, weekdayRuleSchema, type TrackedItem, type WeekdayRule } from "../lib/household-schema";
import { dueDate, fromISO, nextWeekdayHolidayDate, previousAnnualDate, toISO, weekdayHolidayDate } from "../lib/item-dates";
import { itemFields } from "../lib/row-transport";
import { eventRecordSchema } from "../lib/row-schema";
import { eventAsLegacy } from "../lib/row-converter";
import { dueTodayItems } from "../lib/due-notifications";
import { createCsvExport } from "../lib/csv-export";
import { openLocalRows } from "../scripts/row-storage-local";
import { RowRepository } from "../lib/row-repository";
import { readRowSnapshot } from "../lib/row-consumers";

const rule: WeekdayRule = { month: 9, weekday: 1, occurrence: 1, afterFullWeek: false, weekStartsOn: 0 };
const holiday: TrackedItem = { id: "reunion", title: "Reunion", type: "fixed", source: "holiday", weekdayRule: rule, intervalValue: 1, intervalUnit: "years", history: [], reminderDays: 30, createdAt: "2026-01-01" };

test("Nth weekdays, first full weeks, missing occurrences, and annual boundaries", () => {
  assert.equal(toISO(weekdayHolidayDate(rule, 2026)!), "2026-09-07");
  assert.equal(toISO(weekdayHolidayDate({ ...rule, afterFullWeek: true }, 2026)!), "2026-09-14");
  // September 2026 starts Tuesday: the first full Sunday week is September 6–12.
  assert.equal(toISO(weekdayHolidayDate({ ...rule, weekday: 0, afterFullWeek: true }, 2026)!), "2026-09-13");
  assert.equal(toISO(weekdayHolidayDate({ ...rule, weekday: 0, afterFullWeek: true, weekStartsOn: 1 }, 2026)!), "2026-09-20");
  // A month starting on the first day of the week counts that initial week.
  assert.equal(toISO(weekdayHolidayDate({ ...rule, month: 2, weekday: 0, afterFullWeek: true }, 2026)!), "2026-02-08");
  assert.equal(toISO(weekdayHolidayDate({ ...rule, month: 6, afterFullWeek: true, weekStartsOn: 1 }, 2026)!), "2026-06-08");
  const fifth = { ...rule, month: 2, occurrence: 5 };
  assert.equal(weekdayHolidayDate(fifth, 2026), null);
  assert.equal(toISO(nextWeekdayHolidayDate(fifth, fromISO("2026-01-01"))), "2044-02-29");
  assert.equal(toISO(dueDate(holiday, fromISO("2026-09-07"))), "2026-09-07");
  assert.equal(toISO(dueDate(holiday, fromISO("2026-09-08"))), "2027-09-06");
  assert.equal(toISO(previousAnnualDate(holiday, fromISO("2026-09-06"))), "2025-09-01");
  assert.equal(toISO(previousAnnualDate(holiday, fromISO("2026-09-07"))), "2026-09-07");
});

test("rule validation rejects conflicting schedules and impossible inputs", () => {
  assert.ok(trackedItemSchema.safeParse(holiday).success);
  for (const patch of [{ month: 0 }, { weekday: 7 }, { occurrence: 0 }, { occurrence: 6 }, { occurrence: 5, afterFullWeek: true }, { occurrence: 4, weekday: 6, afterFullWeek: true }]) {
    assert.equal(weekdayRuleSchema.safeParse({ ...rule, ...patch }).success, false);
  }
  for (const patch of [{ source: "birthday" }, { holidayKey: "thanksgiving" }, { monthDay: "01-01" }]) {
    assert.equal(trackedItemSchema.safeParse({ ...holiday, ...patch }).success, false);
  }
  const row = eventRecordSchema.parse({ ...itemFields(holiday), id: holiday.id, createdOn: holiday.createdAt, createdAt: null, updatedAt: "2026-09-05T12:00:00.000Z", deletedAt: null, version: 1 });
  assert.deepEqual(eventAsLegacy(row, []).weekdayRule, rule);
  assert.equal(eventRecordSchema.safeParse({ ...row, scheduleType: "annual_date", day: 7 }).success, false);
});

test("every offered full-week rule occurs within a Gregorian calendar cycle", () => {
  for (let month = 1; month <= 12; month++) for (let weekday = 0; weekday < 7; weekday++) {
    for (const weekStartsOn of [0, 1] as const) for (let occurrence = 1; occurrence <= 5; occurrence++) {
      const candidate = { month, weekday, occurrence, afterFullWeek: true, weekStartsOn };
      const exists = Array.from({ length: 400 }, (_, i) => weekdayHolidayDate(candidate, 2000 + i)).some(Boolean);
      assert.equal(weekdayRuleSchema.safeParse(candidate).success, exists, JSON.stringify(candidate));
    }
  }
});

test("populated D1 migration preserves events, completions, receipts, and history; rules survive consumers and edits", async (t) => {
  const { db, mf } = await openLocalRows(undefined, 6);
  t.after(() => mf.dispose());
  await db.prepare("UPDATE installation_settings SET import_state='ready', storage_mode='rows'").run();
  // Use the actual old schema and rows before applying the schedule migration.
  await db.prepare("INSERT INTO events(id,title,kind,schedule_type,anchor_date,interval_value,interval_unit,created_on,updated_at) VALUES ('task','Filter','task','interval','2026-01-01',1,'months','2026-01-01','2026-01-01T00:00:00.000Z')").run();
  await db.prepare("INSERT INTO completions(event_id,id,completed_on,source) VALUES ('task','done','2026-02-01','recorded')").run();
  await db.prepare("INSERT INTO mutations(id,event_id,expected_version,operation,request_hash,created_at) VALUES ('old-edit','task',1,'patch','old-hash','2026-02-01T00:00:00.000Z')").run();
  const oldRow = { ...itemFields({ ...holiday, id: "task", title: "Filter", type: "recurring", source: undefined, weekdayRule: undefined, intervalUnit: "months" }), id: "task", createdOn: "2026-01-01", createdAt: null, updatedAt: "2026-02-01T00:00:00.000Z", version: 1, deletedAt: null } as Record<string, unknown>;
  for (const field of ["weekday", "occurrence", "afterFullWeek", "weekStartsOn"]) delete oldRow[field];
  await db.prepare("INSERT INTO changes(mutation_id,event_id,entity_type,entity_id,after_json,created_at) VALUES ('old-edit','task','event','task',?,'2026-02-01T00:00:00.000Z')").bind(JSON.stringify(oldRow)).run();
  await db.prepare("UPDATE mutations SET response_json=?, sequence=1 WHERE id='old-edit'").bind(JSON.stringify({ event: oldRow })).run();
  const tables = ["events", "completions", "changes", "mutations"];
  const before = await Promise.all(tables.map(async (name) => (await db.prepare(`SELECT * FROM ${name}`).all()).results));
  const sql = await readFile(new URL("../drizzle/0007_condemned_captain_flint.sql", import.meta.url), "utf8");
  await db.batch(sql.split("--> statement-breakpoint").map((s) => db.prepare(s.trim())));
  for (const [i, name] of tables.entries()) {
    const after = (await db.prepare(`SELECT * FROM ${name}`).all<Record<string, unknown>>()).results;
    if (name === "events") for (const row of after) for (const field of ["weekday", "occurrence", "after_full_week", "week_starts_on"]) delete row[field];
    assert.deepEqual(after, before[i]);
  }
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  const repository = new RowRepository(db);
  assert.equal((await repository.readRevision("task", 1)).event.afterFullWeek, false);
  const created = await repository.mutate({ operation: "create", mutationId: "create-holiday", eventId: holiday.id, expectedVersion: 0, event: { ...itemFields(holiday), id: holiday.id, createdOn: holiday.createdAt } });
  assert.deepEqual(eventAsLegacy(created.event, []).weekdayRule, rule);
  for (const destination of ["family", "display", "notifications", "export"] as const) {
    const snapshot = await readRowSnapshot(db, destination === "family" ? undefined : destination);
    const saved = snapshot.items.find((item) => item.id === holiday.id)!;
    assert.deepEqual(saved.weekdayRule, rule);
    assert.equal(dueTodayItems([saved], "2026-09-07").length, 1);
    assert.equal(dueTodayItems([saved], "2026-09-08").length, 0);
    assert.equal(toISO(dueDate(saved, fromISO("2026-09-07"))), "2026-09-07");
    assert.match(createCsvExport([saved], "items", fromISO("2026-09-07")), /"2026-09-07"/);
  }
  const edited = await repository.mutate({ operation: "patch", mutationId: "edit-holiday", eventId: holiday.id, expectedVersion: 1, patch: { afterFullWeek: true } });
  assert.equal(toISO(dueDate(eventAsLegacy(edited.event, []), fromISO("2026-09-07"))), "2026-09-14");
  await assert.rejects(() => db.prepare("UPDATE events SET occurrence=5 WHERE id='reunion'").run(), /CHECK constraint/);
  await assert.rejects(() => db.prepare("DELETE FROM events WHERE id='task'").run(), /FOREIGN KEY/);
  const fixed = { ...holiday, weekdayRule: undefined, monthDay: "12-25" };
  const changed = await repository.mutate({ operation: "patch", mutationId: "fixed-holiday", eventId: holiday.id, expectedVersion: 2, patch: itemFields(fixed) });
  assert.equal(changed.event.scheduleType, "annual_date");
  assert.equal(changed.event.weekday, null);
});
