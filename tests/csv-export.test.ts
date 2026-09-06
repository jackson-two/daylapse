import assert from "node:assert/strict";
import test from "node:test";
import { createCsvExport, fetchCsvExport } from "../lib/csv-export";
import { dueDate, fromISO, toISO } from "../lib/item-dates";
import type { TrackedItem } from "../lib/household-schema";

const item: TrackedItem = {
  id: "filter", title: "Air filter", type: "recurring", intervalValue: 1,
  intervalUnit: "months", lastCompleted: "2026-01-31", reminderDays: 7,
  history: [{ id: "completion-1", date: "2026-01-31" }], createdAt: "2026-01-01",
};

test("next due dates preserve dashboard rules for recurrence, snoozes, and annual events", () => {
  const cases: [Partial<TrackedItem>, string, string][] = [
    [{}, "2026-02-01", "2026-02-28"],
    [{ intervalValue: 2, intervalUnit: "weeks" }, "2026-02-01", "2026-02-14"],
    [{ intervalValue: 10, intervalUnit: "days" }, "2026-02-01", "2026-02-10"],
    [{ intervalUnit: "years", lastCompleted: "2024-02-29", history: [] }, "2025-01-01", "2025-02-28"],
    [{ lastCompleted: undefined, history: [] }, "2026-02-01", "2026-02-01"],
    [{ snoozedUntil: "2026-03-10" }, "2026-02-01", "2026-03-10"],
    [{ type: "fixed", targetDate: "2026-01-10" }, "2026-02-01", "2026-01-10"],
    [{ type: "fixed", targetDate: "2026-01-10", annual: true }, "2026-02-01", "2027-01-10"],
    [{ type: "fixed", source: "birthday", monthDay: "02-29" }, "2026-02-01", "2026-02-28"],
    [{ type: "fixed", source: "anniversary", monthDay: "02-01" }, "2026-02-01", "2026-02-01"],
    [{ type: "fixed", source: "birthday", monthDay: "01-01" }, "2026-02-01", "2027-01-01"],
    [{ type: "fixed", source: "holiday", holidayKey: "thanksgiving" }, "2026-09-04", "2026-11-26"],
    [{ type: "fixed", source: "holiday", holidayKey: "thanksgiving" }, "2026-11-27", "2027-11-25"],
  ];
  for (const [changes, asOf, expected] of cases) {
    const candidate = { ...item, ...changes };
    assert.equal(toISO(dueDate(candidate, fromISO(asOf))), expected, JSON.stringify(changes));
    assert.ok(createCsvExport([candidate], "items", fromISO(asOf)).includes(`"${expected}"`));
  }
});

test("items CSV includes archived items, stored settings, due date, and report context", () => {
  const output = createCsvExport([{ ...item, archived: true, notes: "Upstairs" }], "items", fromISO("2026-09-04"));
  const [header, row] = output.slice(1).trimEnd().split("\r\n").map((line) =>
    Array.from(line.matchAll(/"((?:[^"]|"")*)"/g), (match) => match[1].replaceAll('""', '"')));
  const record = Object.fromEntries(header.map((name, index) => [name, row[index]]));
  assert.equal(record.id, "filter");
  assert.equal(record.next_due_date, "2026-02-28");
  assert.equal(record.archived, "true");
  assert.equal(record.notes, "Upstairs");
  assert.equal(record.interval_value, "1");
  assert.equal(record.completion_count, "1");
  assert.equal(record.as_of_date, "2026-09-04");
  assert.equal(record.time_zone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(record.snoozed_until, "");
  assert.equal(row.length, header.length);
});

test("CSV preserves Unicode, quotes, commas, and multiline notes while escaping formula text", () => {
  const output = createCsvExport([{
    ...item, title: 'Café, "upstairs" 🏠', notes: 'First line\r\nSecond "line", too',
  }], "items");
  assert.ok(output.startsWith("\uFEFF"));
  assert.ok(output.includes('"Café, ""upstairs"" 🏠"'));
  assert.ok(output.includes('"First line\r\nSecond ""line"", too"'));
  for (const title of ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "  =1+1", "\t=1+1", "\n=1+1"]) {
    for (const kind of ["items", "history"] as const) {
      assert.ok(createCsvExport([{ ...item, title }], kind).includes(`"'${title}"`));
    }
  }
});

test("history CSV exports individual completions and retains archived item identity", () => {
  const output = createCsvExport([
    { ...item, archived: true, history: [...item.history, { id: "completion-2", date: "2026-02-28" }] },
    { ...item, id: "empty", history: [] },
  ], "history");
  assert.equal(output, '\uFEFF"item_id","item_title","completion_id","completion_date"\r\n'
    + '"filter","Air filter","completion-1","2026-01-31"\r\n'
    + '"filter","Air filter","completion-2","2026-02-28"\r\n');
});

test("empty datasets produce valid header-only CSVs", () => {
  for (const kind of ["items", "history"] as const) {
    const output = createCsvExport([], kind);
    assert.equal(output.split("\r\n").length, 2);
    assert.ok(output.startsWith("\uFEFF\""));
  }
});

test("downloads read a fresh authenticated snapshot and name its revision", async (context) => {
  context.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.match(url, /^\/api\/events\/export\?kind=items&timeZone=/);
    assert.equal(options.cache, "no-store");
    return new Response(createCsvExport([item], "items"), {headers:{"Content-Type":"text/csv","Content-Disposition":'attachment; filename="daylapse-items-2026-09-04-r42.csv"'}});
  });
  const result = await fetchCsvExport("items");
  assert.match(result.filename, /^daylapse-items-\d{4}-\d{2}-\d{2}-r42\.csv$/);
  assert.ok(result.content.includes('"Air filter"'));
});

test("failed or invalid reads never produce an empty fallback download", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  await assert.rejects(fetchCsvExport("items"));
  fetchMock.mock.mockImplementation(async () => Response.json({ items: [{ title: "broken" }], revision: 2 }));
  await assert.rejects(fetchCsvExport("items"));
  fetchMock.mock.mockImplementation(async () => Response.json({ items: [], revision: -1 }));
  await assert.rejects(fetchCsvExport("history"));
});
