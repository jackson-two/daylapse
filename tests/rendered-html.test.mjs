import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("the built client contains the data-safe loading behavior", async () => {
  const assetsDirectory = new URL("../dist/client/assets/", import.meta.url);
  const pageAssets = (await readdir(assetsDirectory)).filter((name) => name.startsWith("page-") && name.endsWith(".js"));
  assert.ok(pageAssets.length > 0, "expected a compiled page asset");

  const compiledPage = (await Promise.all(
    pageAssets.map((name) => readFile(new URL(name, assetsDirectory), "utf8")),
  )).join("\n");

  assert.match(compiledPage, /Nothing has been changed or replaced/);
  assert.match(compiledPage, /expectedRevision/);
  assert.doesNotMatch(compiledPage, /HVAC air filter|Refrigerator water filter|Cat flea treatment/);
});

test("the API rejects stale household writes", async () => {
  const [route, storage, errors] = await Promise.all([
    readFile(new URL("../app/api/items/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/household-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/api-errors.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /reload_required/);
  assert.doesNotMatch(storage, /UPDATE household_state/);
  assert.match(errors, /status: 409/);
  assert.doesNotMatch(storage, /ON CONFLICT\(id\) DO UPDATE/);
});

test("household saves are validated and revision history stays off the display host", async () => {
  const [schema, migration, revisionList, revisionDetail] = await Promise.all([
    readFile(new URL("../lib/household-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_lush_norman_osborn.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/items/revisions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/items/revisions/[revision]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /z\.strictObject/);
  assert.match(schema, /Item IDs must be unique/);
  assert.match(migration, /snapshot_household_state_after_insert/);
  assert.match(migration, /snapshot_household_state_after_update/);
  assert.match(revisionList, /isDakboardHostname/);
  assert.match(revisionDetail, /isDakboardHostname/);
  assert.match(revisionDetail, /\/api\/recovery/);
});

test("the DAKboard route is key-protected and read-only", async () => {
  const [displayRoute, displayAuth, page] = await Promise.all([
    readFile(new URL("../app/api/display/items/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/display-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(displayRoute, /hasValidDisplayKey/);
  assert.match(displayRoute, /DAKboard display is read-only/);
  assert.doesNotMatch(displayRoute, /UPDATE household_state|INSERT INTO household_state/);
  assert.match(displayAuth, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(displayAuth, /revoked_at IS NULL/);
  assert.match(page, /\/api\/display\/items\?display_key=/);
  assert.match(page, /displayModeRef\.current/);
});

test("the display build retains the Raspberry Pi compatibility guards", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /Object\.hasOwn/);
  assert.match(layout, /structuredClone/);
  assert.match(layout, /crypto\.randomUUID/);
  assert.match(layout, /Daylapse could not start in this browser/);
});

test("the DAKboard view is a fixed, two-column dark-purple display", async () => {
  const [page, styles, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const DISPLAY_ITEM_LIMIT = 10/);
  assert.match(page, /isDisplayRoute\s*\? "dark-purple"/);
  assert.match(page, /!item\.archived && item\.type === "recurring"/);
  assert.match(page, /!item\.archived && item\.type === "fixed"/);
  assert.match(page, /<h2 id="display-events-heading">Events<\/h2>/);
  assert.match(page, /<ItemRow key=\{item\.id\} item=\{item\} \/>/);
  assert.match(styles, /\.display-board[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/s);
  assert.match(styles, /\.donut__center[^}]*background:\s*var\(--paper\)/s);
  assert.match(styles, /:root\[data-display="true"\]::\-webkit-scrollbar/);
  assert.match(layout, /document\.documentElement\.dataset\.display = "true"/);
  assert.doesNotMatch(styles, /\.donut::before/);
});

test("one-time events use at least a 50-day countdown window", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const EVENT_COUNTDOWN_DAYS = 50/);
  assert.match(page, /addDays\(target, -EVENT_COUNTDOWN_DAYS\)/);
  assert.match(page, /created < countdownWindowStart \? created : countdownWindowStart/);
});
