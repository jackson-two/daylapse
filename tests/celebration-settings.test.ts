import assert from "node:assert/strict";
import test from "node:test";
import { openLocalRows } from "../scripts/row-storage-local";
import { RowTransport } from "../lib/row-transport";
import { handleRowRequest } from "../lib/row-api";
import { readRowSnapshot } from "../lib/row-consumers";
import { convertSnapshot } from "../lib/row-converter";
import { importConverted } from "../lib/row-importer";
import { dashboardWindowDays, isDashboardVisible } from "../lib/item-visibility";
import { dueTodayItems } from "../lib/due-notifications";
import { fromISO } from "../lib/item-dates";
import type { TrackedItem } from "../lib/household-schema";
import { testInstallation } from "./fixtures/installation";

const celebration: TrackedItem = {
  id: "birthday", title: "Sample birthday", source: "birthday", type: "fixed",
  intervalValue: 1, intervalUnit: "years", monthDay: "09-04", reminderDays: 30,
  createdAt: "2026-01-01", history: [],
};

test("dashboard windows distinguish legacy defaults, no limit, and today only", () => {
  const day = fromISO("2026-01-01");
  assert.equal(dashboardWindowDays(celebration), 60);
  assert.equal(isDashboardVisible(celebration, day), false);
  assert.equal(isDashboardVisible({ ...celebration, showOnMainWithinDays: null }, day), true);
  const todayOnly = { ...celebration, showOnMainWithinDays: 0 };
  assert.equal(isDashboardVisible(todayOnly, fromISO("2026-09-03")), false);
  assert.equal(isDashboardVisible(todayOnly, fromISO("2026-09-04")), true);
  for (const patch of [{ showOnDashboard: false }, { archived: true }, { deletedAt: "2026-01-01" }]) {
    assert.equal(isDashboardVisible({ ...celebration, showOnMainWithinDays: null, ...patch }, day), false);
  }
});

test("birthday and anniversary settings survive create, edit, reload, and destination filtering", async (t) => {
  const { db, mf } = await openLocalRows();
  t.after(() => mf.dispose());
  await importConverted(db, await convertSnapshot({ items: [], revision: 0 }, "2026-01-01T00:00:00.000Z", ["2026-01-01"]));
  await db.prepare("UPDATE installation_settings SET storage_mode='rows'").run();
  const request: typeof fetch = (input, init) => {
    const url = new URL(String(input), "https://daylapse.example.com");
    return handleRowRequest(new Request(url, { ...init, headers: { ...init?.headers, origin: url.origin } }), db, testInstallation);
  };
  const signal = new AbortController().signal;
  for (const source of ["birthday", "anniversary"] as const) {
    const hidden = { ...celebration, id: source, source, showOnDashboard: false, showOnDisplay: false, notifyDueToday: false, showOnMainWithinDays: 0 };
    const transport = new RowTransport(request);
    const initial = await transport.save([hidden], [], 0, signal);
    assert.equal(initial.status, 200);
    let loaded = (await readRowSnapshot(db)).items.find((i) => i.id === source)!;
    assert.equal(loaded.showOnDashboard, false);
    assert.equal(loaded.showOnDisplay, false);
    assert.equal(loaded.notifyDueToday, false);
    assert.equal(loaded.showOnMainWithinDays, 0);
    assert.equal(isDashboardVisible(loaded, fromISO("2026-09-04")), false);
    assert.equal(dueTodayItems([loaded], "2026-09-04").length, 0);
    for (const destination of ["display", "notifications"] as const) {
      assert.ok(!(await readRowSnapshot(db, destination)).items.some((i) => i.id === source));
    }
    // A fresh client reads the stored version before editing all destinations.
    const fresh = new RowTransport(request);
    await fresh.read("/api/events/snapshot");
    const enabled = { ...loaded, showOnDashboard: true, showOnDisplay: true, notifyDueToday: true, showOnMainWithinDays: null };
    assert.equal((await fresh.save([enabled], [loaded], 0, signal)).status, 200);
    loaded = (await readRowSnapshot(db)).items.find((i) => i.id === source)!;
    assert.equal(loaded.showOnMainWithinDays, null);
    assert.equal(isDashboardVisible(loaded, fromISO("2026-01-01")), true);
    assert.equal(dueTodayItems([loaded], "2026-09-04").length, 1);
    for (const destination of ["display", "notifications"] as const) {
      assert.ok((await readRowSnapshot(db, destination)).items.some((i) => i.id === source));
    }
  }
});
