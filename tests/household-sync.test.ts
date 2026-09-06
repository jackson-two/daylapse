import assert from "node:assert/strict";
import test from "node:test";
import { HouseholdSync, mergeHouseholdItems } from "../lib/household-sync";
import type { TrackedItem } from "../lib/household-schema";

const item: TrackedItem = { id: "one", title: "Filter", type: "recurring", intervalValue: 30, intervalUnit: "days", reminderDays: 7, history: [], createdAt: "2026-01-01" };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("the default request calls browser fetch without an invalid receiver", async (t) => {
  t.mock.method(globalThis, "fetch", async function (this: unknown) {
    assert.equal(this, undefined);
    return Response.json({ items: [item], revision: 1 });
  });
  const sync = new HouseholdSync();
  t.after(() => sync.stop());
  sync.start(); await settle();
  assert.equal(sync.getSnapshot().status, "saved");
  assert.equal(sync.getSnapshot().items[0].id, item.id);
});

test("older display browsers load and refresh without AbortSignal.timeout", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")!;
  Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: undefined });
  t.after(() => Object.defineProperty(AbortSignal, "timeout", descriptor));
  let revision = 1;
  const requests: string[] = [];
  const url = "/api/display/items?display_key=test-display-key";
  const sync = new HouseholdSync(async (input, options) => {
    requests.push(String(input));
    assert.equal(options?.method, undefined);
    assert.ok(options?.signal instanceof AbortSignal);
    return Response.json({ items: [{ ...item, title: `Saved ${revision}` }], revision });
  });
  t.after(() => sync.stop());
  sync.start(url, true); await settle();
  assert.equal(sync.getSnapshot().status, "saved");
  assert.equal(sync.getSnapshot().ready, true);
  revision = 2; await sync.refresh();
  assert.equal(sync.getSnapshot().items[0].title, "Saved 2");
  assert.deepEqual(requests, [url, url]);
});

test("a stalled display request times out and can recover on the next refresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stalled = true;
  const sync = new HouseholdSync(async (_input, options) => {
    if (!stalled) return Response.json({ items: [item], revision: 1 });
    return new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new Error("Timed out")), { once: true });
    });
  });
  t.after(() => sync.stop());
  sync.start("/api/display/items?display_key=test-display-key", true);
  t.mock.timers.tick(20_000); await settle();
  assert.equal(sync.getSnapshot().status, "error");
  stalled = false; await sync.refresh();
  assert.equal(sync.getSnapshot().status, "saved");
  assert.equal(sync.getSnapshot().items.length, 1);
});

test("quick edits serialize writes and remain unsaved until the latest edit is accepted", async (t) => {
  const requests: { body: { expectedRevision: number; items: TrackedItem[] }; response: ReturnType<typeof deferred<Response>> }[] = [];
  const sync = new HouseholdSync(async (_url, options) => {
    if (!options?.method) return Response.json({ items: [item], revision: 1 });
    const request = { body: JSON.parse(String(options.body)), response: deferred<Response>() };
    requests.push(request);
    return request.response.promise;
  }, 60_000);
  t.after(() => sync.stop());
  sync.start(); await settle();
  sync.setItems([{ ...item, title: "First" }]);
  const first = sync.flush();
  sync.setItems([{ ...item, title: "Second" }]);
  await sync.flush();
  assert.equal(requests.length, 1);
  requests[0].response.resolve(Response.json({ revision: 2 })); await first;
  assert.equal(sync.getSnapshot().status, "saving");
  assert.equal(sync.getSnapshot().dirty, true);
  const second = sync.flush();
  assert.equal(requests[1].body.expectedRevision, 2);
  assert.equal(requests[1].body.items[0].title, "Second");
  requests[1].response.resolve(Response.json({ revision: 3 })); await second;
  assert.equal(sync.getSnapshot().status, "saved");
  assert.equal(sync.getSnapshot().dirty, false);
});

