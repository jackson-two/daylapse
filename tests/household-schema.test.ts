import assert from "node:assert/strict";
import test from "node:test";
import { householdItemsSchema, validationIssues, type TrackedItem } from "../lib/household-schema";

const recurringItem: TrackedItem = {
  id: "hvac",
  verb: "Change",
  title: "Air filter",
  type: "recurring",
  intervalValue: 90,
  intervalUnit: "days",
  lastCompleted: "2026-08-01",
  reminderDays: 7,
  history: [{ id: "completion-1", date: "2026-08-01" }],
  createdAt: "2026-01-01",
};

test("accepts production-compatible recurring, holiday, and celebration items", () => {
  const result = householdItemsSchema.safeParse([
    recurringItem,
    {
      id: "holiday-1",
      title: "Thanksgiving",
      type: "fixed",
      intervalValue: 1,
      intervalUnit: "years",
      reminderDays: 30,
      history: [],
      source: "holiday",
      holidayKey: "thanksgiving",
      createdAt: "2026-08-01",
    },
    {
      id: "birthday-1",
      title: "A birthday",
      type: "fixed",
      intervalValue: 1,
      intervalUnit: "years",
      reminderDays: 30,
      history: [],
      source: "birthday",
      monthDay: "02-29",
      createdAt: "2026-08-01",
    },
  ]);
  assert.equal(result.success, true);
});

test("rejects impossible calendar dates and invalid cross-field combinations", () => {
  const result = householdItemsSchema.safeParse([{
    ...recurringItem,
    type: "fixed",
    targetDate: "2026-02-30",
    source: "birthday",
  }]);
  assert.equal(result.success, false);
  if (result.success) return;
  const messages = result.error.issues.map((issue) => issue.message);
  assert.ok(messages.includes("Expected a valid YYYY-MM-DD date."));
  assert.ok(messages.includes("A custom holiday, birthday, or anniversary requires a month and day."));
});

test("rejects duplicate item and completion-history identifiers", () => {
  const result = householdItemsSchema.safeParse([
    {
      ...recurringItem,
      history: [
        { id: "same", date: "2026-07-01" },
        { id: "same", date: "2026-08-01" },
      ],
    },
    recurringItem,
  ]);
  assert.equal(result.success, false);
  if (result.success) return;
  const issues = validationIssues(result.error);
  assert.ok(issues.some((issue) => issue.path === "items[0].history[1].id"));
  assert.ok(issues.some((issue) => issue.path === "items[1].id"));
});

test("rejects unknown fields and whitespace that would change stored identity", () => {
  const result = householdItemsSchema.safeParse([{
    ...recurringItem,
    id: " hvac ",
    unexpected: true,
  }]);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.error.issues.some((issue) => issue.code === "unrecognized_keys"));
  assert.ok(result.error.issues.some((issue) => issue.path.join(".") === "0.id"));
});

test("allows human-entered note spacing but rejects blank titles and unknown holiday keys", () => {
  const noteResult = householdItemsSchema.safeParse([{ ...recurringItem, notes: "  check the hallway  " }]);
  assert.equal(noteResult.success, true);

  const invalidResult = householdItemsSchema.safeParse([{
    ...recurringItem,
    title: "   ",
    type: "fixed",
    source: "holiday",
    holidayKey: "made-up-holiday",
  }]);
  assert.equal(invalidResult.success, false);
});
