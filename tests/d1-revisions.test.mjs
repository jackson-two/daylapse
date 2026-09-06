import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectDirectory = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const wrangler = join(projectDirectory, "node_modules/wrangler/bin/wrangler.js");
const database = "daylapse-production";

function runWrangler(persistTo, args) {
  return execFileSync(process.execPath, [wrangler, "d1", ...args, "--local", "--persist-to", persistTo], {
    cwd: projectDirectory,
    encoding: "utf8",
    env: { ...process.env, WRANGLER_LOG_PATH: join(projectDirectory, ".wrangler/wrangler.log") },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function execute(persistTo, sql) {
  const output = runWrangler(persistTo, ["execute", database, "--command", sql, "--json"]);
  return JSON.parse(output)[0];
}

function executeFile(persistTo, path) {
  runWrangler(persistTo, ["execute", database, "--file", path, "--yes"]);
}

test("the D1 migration backfills and atomically captures immutable state revisions", async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "daylapse-d1-revisions-"));
  try {
    executeFile(persistTo, "drizzle/0000_fantastic_joystick.sql");
    executeFile(persistTo, "drizzle/0001_lowly_stellaris.sql");
    executeFile(persistTo, "drizzle/0002_clean_wind_dancer.sql");
    execute(persistTo, `
      INSERT INTO household_state (id, data, revision, updated_at)
      VALUES (1, '[]', 7, '2026-08-27T00:00:00.000Z')
    `);

    executeFile(persistTo, "drizzle/0003_lush_norman_osborn.sql");
    let rows = execute(persistTo, `
      SELECT revision, data, item_count AS itemCount, size_bytes AS sizeBytes
      FROM household_state_revisions
      WHERE household_id = 1
      ORDER BY revision
    `).results;
    assert.deepEqual(rows, [{ revision: 7, data: "[]", itemCount: 0, sizeBytes: 2 }]);

    const triggers = execute(persistTo, `
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'snapshot_household_state_after_%'
      ORDER BY name
    `).results;
    assert.deepEqual(triggers.map(({ name }) => name), [
      "snapshot_household_state_after_insert",
      "snapshot_household_state_after_update",
    ]);

    const accepted = execute(persistTo, `
      UPDATE household_state
      SET data = '[{"id":"new"}]', revision = revision + 1, updated_at = '2026-08-27T01:00:00.000Z'
      WHERE id = 1 AND revision = 7
      RETURNING revision
    `);
    assert.deepEqual(accepted.results, [{ revision: 8 }]);
    const rejected = execute(persistTo, `
      UPDATE household_state
      SET data = '[{"id":"stale"}]', revision = revision + 1, updated_at = '2026-08-27T02:00:00.000Z'
      WHERE id = 1 AND revision = 7
      RETURNING revision
    `);
    assert.deepEqual(rejected.results, []);
    rows = execute(persistTo, `
      SELECT revision, data FROM household_state_revisions
      WHERE household_id = 1 ORDER BY revision
    `).results;
    assert.deepEqual(rows, [
      { revision: 7, data: "[]" },
      { revision: 8, data: '[{"id":"new"}]' },
    ]);

    execute(persistTo, `
      UPDATE household_state
      SET data = (SELECT data FROM household_state_revisions WHERE household_id = 1 AND revision = 7),
          revision = revision + 1,
          updated_at = '2026-08-27T03:00:00.000Z'
      WHERE id = 1 AND revision = 8
    `);
    const restored = execute(persistTo, `
      SELECT revision, data FROM household_state WHERE id = 1
    `).results[0];
    assert.deepEqual(restored, { revision: 9, data: "[]" });

    assert.throws(() => execute(persistTo, `
      UPDATE household_state
      SET data = 'not-json', revision = revision + 1, updated_at = '2026-08-27T04:00:00.000Z'
      WHERE id = 1 AND revision = 9
    `));
    const afterRejectedWrite = execute(persistTo, `
      SELECT revision, data FROM household_state WHERE id = 1
    `).results[0];
    assert.deepEqual(afterRejectedWrite, { revision: 9, data: "[]" });
  } finally {
    await rm(persistTo, { recursive: true, force: true });
  }
});
