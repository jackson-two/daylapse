import { testInstallation } from "./fixtures/installation";
import assert from "node:assert/strict";
import test from "node:test";
import { openLocalRows } from "../scripts/row-storage-local";
import { canonical, convertSnapshot, eventAsLegacy } from "../lib/row-converter";
import { importConverted } from "../lib/row-importer";
import { RowError, RowRepository } from "../lib/row-repository";
import { eventPatchSchema } from "../lib/row-schema";
import { handleRowRequest } from "../lib/row-api";
import { dueDate, fromISO, toISO } from "../lib/item-dates";
import type { TrackedItem } from "../lib/household-schema";

const at = "2026-09-04T15:00:00.000Z";
const base: TrackedItem = { id: "task", title: "Replace filter", type: "recurring", intervalValue: 1, intervalUnit: "months", createdAt: "2024-01-31", lastCompleted: "2026-08-31", history: [{ id: "first", date: "2026-07-31" }], reminderDays: 7, snoozedUntil: "2026-10-05", notes: "Private note\nwith spacing " };
const dates = ["2026-09-04", "2027-02-28", "2028-02-29", "2028-12-31", "2029-01-01"];
const fixtures: TrackedItem[] = [base,
  { ...base, id: "other", title: "Other task", history: [{ id: "first", date: "2026-08-31" }], snoozedUntil: undefined, archived: true },
  { ...base, id: "birthday", type: "fixed", source: "birthday", monthDay: "02-29", lastCompleted: undefined, snoozedUntil: undefined, history: [] },
  { ...base, id: "annual", type: "fixed", source: undefined, annual: true, targetDate: "2024-02-29", lastCompleted: undefined, snoozedUntil: undefined, history: [] },
  { ...base, id: "holiday", type: "fixed", source: "holiday", holidayKey: "thanksgiving", lastCompleted: undefined, snoozedUntil: undefined, history: [] },
  { ...base, id: "fixed", type: "fixed", targetDate: "2026-09-04", lastCompleted: undefined, snoozedUntil: undefined, history: [] },
];

test("conversion preserves calendar behavior, identity, text, and synthetic legacy provenance", async () => {
  const c = await convertSnapshot({ items: fixtures, revision: 9 }, at, dates);
  assert.equal(c.events.length, fixtures.length);
  assert.equal(c.report.syntheticCompletions, 1);
  assert.equal(c.completions.filter((r) => r.id === "first").length, 2);
  assert.equal(c.events.find((r) => r.id === "birthday")!.day, 29);
  assert.equal(c.events.find((r) => r.id === "annual")!.annualAnchorDate, "2024-02-29");
  assert.ok(c.report.comparisons.every((r) => r.equal));
  assert.equal(c.events[0].notes, base.notes);
  assert.equal(c.events[0].createdAt, null);
  assert.deepEqual(c.events.map((e) => e.importPosition), fixtures.map((_, index) => index));
  assert.equal(c.completions[0].recordedAt, null);
  assert.deepEqual(eventPatchSchema.parse({ title: "Updated" }), { title: "Updated" });
  await assert.rejects(() => convertSnapshot({ items: [base, base], revision: 1 }, at, dates));
  await assert.rejects(() => convertSnapshot({ items: [{ ...base, lastCompleted: "2026-02-30" }], revision: 1 }, at, dates));
  await assert.rejects(() => convertSnapshot({ items: [{ ...base, history: [{ id: "same", date: "2026-01-01" }, { id: "same", date: "2026-02-01" }] }], revision: 1 }, at, dates));
});

