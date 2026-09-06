import { apiErrorResponse } from "@/lib/api-errors";
import { isDakboardHostname } from "@/lib/display-auth";
import { noStoreJson, readHouseholdRevision } from "@/lib/household-state";
import { RequestValidationError } from "@/lib/request-validation";

type RevisionRouteContext = { params: Promise<{ revision: string }> };

async function revisionFrom(context: RevisionRouteContext) {
  const value = (await context.params).revision;
  if (!/^\d+$/.test(value)) throw new RequestValidationError(400, "revision must be a positive integer.");
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new RequestValidationError(400, "revision must be a positive integer.");
  }
  return revision;
}

export async function GET(request: Request, context: RevisionRouteContext) {
  try {
    if (isDakboardHostname(request)) return noStoreJson({ error: "Not found." }, { status: 404 });
    return noStoreJson(await readHouseholdRevision(await revisionFrom(context)));
  } catch (error) {
    return apiErrorResponse(error, "read-household-revision");
  }
}

export function POST() {
  return noStoreJson({code:"reload_required",error:"Use /api/recovery to restore a legacy revision into row storage with an expectedSequence and mutationId."},{status:410});
}
