import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { readRowSnapshot } from "./row-consumers";
import { dueTodayItems, dueTodayMessage, localNotificationClock } from "./due-notifications";
import { supportedPushEndpoint, type SubscriptionRequest } from "./notification-schema";

type PushEnv = Pick<Env, "DB" | "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT"> & { DAYLAPSE?: { notifications: boolean } };
export type StoredSubscription = {
  id: string; endpoint: string; p256dh: string; auth: string; due_today: number;
  delivery_time: string; time_zone: string; last_sent_date: string | null;
  vapid_public_key: string; updated_at: string;
};
export const pushConfigured = (env: PushEnv) => Boolean(env.DAYLAPSE?.notifications !== false && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

export async function subscriptionId(endpoint: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function saveSubscription(env: PushEnv, input: SubscriptionRequest) {
  if (!pushConfigured(env)) throw new Error("Push notifications are not configured.");
  // Validate the public point before persisting a subscription that could never encrypt.
  const bytes = Uint8Array.from(atob(input.subscription.keys.p256dh.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
  await crypto.subtle.importKey("raw", bytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const id = await subscriptionId(input.subscription.endpoint);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, vapid_public_key, due_today, delivery_time, time_zone, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM push_subscriptions WHERE id = ?)
       OR (SELECT COUNT(*) FROM push_subscriptions) < 100
    ON CONFLICT(id) DO UPDATE SET
      p256dh = excluded.p256dh, auth = excluded.auth, vapid_public_key = excluded.vapid_public_key,
      due_today = excluded.due_today, delivery_time = excluded.delivery_time,
      time_zone = excluded.time_zone, updated_at = excluded.updated_at
    RETURNING id
  `).bind(id, input.subscription.endpoint, input.subscription.keys.p256dh, input.subscription.keys.auth,
    env.VAPID_PUBLIC_KEY, input.settings.dueToday ? 1 : 0, input.settings.deliveryTime, input.timeZone, now, now, id).first<{ id: string }>();
  if (!result) throw new Error("The household device limit has been reached.");
}

export async function readSubscription(env: PushEnv, endpoint: string) {
  return env.DB.prepare("SELECT * FROM push_subscriptions WHERE id = ?").bind(await subscriptionId(endpoint)).first<StoredSubscription>();
}
export async function deleteSubscription(env: PushEnv, endpoint: string) {
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(await subscriptionId(endpoint)).run();
}

export async function sendPush(env: PushEnv, row: StoredSubscription, message: ReturnType<typeof dueTodayMessage>, ttl = 3600) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) throw new Error("Push notifications are not configured.");
  if (!supportedPushEndpoint(row.endpoint)) throw new Error("Unsupported browser push service.");
  const subscription: PushSubscription = { endpoint: row.endpoint, expirationTime: null, keys: { p256dh: row.p256dh, auth: row.auth } };
  const payload = await buildPushPayload({ data: message, options: { ttl, urgency: "normal" } }, subscription, {
    publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT,
  });
  // Workers supports manual/follow, not redirect:"error". Treat 3xx as a
  // failed delivery; never forward the encrypted payload or VAPID authorization.
  const response = await fetch(subscription.endpoint, { ...payload, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  await response.body?.cancel();
  return response.status;
}

export async function sendDueNotifications(env: PushEnv, now = new Date(), send = sendPush) {
  if (!pushConfigured(env)) return { sent: 0, failed: 0, expired: 0 };
  const subscriptions = await env.DB.prepare("SELECT * FROM push_subscriptions WHERE due_today = 1 AND vapid_public_key = ?")
    .bind(env.VAPID_PUBLIC_KEY).all<StoredSubscription>();
  if (!subscriptions.results.length) return { sent: 0, failed: 0, expired: 0 };
  const settings = await env.DB.prepare("SELECT storage_mode, import_state FROM installation_settings WHERE id=1").first<{storage_mode:string;import_state:string}>();
  if (settings?.storage_mode !== "rows" || settings.import_state !== "ready") return {sent:0,failed:0,expired:0};
  const { items } = await readRowSnapshot(env.DB, "notifications");
  const results = { sent: 0, failed: 0, expired: 0 };
  // Bounded batches limit concurrent connections and avoid one device blocking the others.
  for (let offset = 0; offset < subscriptions.results.length; offset += 5) {
    await Promise.all(subscriptions.results.slice(offset, offset + 5).map(async (row) => {
      const clock = localNotificationClock(now, row.time_zone);
      if (clock.time < row.delivery_time || row.last_sent_date === clock.date) return;
      const due = dueTodayItems(items, clock.date);
      if (!due.length) return;
      const token = crypto.randomUUID();
      const claimed = await env.DB.prepare(`
        UPDATE push_subscriptions SET lease_until = ?, lease_token = ?
        WHERE id = ? AND due_today = 1 AND updated_at = ? AND lease_until <= ?
          AND (last_sent_date IS NULL OR last_sent_date <> ?)
        RETURNING id
      `).bind(now.getTime() + 120_000, token, row.id, row.updated_at, now.getTime(), clock.date).first<{ id: string }>();
      if (!claimed) return;
      try {
        // Keep late-evening notifications from being retained well into tomorrow.
        const [hour, minute] = clock.time.split(":").map(Number);
        const ttl = Math.max(60, Math.min(3600, ((24 - hour) * 60 - minute) * 60));
        const status = await send(env, row, dueTodayMessage(due, clock.date), ttl);
        if (status === 404 || status === 410) {
          await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ? AND lease_token = ?").bind(row.id, token).run();
          results.expired++;
        } else if (status >= 200 && status < 300) {
          await env.DB.prepare("UPDATE push_subscriptions SET last_sent_date = ?, lease_until = 0, lease_token = NULL WHERE id = ? AND lease_token = ?")
            .bind(clock.date, row.id, token).run();
          results.sent++;
        } else {
          results.failed++;
          console.error(JSON.stringify({ operation: "send-due-notification", subscriptionId: row.id, status }));
        }
      } catch {
        results.failed++;
        console.error(JSON.stringify({ operation: "send-due-notification", subscriptionId: row.id, message: "Push delivery failed; will retry." }));
      } finally {
        await env.DB.prepare("UPDATE push_subscriptions SET lease_until = 0, lease_token = NULL WHERE id = ? AND lease_token = ?").bind(row.id, token).run();
      }
    }));
  }
  return results;
}

export async function sendTestPush(env: PushEnv, endpoint: string) {
  const row = await readSubscription(env, endpoint);
  if (!row || row.vapid_public_key !== env.VAPID_PUBLIC_KEY) return 404;
  const now = Date.now();
  const claim = await env.DB.prepare("UPDATE push_subscriptions SET last_test_at = ? WHERE id = ? AND last_test_at <= ? RETURNING id")
    .bind(now, row.id, now - 60_000).first<{ id: string }>();
  if (!claim) return 429;
  const status = await sendPush(env, row, { title: "Daylapse test", body: "Due-today notifications can reach this device.", tag: "daylapse-test", data: { url: "/?screen=notifications", dueDate: "" } });
  if (status === 404 || status === 410) await deleteSubscription(env, endpoint);
  return status >= 200 && status < 300 ? 200 : status === 404 || status === 410 ? 410 : 502;
}
