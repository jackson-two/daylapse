import assert from "node:assert/strict";
import test from "node:test";
import { dueTodayItems, localNotificationClock } from "../lib/due-notifications";
import { subscriptionRequestSchema, supportedPushEndpoint } from "../lib/notification-schema";
import type { TrackedItem } from "../lib/household-schema";

const item: TrackedItem = { id: "filter", title: "Filter", type: "recurring", intervalValue: 30, intervalUnit: "days", lastCompleted: "2026-08-05", reminderDays: 7, history: [], createdAt: "2026-01-01" };

test("due-today alerts include exact due dates and skip archives, overdue items, and completed or snoozed tasks", () => {
  const items: TrackedItem[] = [item,
    { ...item, id: "archived", archived: true },
    { ...item, id: "overdue", lastCompleted: "2026-08-04" },
    { ...item, id: "completed", history: [{ id: "done", date: "2026-09-04" }] },
    { ...item, id: "snoozed", snoozedUntil: "2026-09-10" },
    { ...item, id: "birthday", type: "fixed", source: "birthday", monthDay: "09-04" },
    { ...item, id: "event", type: "fixed", targetDate: "2026-09-04" },
  ];
  assert.deepEqual(dueTodayItems(items, "2026-09-04").map((i) => i.id), ["filter", "birthday", "event"]);
});

test("device-local dates cross UTC boundaries and respect daylight saving time", () => {
  assert.deepEqual(localNotificationClock(new Date("2026-09-05T01:00:00Z"), "America/Phoenix"), { date: "2026-09-04", time: "18:00" });
  assert.deepEqual(localNotificationClock(new Date("2026-09-04T23:00:00Z"), "Asia/Tokyo"), { date: "2026-09-05", time: "08:00" });
  assert.equal(localNotificationClock(new Date("2026-01-01T13:00:00Z"), "America/New_York").time, "08:00");
  assert.equal(localNotificationClock(new Date("2026-07-01T12:00:00Z"), "America/New_York").time, "08:00");
});

test("subscriptions reject arbitrary URLs, invalid keys, timezones, and delivery times", () => {
  for (const endpoint of ["https://web.push.apple.com/test", "https://fcm.googleapis.com/fcm/send/test", "https://updates.push.services.mozilla.com/wpush/v2/test"]) assert.ok(supportedPushEndpoint(endpoint));
  for (const endpoint of ["http://127.0.0.1/", "https://example.com/", "https://fcm.googleapis.com.evil.example/", "https://user:pass@fcm.googleapis.com/", "https://fcm.googleapis.com:444/"]) assert.equal(supportedPushEndpoint(endpoint), false);
  assert.equal(subscriptionRequestSchema.safeParse({ subscription: { endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "bad", auth: "bad" } }, settings: { dueToday: true, deliveryTime: "25:00" }, timeZone: "fake/zone" }).success, false);
});
