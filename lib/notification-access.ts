import { isDakboardHostname } from "./display-auth";
import { noStoreJson } from "./household-state";

export function notificationAccessResponse(request: Request) {
  if (isDakboardHostname(request)) return noStoreJson({ error: "Not found." }, { status: 404 });
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) {
    return noStoreJson({ error: "A same-origin request is required." }, { status: 403 });
  }
  return null;
}
