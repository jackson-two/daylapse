import { env } from "cloudflare:workers";
import { noStoreJson } from "@/lib/household-state";
import { apiErrorResponse } from "@/lib/api-errors";
import { notificationAccessResponse } from "@/lib/notification-access";
import { parseJsonRequest } from "@/lib/request-validation";
import { subscriptionEndpointSchema } from "@/lib/notification-schema";
import { readSubscription } from "@/lib/notification-service";

export async function POST(request: Request) {
  const denied = notificationAccessResponse(request);
  if (denied) return denied;
  try {
    const { endpoint } = await parseJsonRequest(request, subscriptionEndpointSchema);
    const row = await readSubscription(env, endpoint);
    return noStoreJson(row && row.vapid_public_key === env.VAPID_PUBLIC_KEY
      ? { subscribed: true, settings: { dueToday: Boolean(row.due_today), deliveryTime: row.delivery_time }, timeZone: row.time_zone }
      : { subscribed: false });
  } catch (error) { return apiErrorResponse(error, "read-push-subscription"); }
}
