import { env } from "cloudflare:workers";
import { noStoreJson } from "@/lib/household-state";
import { apiErrorResponse } from "@/lib/api-errors";
import { notificationAccessResponse } from "@/lib/notification-access";
import { parseJsonRequest } from "@/lib/request-validation";
import { subscriptionEndpointSchema } from "@/lib/notification-schema";
import { pushConfigured, sendTestPush } from "@/lib/notification-service";

export async function POST(request: Request) {
  const denied = notificationAccessResponse(request);
  if (denied) return denied;
  if (!pushConfigured(env)) return noStoreJson({ error: "Notifications need to be configured on the server first." }, { status: 503 });
  try {
    const { endpoint } = await parseJsonRequest(request, subscriptionEndpointSchema);
    const status = await sendTestPush(env, endpoint);
    return noStoreJson(status === 200 ? { ok: true } : { error: status === 429 ? "Wait a minute before sending another test." : status === 404 || status === 410 ? "Enable notifications again on this device." : "The push service could not accept the notification. Please try again." }, { status });
  } catch (error) { return apiErrorResponse(error, "test-push-subscription"); }
}
