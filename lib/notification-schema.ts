import { z } from "zod";

export const notificationSettingsSchema = z.object({
  dueToday: z.boolean().default(true),
  deliveryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("08:00"),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { dueToday: true, deliveryTime: "08:00" };

export function supportedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    return url.hostname === "fcm.googleapis.com"
      || url.hostname === "push.services.mozilla.com"
      || url.hostname.endsWith(".push.services.mozilla.com")
      || url.hostname === "web.push.apple.com"
      || url.hostname.endsWith(".notify.windows.com");
  } catch { return false; }
}

const endpointSchema = z.string().max(2048).refine(supportedPushEndpoint, "Unsupported browser push service.");
const keySchema = (length: number) => z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).refine((value) => {
  try { return atob(value.replaceAll("-", "+").replaceAll("_", "/")).length === length; } catch { return false; }
}, "Invalid push subscription key.");
export const subscriptionRequestSchema = z.strictObject({
  subscription: z.object({
    endpoint: endpointSchema,
    expirationTime: z.number().nullable().optional(),
    keys: z.strictObject({ p256dh: keySchema(65), auth: keySchema(16) }),
  }),
  settings: notificationSettingsSchema,
  timeZone: z.string().min(1).max(100).refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
  }, "Invalid time zone."),
});
export const subscriptionEndpointSchema = z.strictObject({ endpoint: endpointSchema });
export type SubscriptionRequest = z.infer<typeof subscriptionRequestSchema>;
