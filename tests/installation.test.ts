import assert from "node:assert/strict";
import test from "node:test";
import { deploymentConfig, deploymentSchema, emptyInitializationSql } from "../scripts/installation-config";
import { openLocalRows } from "../scripts/row-storage-local";
import { testInstallation } from "./fixtures/installation";
import { d1Json } from "../scripts/wrangler-output";

test("D1 file progress is separated from validated JSON without exposing failed output", () => {
  const rows = [{ success: true, results: [{ storage_mode: "rows" }] }];
  assert.deepEqual(d1Json("├ Checking upload\n" + JSON.stringify(rows, null, 2)), rows);
  assert.throws(() => d1Json('[{"success":false,"results":[],"error":"private data"}]'), /D1 did not return/);
});

const installation = {
  workerName: "daylapse-test", accountId: "1".repeat(32), databaseName: "daylapse-test",
  databaseId: "12345678-1234-4234-8234-123456789abc",
  settings: { ...testInstallation, familyHostname: "tasks.my-household.org", displayHostname: "" },
};

test("deployment requires real configuration and enables only selected features and routes", () => {
  const base = { workers_dev: true, preview_urls: true };
  const minimal = deploymentConfig(installation, base);
  assert.equal(minimal.workers_dev, false);
  assert.equal(minimal.preview_urls, false);
  assert.deepEqual(minimal.triggers.crons, []);
  assert.deepEqual(minimal.secrets.required, []);
  assert.equal(minimal.routes.length, 1);
  const full = deploymentConfig({ ...installation, settings: { ...installation.settings, notifications: true, displayHostname: "display.my-household.org" } }, base);
  assert.equal(full.routes.length, 2);
  assert.equal(full.secrets.required.length, 3);
  assert.equal(full.triggers.crons.length, 1);
  for (const settings of [{ localDevelopment: true }, { familyHostname: "daylapse.example.com" }, { accessAudience: "" },
    { displayHostname: installation.settings.familyHostname }, { timeZone: "Not/AZone" }]) {
    assert.equal(deploymentSchema.safeParse({ ...installation, settings: { ...installation.settings, ...settings } }).success, false);
  }
  assert.equal(deploymentSchema.safeParse({ ...installation, accountId: "0".repeat(32) }).success, false);
  const workersDev = deploymentConfig({ ...installation, settings: { ...installation.settings, familyHostname: "daylapse-test.my-account.workers.dev" } }, base);
  assert.equal(workersDev.workers_dev, true);
  assert.deepEqual(workersDev.routes, []);
  assert.throws(() => deploymentConfig({ ...installation, settings: { ...installation.settings, familyHostname: "other.my-account.workers.dev" } }, base));
});

test("empty initialization can be rerun and never changes existing data or timezone", async (t) => {
  const { db, mf } = await openLocalRows();
  t.after(() => mf.dispose());
  const initialize = async (zone: string) => db.batch(emptyInitializationSql(zone).split(";").filter((s) => s.trim()).map((s) => db.prepare(s)));
  await initialize("UTC");
  assert.deepEqual(await db.prepare("SELECT storage_mode, import_state, default_time_zone FROM installation_settings").first(),
    { storage_mode: "rows", import_state: "ready", default_time_zone: "UTC" });
  await initialize("Europe/London");
  assert.equal((await db.prepare("SELECT default_time_zone FROM installation_settings").first())?.default_time_zone, "UTC");
  const other = await openLocalRows();
  t.after(() => other.mf.dispose());
  // Legacy snapshots must require the explicit migration workflow, even if empty.
  await other.db.prepare("INSERT INTO household_state (id, data, revision, updated_at) VALUES (1, '[]', 1, '2026-01-01')").run();
  await other.db.batch(emptyInitializationSql("UTC").split(";").filter((s) => s.trim()).map((s) => other.db.prepare(s)));
  assert.equal((await other.db.prepare("SELECT storage_mode FROM installation_settings").first())?.storage_mode, "legacy");
});