test("D1 row foundation migration, mutations, recovery, and API access", async (t) => {
  const { db, mf } = await openLocalRows(); t.after(() => mf.dispose());
  const repository = new RowRepository(db);
  const conversion = await convertSnapshot({ items: fixtures, revision: 9 }, at, dates);
  const api = (path: string, method = "GET", body?: unknown, host = "daylapse.example.com", origin = `https://${host}`) => handleRowRequest(new Request(`https://${host}/api${path}`, { method, headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), db, testInstallation);
  await t.test("additive migration leaves legacy storage intact and gates row endpoints", async () => {
    assert.equal((await api("/events")).status, 503);
    assert.ok(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'household_state'").first());
    await db.prepare("INSERT INTO household_state (id, data, revision, updated_at) VALUES (1, ?, 9, ?)").bind(JSON.stringify(fixtures), at).run();
    await assert.rejects(() => db.prepare("UPDATE installation_settings SET storage_mode = 'rows'").run(), /row_import_incomplete/);
  });
  await t.test("interrupted import resumes exactly once with verifiable baseline history", async () => {
    await assert.rejects(() => importConverted(db, conversion, { afterChunk: () => { throw new Error("simulated interruption"); } }), /simulated interruption/);
    assert.equal((await api("/events")).status, 503);
    await importConverted(db, conversion);
    assert.equal((await db.prepare("SELECT data FROM household_state WHERE id = 1").first<{ data: string }>())!.data, JSON.stringify(fixtures));
    assert.equal((await importConverted(db, conversion)).alreadyImported, true);
    assert.equal((await repository.listEvents()).events.length, fixtures.length);
    assert.equal((await repository.listCompletions("task")).completions.length, 2);
    const baseline = await repository.listRevisions("task");
    const recovered = await repository.readRevision("task", Number(baseline.baseline!.sequence));
    assert.equal(canonical(recovered.event), canonical(conversion.events[0]));
    const other = await convertSnapshot({ items: [base], revision: 10 }, at, dates);
    await assert.rejects(() => importConverted(db, other), /row_import_not_empty|legacy_source_changed/);
    assert.equal((await api("/events")).status, 503);
    await db.prepare("UPDATE installation_settings SET storage_mode = 'rows' WHERE id = 1").run();
  });
  await t.test("PATCH preserves omitted fields and independent item edits do not conflict", async () => {
    const [one, two] = await Promise.all([
      repository.mutate({ operation: "patch", mutationId: "patch-1", eventId: "task", expectedVersion: 1, patch: { title: "Edited title", showOnDisplay: false } }),
      repository.mutate({ operation: "patch", mutationId: "patch-2", eventId: "other", expectedVersion: 1, patch: { archivedAt: null } }),
    ]);
    assert.equal(one.event.version, 2); assert.equal(two.event.version, 2);
    assert.equal(one.event.notes, base.notes); assert.equal(one.event.snoozedUntil, base.snoozedUntil);
    assert.equal(one.event.showOnDashboard, true); assert.equal(one.event.notifyDueToday, true);
    assert.equal((await api("/events/task", "PATCH", { mutationId: "api-patch", expectedVersion: 2, patch: { category: "Household" } })).status, 200);
    assert.equal((await repository.getEvent("task"))!.showOnDisplay, false);
  });
  await t.test("same-item races accept exactly one write and return a current conflict", async () => {
    const version = (await repository.getEvent("task"))!.version;
    const outcomes = await Promise.allSettled(["race-a", "race-b"].map((mutationId) => repository.mutate({ operation: "patch", mutationId, eventId: "task", expectedVersion: version, patch: { category: mutationId } })));
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = outcomes.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.equal((rejected.reason as RowError).status, 409);
    assert.equal((await repository.getEvent("task"))!.version, version + 1);
  });
  await t.test("idempotent retries preserve the receipt and prevent duplicate completions", async () => {
    const event = (await repository.getEvent("task"))!;
    const command = { operation: "completion.create" as const, mutationId: "completion-retry", eventId: "task", expectedVersion: event.version, completionId: "backfill", completedOn: "2026-06-01" };
    const saved = await repository.mutate(command);
    assert.equal(saved.event.snoozedUntil, base.snoozedUntil);
    assert.equal((await repository.getEventSummary("task"))!.lastCompleted, "2026-08-31");
    assert.deepEqual(await repository.mutate(command), saved);
    await assert.rejects(() => repository.mutate({ ...command, completedOn: "2026-06-02" }), (e: unknown) => e instanceof RowError && e.code === "mutation_id_reused");
    const history = (await repository.listCompletions("task")).completions;
    assert.equal(history.filter((c) => c.id === "backfill").length, 1);
    assert.equal(toISO(dueDate(eventAsLegacy(saved.event, history), fromISO("2026-09-04"))), "2026-10-05");
  });
  await t.test("audit failure rolls back completion, item version, and receipt together", async () => {
    const before = (await repository.getEvent("task"))!;
    await db.prepare("CREATE TRIGGER simulate_audit_failure BEFORE INSERT ON changes WHEN NEW.mutation_id = 'rollback-test' BEGIN SELECT RAISE(ABORT, 'simulated_audit_failure'); END").run();
    await assert.rejects(() => repository.mutate({ operation: "completion.create", mutationId: "rollback-test", eventId: "task", expectedVersion: before.version, completionId: "not-saved", completedOn: "2026-09-04" }), /simulated_audit_failure/);
    assert.deepEqual(await repository.getEvent("task"), before);
    assert.equal(await db.prepare("SELECT id FROM completions WHERE id = 'not-saved'").first(), null);
    assert.equal(await db.prepare("SELECT id FROM mutations WHERE id = 'rollback-test'").first(), null);
    await db.prepare("DROP TRIGGER simulate_audit_failure").run();
  });
  await t.test("simultaneous identical requests and ambiguous commit responses replay one receipt", async () => {
    const event = (await repository.getEvent("other"))!;
    const command = { operation: "patch" as const, mutationId: "simultaneous-retry", eventId: "other", expectedVersion: event.version, patch: { title: "Same request" } };
    const [first, second] = await Promise.all([repository.mutate(command), repository.mutate(command)]);
    assert.deepEqual(first, second);
    let lost = false;
    const flaky = new Proxy(db, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => { const result = await target.batch(statements); if (!lost) { lost = true; throw new Error("Lost response after commit"); } return result; };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const response = await new RowRepository(flaky).mutate({ operation: "patch", mutationId: "ambiguous", eventId: "other", expectedVersion: first.event.version, patch: { category: "Recovered" } });
    assert.equal(response.event.version, first.event.version + 1);
    assert.ok(response.sequence);
  });
  await t.test("completion correction, void, soft-delete, and historical restore preserve history", async () => {
    const before = (await repository.getEvent("task"))!;
    const corrected = await repository.mutate({ operation: "completion.patch", mutationId: "correct", eventId: "task", expectedVersion: before.version, completionId: "backfill", completedOn: "2026-09-04" });
    assert.equal(corrected.event.snoozedUntil, null);
    const removed = await repository.mutate({ operation: "completion.delete", mutationId: "void", eventId: "task", expectedVersion: corrected.event.version, completionId: "backfill" });
    assert.ok(removed.completion!.voidedAt);
    assert.equal((await repository.getEventSummary("task"))!.lastCompleted, "2026-08-31");
    const deleted = await repository.mutate({ operation: "delete", mutationId: "delete", eventId: "task", expectedVersion: removed.event.version });
    assert.ok(deleted.event.deletedAt);
    assert.ok(!(await repository.listEvents()).events.some((e) => e.id === "task"));
    const restored = await repository.mutate({ operation: "restore", mutationId: "restore", eventId: "task", expectedVersion: deleted.event.version, sequence: corrected.sequence });
    assert.equal(restored.event.deletedAt, null); assert.equal(restored.event.version, deleted.event.version + 1);
    assert.ok((await repository.listCompletions("task")).completions.some((c) => c.id === "backfill" && c.completedOn === "2026-09-04"));
    const historical = await repository.readRevision("task", corrected.sequence);
    assert.equal(historical.event.version, corrected.event.version);
    await assert.rejects(() => db.prepare("UPDATE changes SET created_at = 'changed'").run(), /change_history_immutable/);
    await assert.rejects(() => db.prepare("DELETE FROM changes").run(), /change_history_immutable/);
    await assert.rejects(() => db.prepare("DELETE FROM events WHERE id = 'task'").run(), /FOREIGN KEY/);
  });
  await t.test("database constraints reject invalid schedules, dates, and visibility values", async () => {
    await assert.rejects(() => db.prepare("UPDATE events SET show_on_display = 2 WHERE id = 'task'").run(), /CHECK/);
    await assert.rejects(() => db.prepare("UPDATE events SET anchor_date = '2026-02-30' WHERE id = 'task'").run(), /CHECK/);
    await assert.rejects(() => db.prepare("UPDATE events SET schedule_type = 'annual_date' WHERE id = 'task'").run(), /CHECK/);
    await assert.rejects(() => db.prepare("UPDATE events SET day = 30 WHERE id = 'birthday'").run(), /CHECK/);
    await assert.rejects(() => db.prepare("UPDATE events SET interval_value = NULL WHERE id = 'task'").run(), /CHECK/);
    await assert.rejects(() => db.prepare("UPDATE events SET interval_value = 1.5 WHERE id = 'task'").run(), /CHECK/);
  });
  await t.test("queries use indexes and paginate without losing changes or archived management items", async () => {
    for (const [sql, index] of [
      ["SELECT MAX(completed_on) FROM completions WHERE event_id = 'task' AND voided_at IS NULL", "completions_active_dates"],
      ["SELECT id FROM events WHERE show_on_display = 1 AND archived_at IS NULL AND deleted_at IS NULL", "events_active_display"],
      ["SELECT * FROM changes WHERE event_id = 'task' ORDER BY sequence", "changes_event_sequence"],
    ]) {
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>();
      assert.ok(plan.results.some((r: { detail: string }) => r.detail.includes(index)), JSON.stringify(plan.results));
    }
    const page = await repository.listEvents("", 2); assert.equal(page.events.length, 2); assert.ok(page.nextCursor);
    const next = await repository.listEvents(page.nextCursor!, 2); assert.ok(next.events.every((e) => !page.events.some((p) => p.id === e.id)));
    const feed = await repository.listChanges(0, 2); assert.equal(feed.mutations.length, 2); assert.ok(feed.nextCursor);
    assert.ok((await repository.listChanges(feed.cursor, 100)).mutations.every((m) => Number(m.sequence) > feed.cursor));
  });
  await t.test("row APIs are bounded, same-origin, and unavailable to the DAKboard hostname", async () => {
    assert.equal((await api("/events", "GET", undefined, "display.daylapse.example.com")).status, 404);
    const spoofed = new Request("https://display.daylapse.example.com/api/events", { headers: { "x-forwarded-host": "daylapse.example.com" } });
    assert.equal((await handleRowRequest(spoofed, db, testInstallation)).status, 404);
    assert.equal((await api("/events/task", "DELETE", { mutationId: "csrf", expectedVersion: 1 }, undefined, "https://other.example")).status, 403);
    assert.equal((await api("/events?limit=1000")).status, 422);
    assert.equal((await api("/events", "PUT", {})).status, 405);
    assert.equal((await api("/events/task", "PATCH", { mutationId: "bad-patch", expectedVersion: 1, patch: { version: 100 } })).status, 422);
    assert.equal((await api("/events/task", "PATCH", { mutationId: "stale", expectedVersion: 1, patch: { title: "stale" } })).status, 409);
    const response = await api("/events", "POST", { mutationId: "create-api", event: { id: "new-api", title: "New event", kind: "event", scheduleType: "fixed_date", targetDate: "2027-01-01", createdOn: "2026-09-04" } });
    assert.equal(response.status, 201, await response.clone().text()); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await api("/events/task/completions?limit=1")).status, 200);
    assert.equal((await api("/changes?limit=1")).status, 200);
  });
});
