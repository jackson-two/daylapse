import assert from "node:assert/strict";
import test from "node:test";
import { openLocalRows } from "../scripts/row-storage-local";
import { convertSnapshot } from "../lib/row-converter";
import { importConverted } from "../lib/row-importer";
import { readSubscription, saveSubscription, sendDueNotifications, sendPush, type StoredSubscription } from "../lib/notification-service";
import { dueTodayMessage } from "../lib/due-notifications";
import type { SubscriptionRequest } from "../lib/notification-schema";
import type { TrackedItem } from "../lib/household-schema";

const item: TrackedItem = { id: "filter", title: "Filter", type: "recurring", intervalValue: 30, intervalUnit: "days", lastCompleted: "2026-08-05", reminderDays: 7, history: [], createdAt: "2026-01-01" };

test("Cloudflare D1 push delivery stores subscriptions and coordinates scheduled runs", async (t) => {
  const {db:DB,mf} = await openLocalRows();
  t.after(() => mf.dispose());
  await importConverted(DB, await convertSnapshot({items:[item],revision:1},"2026-09-04T00:00:00.000Z",["2026-09-04"]));
  await DB.prepare("UPDATE installation_settings SET storage_mode='rows'").run();
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const browserKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const env = { DB, VAPID_PUBLIC_KEY: Buffer.from(await crypto.subtle.exportKey("raw", vapid.publicKey)).toString("base64url"), VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey("jwk", vapid.privateKey)).d!, VAPID_SUBJECT: "mailto:notifications@example.com" };
  const input: SubscriptionRequest = {
    subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/daylapse-test", keys: { p256dh: Buffer.from(await crypto.subtle.exportKey("raw", browserKeys.publicKey)).toString("base64url"), auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url") } },
    settings: { dueToday: true, deliveryTime: "08:00" }, timeZone: "America/Phoenix",
  };
  const at = (time: string) => new Date(`2026-09-04T${time}:00Z`);
  const reset = async () => { await DB.prepare("DELETE FROM push_subscriptions").run(); await saveSubscription(env, input); };

  await t.test("one summary per local day, including overlapping cron invocations", async () => {
    await reset();
    let sends = 0;
    const send = async () => { sends++; return 201; };
    await sendDueNotifications(env, at("14:55"), send);
    assert.equal(sends, 0);
    await Promise.all([sendDueNotifications(env, at("15:05"), send), sendDueNotifications(env, at("15:05"), send)]);
    await sendDueNotifications(env, at("15:10"), send);
    assert.equal(sends, 1);
    assert.equal((await readSubscription(env, input.subscription.endpoint))?.last_sent_date, "2026-09-04");
  });

  await t.test("transient failures retry and expired subscriptions are removed", async () => {
    await reset();
    assert.equal((await sendDueNotifications(env, at("15:05"), async () => 503)).failed, 1);
    assert.equal((await sendDueNotifications(env, at("15:10"), async () => 201)).sent, 1);
    await reset();
    assert.equal((await sendDueNotifications(env, at("15:05"), async () => 410)).expired, 1);
    assert.equal(await readSubscription(env, input.subscription.endpoint), null);
  });

  await t.test("turning alerts off and resaving preferences do not reset daily delivery history", async () => {
    await reset();
    await sendDueNotifications(env, at("15:05"), async () => 201);
    await saveSubscription(env, { ...input, settings: { ...input.settings, dueToday: false } });
    let sends = 0;
    await sendDueNotifications(env, at("15:10"), async () => { sends++; return 201; });
    assert.equal(sends, 0);
    assert.equal((await readSubscription(env, input.subscription.endpoint))?.last_sent_date, "2026-09-04");
    await saveSubscription(env, input);
    await sendDueNotifications(env, at("15:15"), async () => { sends++; return 201; });
    assert.equal(sends, 0);
  });

  await t.test("Web Push requests encrypt titles and use VAPID without following redirects", async (context) => {
    await reset();
    const row = await readSubscription(env, input.subscription.endpoint) as StoredSubscription;
    const request = context.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
      assert.equal(url, input.subscription.endpoint);
      assert.equal(options?.redirect, "manual");
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("content-encoding"), "aes128gcm");
      assert.match(headers.get("authorization")!, /^vapid /);
      assert.ok(options?.body instanceof Uint8Array);
      assert.equal(new TextDecoder().decode(options.body).includes("Filter"), false);
      return new Response(null, { status: 201 });
    });
    assert.equal(await sendPush(env, row, dueTodayMessage([item], "2026-09-04")), 201);
    assert.equal(request.mock.callCount(), 1);
  });
});
