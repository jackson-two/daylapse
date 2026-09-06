import { apiErrorResponse } from "@/lib/api-errors";
import { isDakboardHostname } from "@/lib/display-auth";
import { listHouseholdRevisions, noStoreJson } from "@/lib/household-state";
import { RequestValidationError } from "@/lib/request-validation";

export async function GET(request: Request) {
  try {
    if (isDakboardHostname(request)) return noStoreJson({ error: "Not found." }, { status: 404 });
    const rawLimit = new URL(request.url).searchParams.get("limit");
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RequestValidationError(400, "limit must be an integer from 1 to 100.");
    }
    return noStoreJson({ revisions: await listHouseholdRevisions(limit) });
  } catch (error) {
    return apiErrorResponse(error, "list-household-revisions");
  }
}
