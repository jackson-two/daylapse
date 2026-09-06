import { z } from "zod";
import { MAX_HOUSEHOLD_BODY_BYTES, validationIssues, type ValidationIssue } from "@/lib/household-schema";

export class RequestValidationError extends Error {
  constructor(
    readonly status: 400 | 413 | 415 | 422,
    message: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}

async function readBoundedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HOUSEHOLD_BODY_BYTES) {
    throw new RequestValidationError(413, "Request body is too large.");
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HOUSEHOLD_BODY_BYTES) {
        await reader.cancel("Request body is too large.");
        throw new RequestValidationError(413, "Request body is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof RequestValidationError) throw error;
    throw new RequestValidationError(400, "Request body must be valid UTF-8 JSON.");
  } finally {
    reader.releaseLock();
  }
}

export async function parseJsonRequest<T>(request: Request, schema: z.ZodType<T>, issueRoot = "request") {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestValidationError(415, "Content-Type must be application/json.");
  }

  const text = await readBoundedBody(request);
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new RequestValidationError(400, "Request body must be valid JSON.");
  }

  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RequestValidationError(
      422,
      "Request data is invalid.",
      validationIssues(result.error, issueRoot),
    );
  }
  return result.data;
}
