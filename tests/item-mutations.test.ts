import assert from "node:assert/strict";
import test from "node:test";
import { annualEditDate, applyItemEdit, recordCompletion, removeLatestCompletion } from "../lib/item-mutations";
import { dueDate, fromISO, toISO } from "../lib/item-dates";
import type { TrackedItem } from "../lib/household-schema";

const item: TrackedItem = { id: "filter", title: "Filter", type: "recurring", intervalValue: 30, intervalUnit: "days", lastCompleted: "2026-09-01", history: [{ id: "recent", date: "2026-09-01" }], reminderDays: 7, createdAt: "2026-01-01" };
test("backfilling history keeps the latest completion and snooze", () => {
  const updated = recordCompletion(item, { id: "older", date: "2026-08-01" });
  assert.equal(updated.lastCompleted, "2026-09-01");
  assert.equal(toISO(dueDate(updated)), "2026-10-01");
  assert.equal(recordCompletion({ ...item, snoozedUntil: "2026-10-10" }, { id: "older", date: "2026-08-01" }).snoozedUntil, "2026-10-10");
  assert.equal(removeLatestCompletion(updated).lastCompleted, "2026-08-01");
});
test("new completions clear snoozes and deleting the last record clears its date", () => {
  const updated = recordCompletion({ ...item, snoozedUntil: "2026-10-10" }, { id: "new", date: "2026-10-01" });
  assert.equal(updated.lastCompleted, "2026-10-01");
  assert.equal(updated.snoozedUntil, undefined);
  assert.equal(removeLatestCompletion(item).lastCompleted, undefined);
});
test("correcting a completion date updates history, while unrelated edits retain a snooze", () => {
  const changed = applyItemEdit(item, { ...item, lastCompleted: "2026-09-02" });
  assert.equal(changed.history[0].date, "2026-09-02");
  assert.equal(changed.lastCompleted, "2026-09-02");
  assert.equal(applyItemEdit({ ...item, snoozedUntil: "2026-10-10" }, { ...item, snoozedUntil: "2026-10-10", notes: "Hello" }).snoozedUntil, "2026-10-10");
});
test("editing a February 29 birthday preserves its actual month/day", () => {
  const birthday: TrackedItem = { ...item, type: "fixed", source: "birthday", monthDay: "02-29" };
  assert.equal(toISO(dueDate(birthday, fromISO("2026-01-01"))), "2026-02-28");
  const edited = applyItemEdit(birthday, { ...birthday, title: "Updated name", targetDate: annualEditDate(birthday) });
  assert.equal(edited.monthDay, "02-29");
  assert.equal(edited.targetDate, undefined);
  assert.equal(toISO(dueDate(edited, fromISO("2028-01-01"))), "2028-02-29");
});