test("a timed-out accepted write can be retried without overwriting another device", async (t) => {
  let remote = { items: [item], revision: 1 };
  const sync = new HouseholdSync(async (_url, options) => {
    if (!options?.method) return Response.json(remote);
    remote = { items: JSON.parse(String(options.body)).items, revision: 2 };
    throw new Error("connection lost after commit");
  }, 60_000);
  t.after(() => sync.stop()); sync.start(); await settle();
  sync.setItems([{ ...item, notes: "My note" }]); await sync.flush();
  assert.equal(sync.getSnapshot().status, "error");
  remote.items.push({ ...item, id: "two", title: "Another device’s item" }); remote.revision = 3;
  await sync.retry();
  assert.equal(sync.getSnapshot().status, "saved");
  assert.equal(sync.getSnapshot().items.length, 2);
  assert.equal(sync.getSnapshot().items[0].notes, "My note");
});

test("refresh never replaces edits made while the read was in flight", async (t) => {
  const pending = deferred<Response>(); let reads = 0;
  const sync = new HouseholdSync(async () => ++reads === 1 ? Response.json({ items: [item], revision: 1 }) : pending.promise, 60_000);
  t.after(() => sync.stop()); sync.start(); await settle();
  const refresh = sync.refresh();
  sync.setItems([{ ...item, title: "Keep my edit" }]);
  pending.resolve(Response.json({ items: [{ ...item, title: "Remote" }], revision: 2 })); await refresh;
  assert.equal(sync.getSnapshot().items[0].title, "Keep my edit");
  assert.equal(sync.getSnapshot().revision, 1);
  assert.equal(sync.getSnapshot().dirty, true);
});

test("conflicts preserve local edits until an explicit choice, including deletions", async (t) => {
  let remote = { items: [item], revision: 1 };
  const sync = new HouseholdSync(async (_url, options) => options?.method ? new Response("{}", { status: 409 }) : Response.json(remote), 60_000);
  t.after(() => sync.stop()); sync.start(); await settle();
  sync.setItems([{ ...item, title: "Local" }, { ...item, id: "new", title: "New local" }]);
  await sync.flush();
  remote = { items: [{ ...item, title: "Remote" }], revision: 2 };
  await sync.retry();
  assert.equal(sync.getSnapshot().status, "conflict");
  assert.deepEqual(sync.getSnapshot().conflicts, ["Local"]);
  assert.equal(sync.getSnapshot().items[0].title, "Local");
  await sync.retry("remote");
  assert.deepEqual(sync.getSnapshot().items.map((i) => i.title), ["Remote", "New local"]);
  assert.equal(sync.getSnapshot().status, "saving");
  const deletion = mergeHouseholdItems([item], [], [{ ...item, title: "Remote" }]);
  assert.equal(deletion.conflicts.length, 1);
});

test("opening an editor during refresh keeps the draft’s original revision", async (t) => {
  const pending = deferred<Response>(); let reads = 0;
  const sync = new HouseholdSync(async () => ++reads === 1 ? Response.json({ items: [item], revision: 1 }) : pending.promise.then((response) => response.clone()));
  t.after(() => sync.stop()); sync.start(); await settle();
  const refresh = sync.refresh();
  sync.setDraftOpen(true);
  pending.resolve(Response.json({ items: [{ ...item, title: "Remote" }], revision: 2 })); await refresh;
  assert.equal(sync.getSnapshot().revision, 1);
  assert.equal(sync.getSnapshot().items[0].title, "Filter");
  sync.setDraftOpen(false);
  await sync.refresh();
  assert.equal(sync.getSnapshot().revision, 2);
});

test("read-only display refreshes without writing and recovers after an outage", async (t) => {
  let fail = false, title = "Filter";
  const sync = new HouseholdSync(async (url, options) => {
    assert.match(String(url), /api\/display\/items/);
    assert.equal(options?.method, undefined);
    if (fail) throw new Error("offline");
    return Response.json({ items: [{ ...item, title }], revision: 2 });
  });
  t.after(() => sync.stop()); sync.start("/api/display/items?display_key=test", true); await settle();
  sync.setItems([]); assert.equal(sync.getSnapshot().items.length, 1);
  fail = true; await sync.refresh();
  assert.equal(sync.getSnapshot().items[0].title, "Filter");
  fail = false; title = "Updated"; await sync.refresh();
  assert.equal(sync.getSnapshot().status, "saved");
  assert.equal(sync.getSnapshot().items[0].title, "Updated");
});
