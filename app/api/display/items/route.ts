import { env } from "cloudflare:workers";
import { readRowSnapshot } from "@/lib/row-consumers";
import { hasValidDisplayKey } from "@/lib/display-auth";
import { apiErrorResponse } from "@/lib/api-errors";
import { noStoreJson } from "@/lib/household-state";

export async function GET(request: Request) {
  try {
    if (!await hasValidDisplayKey(request)) {
      return noStoreJson({ error: "Display access is not authorized." }, { status: 401 });
    }
    return noStoreJson(await readRowSnapshot(env.DB, "display", new URL(request.url).searchParams.get("timeZone") ?? undefined));
  } catch (error) {
    return apiErrorResponse(error, "read-display-household-state");
  }
}

export function PUT() {
  return noStoreJson({ error: "The DAKboard display is read-only." }, { status: 405 });
}
