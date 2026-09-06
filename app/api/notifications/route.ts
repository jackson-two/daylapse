import { env } from "cloudflare:workers";
import { noStoreJson } from "@/lib/household-state";
import { apiErrorResponse } from "@/lib/api-errors";
import { notificationAccessResponse } from "@/lib/notification-access";
import { parseJsonRequest } from "@/lib/request-validation";
import { subscriptionEndpointSchema, subscriptionRequestSchema } from "@/lib/notification-schema";
import { deleteSubscription, pushConfigured, saveSubscription } from "@/lib/notification-service";

export function GET(request: Request) {
  return notificationAccessResponse(request) ?? noStoreJson({ configured: pushConfigured(env), publicKey: pushConfigured(env) ? env.VAPID_PUBLIC_KEY : null });
}
export async function PUT(request: Request) {
  const denied = notificationAccessResponse(request);
  if (denied) return denied;
  if (!pushConfigured(env)) return noStoreJson({ error: "Notifications need to be configured on the server first." }, { status: 503 });
  try {
    await saveSubscription(env, await parseJsonRequest(request, subscriptionRequestSchema));
    return noStoreJson({ ok: true });
  } catch (error) { return apiErrorResponse(error, "save-push-subscription"); }
}
export async function DELETE(request: Request) {
  const denied = notificationAccessResponse(request);
  if (denied) return denied;
  try {
    const { endpoint } = await parseJsonRequest(request, subscriptionEndpointSchema);
    await deleteSubscription(env, endpoint);
    return noStoreJson({ ok: true });
  } catch (error) { return apiErrorResponse(error, "delete-push-subscription"); }
}
