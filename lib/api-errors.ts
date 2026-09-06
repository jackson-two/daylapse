import { noStoreJson, HouseholdRevisionConflictError, HouseholdRevisionNotFoundError, HouseholdRevisionStorageError, StoredHouseholdDataError } from "@/lib/household-state";
import { RequestValidationError } from "@/lib/request-validation";

export function apiErrorResponse(error: unknown, operation: string) {
  if (error instanceof RequestValidationError) {
    return noStoreJson({
      error: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
    }, { status: error.status });
  }

  if (error instanceof HouseholdRevisionConflictError) {
    return noStoreJson({
      error: error.message,
      revision: error.revision,
      updatedAt: error.updatedAt,
    }, { status: 409 });
  }

  if (error instanceof HouseholdRevisionNotFoundError) {
    return noStoreJson({ error: "Household revision was not found." }, { status: 404 });
  }

  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({
    message: "Daylapse API operation failed",
    operation,
    requestId,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : "Unknown error",
    ...(error instanceof StoredHouseholdDataError ? {
      revision: error.revision,
      validationIssues: error.issues.map(({ path, code }) => ({ path, code })),
    } : {}),
  }));

  if (error instanceof HouseholdRevisionStorageError) {
    return noStoreJson({
      error: "Household revision storage is not ready.",
      requestId,
    }, { status: 503 });
  }

  return noStoreJson({
    error: "Shared household storage is unavailable.",
    requestId,
  }, { status: 500 });
}
